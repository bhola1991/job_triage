import { parseMail, readRaw, gmailConfirmCode } from './mime-lite.mjs';
import { tokenFrom, decide } from './reply-match.mjs';

const MAX_MESSAGE_LENGTH = 2000;
// Resend's sandbox sender (onboarding@resend.dev) can only deliver to the
// account's own address until a custom domain is verified at
// resend.com/domains -- so this can't be banerjeesoumyadip1991@gmail.com
// (the site's published contact address) without that verification step.
const CONTACT_TO_EMAIL = 'reachbhola@gmail.com';

// Where mail to jobtriage.app that is NOT a reply token goes. Email Routing's
// catch-all is the only way to receive a per-user address, since it has no
// wildcard rule -- so this Worker sees every address on the domain and has to
// hand back anything that is not ours rather than swallow it.
const FORWARD_UNMATCHED_TO = 'reachbhola@gmail.com';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/contact') {
      return handleContact(request, env);
    }

    return env.ASSETS.fetch(request);
  },

  // Cloudflare Email Routing entry point. Registered by the catch-all rule on
  // jobtriage.app; see handleEmail for what it will and will not write.
  async email(message, env, ctx) {
    return handleEmail(message, env, ctx);
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
   Inbound mail: did a human answer an application?
   ═══════════════════════════════════════════════════════════════════════════

   jobs.stage = 'live' is the only record in this project that anybody ever
   heard back, so this path is written to fail in one direction. Three rules it
   keeps, in order of how much damage breaking them does:

     1. A mail to an address that is not a live token is FORWARDED, never
        stored. We hold no credential and read nothing that was not routed to
        us; a catch-all that quietly archived the domain's mail would undo
        that in one line.
     2. Only decide() in reply-match.mjs decides. Nothing here re-reads the
        text or second-guesses it, and the decision is stored beside its
        effect so a wrong call is findable and reversible.
     3. A write that fails must not bounce the mail. setReject() tells the
        SENDER their message was refused, which is a lie when the fault is
        ours -- so every failure past routing is logged and swallowed.
*/
async function handleEmail(message, env, ctx) {
  const token = tokenFrom(message.to);

  // Not a reply address. Hand it on and keep nothing.
  if (!token) {
    try { await message.forward(FORWARD_UNMATCHED_TO); }
    catch (e) { console.error(`forward failed: ${e.message}`); }
    return;
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('inbound mail arrived with no Supabase binding; dropped');
    return;
  }

  let mail;
  try {
    mail = parseMail(await readRaw(message.raw));
  } catch (e) {
    console.error(`mime parse failed: ${e.message}`);
    return;
  }
  // The envelope is authoritative over the headers it carries: a From: header
  // is attacker-controlled and the classifier's veto keys off the sender box.
  mail.from = message.from || mail.from;
  mail.to = message.to || mail.to;

  try {
    await routeToProfile(env, token, mail, message.headers?.get?.('message-id') || mail.messageId);
  } catch (e) {
    console.error(`inbound mail write failed: ${e.message}`);
  }
}

const rest = (env, path, init = {}) => fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  },
});

async function routeToProfile(env, token, mail, providerId) {
  const pr = await rest(env, `profiles?select=id,user_id&inbox_token=eq.${encodeURIComponent(token)}&limit=1`);
  if (!pr.ok) throw new Error(`profile lookup ${pr.status}`);
  const [profile] = await pr.json();
  // A token nobody holds is a dead drop -- rotated, or guessed at. Storing it
  // would let anyone who can post mail fill the table.
  if (!profile) { console.log('inbound mail to an unknown token; dropped'); return; }

  // Gmail will not forward anything until its confirmation code is entered
  // back, and it mails that code here, where the person cannot see it. Surface
  // it and stop: it is not a reply and must not be classified as one.
  const code = gmailConfirmCode(mail);
  if (code) {
    await store(env, profile, mail, providerId, { kind: 'setup', why: 'gmail forwarding confirmation', action: 'show-code', code });
    return;
  }

  const jr = await rest(env, `jobs?select=job_key,company,url,stage,deleted,sent_message_id` +
    `&profile_id=eq.${profile.id}&stage=in.(sent,live)&deleted=is.false&limit=500`);
  if (!jr.ok) throw new Error(`jobs lookup ${jr.status}`);
  const jobs = await jr.json();

  const d = decide(mail, jobs);
  let appliedTo = null, appliedStage = null;

  if (d.action === 'set-stage') {
    // Guarded on the stage we decided against, so two deliveries of the same
    // mail cannot walk a row forward twice, and a stage the user changed in
    // the meantime wins over our stale read.
    const from = d.stage === 'live' ? 'sent' : 'in.(sent,live)';
    const q = `jobs?profile_id=eq.${profile.id}&job_key=eq.${encodeURIComponent(d.matched)}` +
      `&stage=${from.startsWith('in.') ? from : `eq.${from}`}`;
    const up = await rest(env, q, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ stage: d.stage, last_touch: new Date().toISOString().slice(0, 10) }),
    });
    if (!up.ok) throw new Error(`stage patch ${up.status}`);
    const rows = await up.json();
    if (rows.length) { appliedTo = d.matched; appliedStage = d.stage; }
  } else if (d.action === 'confirm-applied' && d.date_applied) {
    // An acknowledgement is evidence of WHEN, not of a reply. Written only
    // where the app has no date at all, so a receipt arriving late can never
    // move a date the person set themselves.
    const up = await rest(env, `jobs?profile_id=eq.${profile.id}` +
      `&job_key=eq.${encodeURIComponent(d.matched)}&date_applied=is.null`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ date_applied: d.date_applied }),
    });
    if (up.ok && (await up.json()).length) appliedTo = d.matched;
  }

  await store(env, profile, mail, providerId, d, appliedTo, appliedStage);
}

async function store(env, profile, mail, providerId, decision, appliedTo = null, appliedStage = null) {
  const r = await rest(env, 'inbound_mail?on_conflict=profile_id,provider_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: profile.user_id,
      profile_id: profile.id,
      provider_id: providerId || null,
      from_addr: String(mail.from || '').slice(0, 300),
      subject: String(mail.subject || '').slice(0, 500),
      // A bounded excerpt, not the mail. Enough to audit a decision; not a
      // copy of somebody's inbox.
      excerpt: String(mail.text || '').replace(/\s+/g, ' ').trim().slice(0, 2000),
      received_at: mail.date ? new Date(mail.date).toISOString() : new Date().toISOString(),
      decision,
      applied_to: appliedTo,
      applied_stage: appliedStage,
    }),
  });
  if (!r.ok) throw new Error(`inbound_mail insert ${r.status}: ${(await r.text()).slice(0, 160)}`);
}

async function handleContact(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { name, email, message, website } = body ?? {};

  if (typeof website === 'string' && website.trim() !== '') {
    return jsonResponse({ ok: false, error: 'Invalid submission' }, 400);
  }

  if (typeof email !== 'string' || !email.trim() || typeof message !== 'string' || !message.trim()) {
    return jsonResponse({ ok: false, error: 'Email and message are required' }, 400);
  }

  const trimmedMessage = message.slice(0, MAX_MESSAGE_LENGTH);
  const senderName = typeof name === 'string' && name.trim() ? name.trim() : 'Someone';

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Job Triage <onboarding@resend.dev>',
      to: [CONTACT_TO_EMAIL],
      reply_to: email,
      subject: `Job Triage message from ${senderName}`,
      text: trimmedMessage,
    }),
  });

  if (!resendResponse.ok) {
    const detail = await resendResponse.text().catch(() => '');
    console.error(`Resend send failed: ${resendResponse.status} ${detail}`);
    return jsonResponse({ ok: false, error: 'Failed to send message' }, 502);
  }

  return jsonResponse({ ok: true }, 200);
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
