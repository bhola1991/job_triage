// Does this inbound email mean a human answered a job application?
//
// One copy, two consumers: the Cloudflare Email Worker that receives the mail
// and scripts/selfcheck-reply.js, which drives it against fixtures offline.
// ESM because the Worker is; the CJS check reaches it through import().
//
// Why this file is pure
// ---------------------
// The thing being built is GROUND TRUTH -- jobs.stage reaching 'live' is the
// only evidence in this project that anybody got a reply, and every quality
// claim about the matcher is measured against it. So the rule here is: a
// mis-match is worse than a miss. Nothing in this file guesses, nothing calls
// a model, and every path returns WHY it decided, so a wrong call can be found
// in inbound_mail and reversed rather than quietly rewriting a user's pipeline.
//
// The correction that shapes the whole design
// -------------------------------------------
// An ATS auto-acknowledgement is NOT a reply. "Thank you for applying to Acme"
// from no-reply@greenhouse.io is a receipt the machine sent itself; counting it
// as 'live' would fill the replied column with noise and make the ground truth
// worthless in exactly the way that matters. Three outcomes, three stages:
//
//   ack     a receipt           -> confirms date_applied, stage UNCHANGED
//   reject  a no                -> stage 'closed'
//   human   a person wants something -> stage 'live'   <- the only reply
//
// 'human' is the narrow one on purpose. Anything that carries a bulk-mail
// header, or comes from a do-not-reply box, can never reach it.

/* ── Senders ─────────────────────────────────────────────────────────────── */

/* The ATS platforms this repo already crawls (scripts/index/ingest.js), by the
   domains they send FROM -- which are not the domains they serve job boards
   from, so these were collected separately rather than derived. A match here
   does not identify the company: the mail is from the ATS on a company's
   behalf, so the company still has to come out of the subject or the body. */
const ATS_SENDERS = new Map(Object.entries({
  'greenhouse.io': 'greenhouse',
  'greenhouse-mail.io': 'greenhouse',
  'us.greenhouse-mail.io': 'greenhouse',
  'hire.lever.co': 'lever',
  'lever.co': 'lever',
  'ashbyhq.com': 'ashby',
  'workable.com': 'workable',
  'candidates.workablemail.com': 'workable',
  'smartrecruiters.com': 'smartrecruiters',
  'recruitee.com': 'recruitee',
  'myworkday.com': 'workday',
  'icims.com': 'icims',
  'successfactors.com': 'successfactors',
  'taleo.net': 'taleo',
}));

/* A box that cannot be written back to is a machine, whatever it says. */
const NO_REPLY = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|noreply|notifications?|automated|mailer[-_.]?daemon|bounce)/i;

/* Headers that assert "this was not typed by a person". RFC 3834 and the
   bulk-mail conventions. Any one of these vetoes 'human' outright. */
const BULK_HEADERS = ['list-unsubscribe', 'list-id', 'auto-submitted', 'x-auto-response-suppress'];

/* ── Normalising ─────────────────────────────────────────────────────────── */

/* Company names arrive three ways -- as the user typed them into a job row, as
   an ATS writes them in a subject, and as a domain -- and have to compare
   equal across all three. Suffixes go because "Acme" and "Acme Pvt Ltd" are
   one employer; punctuation and spacing go because nobody agrees on them. */
const COMPANY_SUFFIX = /\b(inc|llc|ltd|limited|pvt|private|plc|gmbh|bv|sa|ag|corp|corporation|co|company|holdings|group|labs|technologies|technology|tech|solutions|systems|services|software|india|global|international)\b/g;

export function normCompany(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(COMPANY_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Public-suffix handling without a public-suffix list: strip the known
   multi-part endings this app actually meets, then keep two labels. A real PSL
   is the right answer at scale, but it is 15k entries of dependency to decide
   whether 'careers.acme.co.in' is acme -- and getting it wrong here costs a
   near-miss that lands in unmatched, not a bad write. */
const MULTI_TLD = /\.(co|com|net|org|gov|edu|ac)\.[a-z]{2}$/;

export function hostRoot(host) {
  const h = String(host || '').toLowerCase().replace(/^.*@/, '').replace(/\.$/, '');
  if (!h || !h.includes('.')) return '';
  const parts = h.split('.');
  const keep = MULTI_TLD.test(h) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

const addr = (s) => {
  const m = /<([^>]+)>/.exec(String(s || ''));
  return (m ? m[1] : String(s || '')).trim().toLowerCase();
};
const domainOf = (s) => addr(s).split('@')[1] || '';
const localOf = (s) => addr(s).split('@')[0] || '';

/* ── Routing ─────────────────────────────────────────────────────────────── */

/* The recipient address carries the profile token, so WHOSE pipeline this mail
   belongs to is never inferred -- it is read. Addresses look like
   r.<32 hex>@<inbound domain>; a token that is not in profiles.inbox_token is
   a dead drop and the mail is discarded without being stored. */
const TOKEN_RE = /^r\.([0-9a-f]{32})$/i;

export function tokenFrom(to) {
  for (const one of String(to || '').split(',')) {
    const m = TOKEN_RE.exec(localOf(one));
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/* ── Matching a mail to a job ────────────────────────────────────────────── */

/* Candidate jobs are the user's own rows: {job_key, company, url, stage,
   date_applied}. Only rows the person has actually acted on can receive a
   reply, so 'new' and 'closed' are not candidates -- a mail about a job nobody
   applied to is far more likely a newsletter than a reply, and treating it as
   one would invent an application that never happened. */
const OPEN_STAGES = new Set(['sent', 'live']);

export function matchJob(mail, jobs) {
  const open = (jobs || []).filter((j) => OPEN_STAGES.has(j.stage) && !j.deleted);
  if (!open.length) return { job: null, how: 'no-open-jobs', confident: false };

  /* 1. The thread. Strongest signal there is: the mail quotes a Message-ID we
        recorded when the application went out. Nothing writes those yet -- the
        app does not send mail -- so this is a hook, not a live path, and it is
        first because when it does exist it should beat everything below. */
  const refs = `${mail.inReplyTo || ''} ${mail.references || ''}`.toLowerCase();
  if (refs.trim()) {
    const hit = open.find((j) => j.sent_message_id && refs.includes(String(j.sent_message_id).toLowerCase()));
    if (hit) return { job: hit, how: 'in-reply-to', confident: true };
  }

  const from = domainOf(mail.from);
  const platform = ATS_SENDERS.get(from) || ATS_SENDERS.get(hostRoot(from)) || null;

  /* 2. The company's own domain, against the posting URL's host or the company
        name. A mail from careers@acme.com about the Acme row is the ordinary
        case and needs no text parsing at all. */
  if (!platform && from) {
    const root = hostRoot(from);
    const byUrl = open.filter((j) => j.url && hostRoot(urlHost(j.url)) === root);
    if (byUrl.length === 1) return { job: byUrl[0], how: 'sender-domain=url-host', confident: true };
    const label = normCompany(root.split('.')[0]);
    const byName = open.filter((j) => label && normCompany(j.company) === label);
    if (byName.length === 1) return { job: byName[0], how: 'sender-domain=company', confident: true };
    if (byUrl.length > 1 || byName.length > 1) {
      return { job: null, how: 'ambiguous-domain', confident: false };
    }
  }

  /* 3. An ATS speaking for a company it names in the subject. Matched by
        looking for each job's company IN the text rather than parsing a
        company OUT of it: there is no reliable grammar for "Thank you for
        applying to X", and a parser that invents X would match the wrong row.
        Containment of a name we already hold cannot invent anything. */
  const hay = ` ${normCompany(`${mail.subject || ''} ${String(mail.text || '').slice(0, 2000)}`)} `;
  const named = open.filter((j) => {
    const c = normCompany(j.company);
    return c.length >= 3 && hay.includes(` ${c} `);
  });
  if (named.length === 1) return { job: named[0], how: platform ? `ats:${platform}+company-in-text` : 'company-in-text', confident: true };
  if (named.length > 1) return { job: null, how: 'ambiguous-company-in-text', confident: false };

  return { job: null, how: platform ? `ats:${platform}+no-company` : 'unmatched', confident: false };
}

function urlHost(u) {
  try { return new URL(String(u)).hostname; } catch { return ''; }
}

/* ── Classifying what the mail says ──────────────────────────────────────── */

/* Phrase sets, not a model. Each one is a phrase that in practice only appears
   in its own kind of mail; anything that fires neither is 'unclear', which is
   a real answer here and changes nothing. Deciding 'unclear' is what a judge
   call would be FOR, and it stays out of this file so the check runs offline
   and so a model can never be the thing that writes ground truth. */
const REJECT_CUES = [
  'not moving forward', 'not be moving forward', 'will not be proceeding',
  'decided to move forward with other', 'decided to pursue other',
  'other candidates whose', 'not to proceed', 'unsuccessful on this occasion',
  'we have filled', 'position has been filled', 'no longer under consideration',
  'regret to inform', 'unfortunately we', 'unfortunately, we',
  'keep your resume on file', 'keep your details on file',
];
const ACK_CUES = [
  'thank you for applying', 'thanks for applying', 'thank you for your application',
  'we have received your application', 'application received', 'your application has been received',
  'thank you for your interest in', 'successfully submitted', 'we will review your',
];
const HUMAN_CUES = [
  'are you available', 'your availability', 'schedule a call', 'set up a call',
  'book a time', 'jump on a call', 'hop on a call', 'next steps would be',
  'like to speak with you', 'like to chat', 'interview', 'few questions for you',
  'could you share', 'can you send', 'what are your salary', 'notice period',
  'when could you start', 'looking forward to speaking',
];

const hit = (hay, cues) => cues.find((c) => hay.includes(c)) || null;

export function classify(mail) {
  const hay = `${mail.subject || ''}\n${String(mail.text || '').slice(0, 4000)}`
    .toLowerCase().replace(/\s+/g, ' ');

  const headers = mail.headers || {};
  const hdr = (n) => headers[n] ?? headers[n.toLowerCase()] ?? null;
  const bulk = BULK_HEADERS.find((h) => hdr(h) != null)
    || (/\b(bulk|list|junk)\b/i.test(String(hdr('precedence') || '')) ? 'precedence' : null);
  const machine = NO_REPLY.test(localOf(mail.from));

  /* A rejection is read first, and is believed even from a machine -- almost
     every rejection IS automated, and it is the one automated mail whose
     content is a real outcome rather than a receipt. */
  const rej = hit(hay, REJECT_CUES);
  if (rej) return { kind: 'reject', why: `reject cue: "${rej}"` };

  const ack = hit(hay, ACK_CUES);
  if (ack) return { kind: 'ack', why: `ack cue: "${ack}"` };

  /* Only here can a mail be a reply, and only if nothing says it was sent by a
     machine. The veto is deliberately absolute: a false 'live' is the failure
     this whole file exists to avoid, and a missed one costs a row the user can
     still flip by hand. */
  const hum = hit(hay, HUMAN_CUES);
  if (hum) {
    if (bulk) return { kind: 'unclear', why: `human cue "${hum}" but bulk header: ${bulk}` };
    if (machine) return { kind: 'unclear', why: `human cue "${hum}" but sender is ${localOf(mail.from)}` };
    return { kind: 'human', why: `human cue: "${hum}"` };
  }

  if (bulk || machine) return { kind: 'noise', why: bulk ? `bulk header: ${bulk}` : 'do-not-reply sender' };
  return { kind: 'unclear', why: 'no cue fired' };
}

/* ── The decision ────────────────────────────────────────────────────────── */

/* What to write, or nothing. Returned rather than applied so the caller can
   store the reasoning beside the effect, and so this stays testable without a
   database. stage is only ever set FORWARD out of 'sent': a mail arriving
   about a job already 'live' does not re-announce it, and nothing here can
   reopen a row the user closed. */
export function decide(mail, jobs) {
  const m = matchJob(mail, jobs);
  const c = classify(mail);
  const base = { matched: m.job ? m.job.job_key : null, how: m.how, kind: c.kind, why: c.why };

  if (!m.job || !m.confident) return { ...base, action: 'store-unmatched' };
  if (c.kind === 'human') {
    return m.job.stage === 'live'
      ? { ...base, action: 'note-only', note: 'already live' }
      : { ...base, action: 'set-stage', stage: 'live' };
  }
  if (c.kind === 'reject') return { ...base, action: 'set-stage', stage: 'closed' };
  if (c.kind === 'ack') {
    return { ...base, action: 'confirm-applied', date_applied: dateOnly(mail.date) };
  }
  return { ...base, action: 'note-only' };
}

function dateOnly(d) {
  const t = d ? new Date(d) : new Date();
  return isNaN(+t) ? null : t.toISOString().slice(0, 10);
}

export const _internals = { ATS_SENDERS, NO_REPLY, BULK_HEADERS, OPEN_STAGES };
