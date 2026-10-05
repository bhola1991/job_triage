#!/usr/bin/env node
// Read what beta testers actually said.
//
//   node scripts/read-feedback.js                # everything, newest first
//   node scripts/read-feedback.js --since 7      # last 7 days
//   node scripts/read-feedback.js --kind bug
//   node scripts/read-feedback.js --json         # for piping
//
// Why this is a script and not a screen in the app
// ------------------------------------------------
// public.feedback is RLS'd to `auth.uid() = user_id`, so signing into the app
// as yourself shows you YOUR feedback and nobody else's -- which is correct,
// and means there is no view of the table from inside the product. An admin
// screen would need either a loosened policy or the service role in a browser;
// both are a standing risk for something read once a day.
//
// So the reader is a script holding the service role on one machine. The
// trade is that feedback does not come to you -- you have to run this.
// Until the beta is bigger than a habit can cover, that is the right size.
//
// Anonymous rows (user_id null, via='anon') are readable ONLY here: the select
// policy can never match a null user_id, so not even the person who submitted
// one can read it back. That is deliberate -- they are not anybody's to read.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, 'supabase/.env'), 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const SB = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB || !SR) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in supabase/.env.');
  process.exit(1);
}

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const JSON_OUT = process.argv.includes('--json');
const LIMIT = Math.max(1, Number(arg('limit', 200)) || 200);
const KIND = arg('kind', null);
const SINCE = arg('since', null);

const rest = async (q) => {
  const r = await fetch(`${SB}/rest/v1/${q}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  if (!r.ok) throw new Error(`PostgREST ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

/* feedback.user_id and usernames.user_id both point at auth.users, but there
   is no foreign key BETWEEN them -- so PostgREST cannot embed one in the
   other, and the join happens here. Two queries rather than a view, because a
   view would be a migration for something only this script reads. */
const nameMap = async (ids) => {
  const out = new Map();
  if (!ids.length) return out;
  const rows = await rest(`usernames?select=user_id,username&user_id=in.(${ids.join(',')})`);
  rows.forEach((r) => out.set(r.user_id, r.username));
  return out;
};

const ago = (iso) => {
  const h = (Date.now() - new Date(iso)) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

(async () => {
  let q = `feedback?select=*&order=created_at.desc&limit=${LIMIT}`;
  if (KIND) q += `&kind=eq.${encodeURIComponent(KIND)}`;
  if (SINCE) {
    const iso = /^\d+$/.test(SINCE)
      ? new Date(Date.now() - Number(SINCE) * 864e5).toISOString()
      : new Date(SINCE).toISOString();
    q += `&created_at=gte.${iso}`;
  }
  const rows = await rest(q);

  if (JSON_OUT) { console.log(JSON.stringify(rows, null, 2)); return; }

  if (!rows.length) {
    console.log('No feedback yet.');
    console.log('\nTwo doors lead here, and it is worth knowing which is which when');
    console.log('nothing arrives:');
    console.log('  signed in  -> the Feedback button, straight to the table under RLS');
    console.log('  anonymous  -> the same button, via POST /api/feedback on the Worker');
    console.log('The anonymous door needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set as');
    console.log('Worker secrets. If it is not configured it answers 503 and the tester sees');
    console.log('"Feedback is not configured" -- so an empty table can mean nobody wrote, or');
    console.log('it can mean the Worker cannot. Check the Worker logs to tell them apart.');
    return;
  }

  const names = await nameMap([...new Set(rows.map((r) => r.user_id).filter(Boolean))]);
  const byKind = {};
  rows.forEach((r) => { byKind[r.kind] = (byKind[r.kind] || 0) + 1; });

  console.log(`${rows.length} report(s)${SINCE ? `, last ${SINCE}` : ''}  ` +
    Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join('  '));
  const anon = rows.filter((r) => !r.user_id).length;
  console.log(`${rows.length - anon} signed in, ${anon} anonymous\n`);

  for (const r of rows) {
    const who = r.user_id ? (names.get(r.user_id) || r.user_id.slice(0, 8)) : 'anonymous';
    const c = r.context || {};
    console.log(`── ${r.kind.toUpperCase()}  ${who}  ${ago(r.created_at)}  (#${r.id})`);
    if (r.reply_to) console.log(`   reply to: ${r.reply_to}`);
    /* The context block is the reason this form exists rather than an email:
       "it broke" is not a bug report, "it broke at 340 jobs, 0 scored, on
       flash" is. Printed on one line so a page of reports stays scannable. */
    const facts = [
      c.track && `track ${c.track}`,
      c.jobs !== undefined && `${c.jobs} jobs`,
      c.scored !== undefined && `${c.scored} scored`,
      c.model && `model ${c.model}`,
      c.theme && `${c.theme} theme`,
      c.busy && 'BUSY at the time',
    ].filter(Boolean);
    if (facts.length) console.log(`   ${facts.join(' · ')}`);
    if (c.agent) console.log(`   ${String(c.agent).slice(0, 100)}`);
    console.log(String(r.message || '').trim().split('\n').map((l) => '   ' + l).join('\n'));
    console.log();
  }
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
