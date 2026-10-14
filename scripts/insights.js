#!/usr/bin/env node
// What the beta testers actually did, and what that says.
//
//   node scripts/insights.js                    # since the invites, and the last 24h
//   node scripts/insights.js --start 2026-10-13 # a different beta start
//   node scripts/insights.js --hours 72         # a wider "recent" window
//
// Run every morning by scripts/morning.sh. Like read-feedback.js it holds the
// service role on one machine: public.activity and public.feedback have no
// view from inside the app, on purpose.
//
// Why there is no model in here
// -----------------------------
// With five to thirty testers, every number below is a COUNT of named people,
// small enough to check by reading the table above it. A summary written by a
// model would be more fluent and less checkable, and would happily turn "2 of
// 5" into "40% of users". So the insights are rules: each one fires on a count,
// prints the count and who it is, and says nothing when it does not fire.
//
// It reads everything and writes nothing.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, 'supabase/.env'), 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const SB = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB || !SR) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in supabase/.env.'); process.exit(1); }

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
// The day the invites went out. Accounts older than this are still testers;
// this only bounds what counts as "during the beta".
const START_DAY = arg('start', '2026-10-13');
const START = new Date(START_DAY + 'T00:00:00+05:30');
const HOURS = +arg('hours', 24);
const NOW = new Date(), RECENT = new Date(NOW - HOURS * 36e5);

const H = { apikey: SR, Authorization: `Bearer ${SR}` };
async function rows(table, query) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${SB}/rest/v1/${table}?${query}&limit=1000&offset=${off}`, { headers: H, signal: AbortSignal.timeout(30e3) });
    if (!r.ok) throw new Error(`${table}: ${r.status} ${(await r.text()).slice(0, 120)}`);
    const page = await r.json(); out.push(...page);
    if (page.length < 1000) return out;
  }
}
const ist = (d) => d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
const ago = (d) => { if (!d) return 'never'; const h = (NOW - new Date(d)) / 36e5; return h < 1 ? `${Math.round(h * 60)}m ago` : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`; };
const by = (list, key) => { const m = new Map(); list.forEach((x) => { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; };
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const names = (list) => list.map((t) => t.name).join(', ');
const have = (k) => `${k} ${k === 1 ? 'has' : 'have'}`;

(async () => {
  const since = encodeURIComponent(START.toISOString());
  const ur = await fetch(`${SB}/auth/v1/admin/users?per_page=1000`, { headers: H, signal: AbortSignal.timeout(30e3) });
  if (!ur.ok) throw new Error(`users: ${ur.status}`);
  const users = (await ur.json()).users || [];
  const [credits, profiles, jobs, usage, feedback, mail, activity, blobs] = await Promise.all([
    rows('credits', 'select=user_id,tester,unlimited,free_search,free_llm,balance'),
    rows('profiles', 'select=id,user_id,created_at,intent,inbox_token&deleted=is.false'),
    rows('jobs', 'select=user_id,stage,ai_score,created_at,date_applied&deleted=is.false'),
    rows('usage_events', `select=user_id,kind,source,cost_inr,created_at,note,search_id&created_at=gte.${since}`),
    rows('feedback', `select=user_id,kind,message,context,via,created_at&created_at=gte.${since}&order=created_at.desc`),
    rows('inbound_mail', `select=user_id,created_at,decision,applied_stage&created_at=gte.${since}`),
    rows('activity', `select=user_id,at,kind,detail&at=gte.${since}&order=at.asc`),
    /* Who has a profile in the old one-blob storage. Only the user_id comes
       back: the blob is somebody's whole CV and there is no reason to read it
       to learn that it exists. */
    rows('user_state', `select=user_id&k=eq.triage:db&v=like.${encodeURIComponent('*"profile":{*')}`),
  ]);
  const hasBlob = new Set(blobs.map((b) => b.user_id));

  const cr = new Map(credits.map((c) => [c.user_id, c]));
  const g = (list) => by(list, (x) => x.user_id);
  const P = g(profiles), J = g(jobs), U = g(usage), F = g(feedback), M = g(mail), A = g(activity);
  const recent = (list, f) => (list || []).filter((x) => new Date(x[f]) >= RECENT);

  const people = users.map((u) => {
    const id = u.id, c = cr.get(id) || {}, js = J.get(id) || [], us = U.get(id) || [], ac = A.get(id) || [];
    const realMail = (M.get(id) || []).filter((m) => (m.decision || {}).action !== 'show-code');
    const lastAct = ac.length ? ac[ac.length - 1].at : null;
    const seen = [u.last_sign_in_at, lastAct].filter(Boolean).sort().pop() || null;
    const t = {
      id, name: (u.user_metadata || {}).username || '(no username)', owner: !!c.unlimited,
      joined: u.created_at, seen,
      opened: ac.some((a) => a.kind === 'open') || (u.last_sign_in_at && new Date(u.last_sign_in_at) >= START),
      profile: (P.get(id) || []).length > 0 || hasBlob.has(id),
      /* The signature of a row save that never landed: a profile in the blob,
         none in the tables, on an account that has opened the app since rows
         became the storage. This is how a tester lost a finished onboarding on
         2026-10-13 -- worth a line of its own every morning it is true. */
      unsaved: hasBlob.has(id) && !(P.get(id) || []).length && ac.some((a) => a.kind === 'open'),
      searches: new Set(us.filter((e) => e.search_id).map((e) => e.search_id)).size,
      jobs: js.length, scored: js.filter((j) => j.ai_score != null && j.ai_score !== '').length,
      jobOpens: ac.filter((a) => a.kind === 'job_open').length,
      applied: js.filter((j) => ['sent', 'live'].includes(j.stage) || (j.stage === 'closed' && j.date_applied)).length,
      live: js.filter((j) => j.stage === 'live').length,
      fwd: (P.get(id) || []).some((p) => p.inbox_token),
      mail: realMail.length, feedback: (F.get(id) || []).length,
      errors: ac.filter((a) => a.kind === 'error'),
      lastView: (ac.filter((a) => a.kind === 'view').pop() || { detail: {} }).detail.view || '',
      cost: us.reduce((n, e) => n + (+e.cost_inr || 0), 0),
      free: c.unlimited ? '∞' : `${c.free_search ?? '?'}s/${c.free_llm ?? '?'}ai`,
      freeSearch: c.free_search, active: !!seen && new Date(seen) >= RECENT,
      actsRecent: recent(ac, 'at').length,
    };
    /* How far they got. Each step implies the ones before it for the purpose
       of "where did they stop", even where the evidence for an earlier step is
       missing -- activity tracking began partway through the beta. */
    const steps = [true, t.opened, t.profile, t.searches > 0 || t.jobs > 0, t.scored > 0, t.jobOpens > 0 || t.applied > 0, t.applied > 0, t.fwd, t.mail > 0];
    t.reached = steps.lastIndexOf(true); t.steps = steps;
    return t;
  }).sort((a, b) => String(b.seen || '').localeCompare(String(a.seen || '')));

  const testers = people.filter((t) => !t.owner);
  const n = testers.length;
  const STEP = ['has an account', 'opened the app', 'added a CV', 'ran a search', 'has scored jobs', 'opened a job', 'marked one applied', 'set up forwarding', 'received mail'];
  const out = [];
  const say = (s = '') => out.push(s);

  say(`JOB TRIAGE BETA — ${ist(NOW)} IST`);
  say(`Beta counted from ${START_DAY}; "recent" = last ${HOURS}h. ${n} tester account(s), plus ${people.length - n} owner account(s) left out of every count.`);
  say();

  /* ── the people ─────────────────────────────────────────────────────────── */
  say('WHO');
  say('  ' + [pad('tester', 14), pad('last seen', 9), pad('CV', 3), pad('srch', 4), pad('jobs', 5), pad('scored', 6), pad('opened', 6), pad('applied', 7), pad('fwd', 3), pad('mail', 4), pad('fb', 2), pad('free left', 10), 'spent'].join(' '));
  people.forEach((t) => say('  ' + [pad(t.name + (t.owner ? ' (you)' : ''), 14), pad(ago(t.seen), 9), pad(t.profile ? 'yes' : 'no', 3), pad(t.searches, 4), pad(t.jobs, 5), pad(t.scored, 6),
    pad(t.jobOpens, 6), pad(t.applied, 7), pad(t.fwd ? 'yes' : 'no', 3), pad(t.mail, 4), pad(t.feedback, 2), pad(t.free, 10), '₹' + t.cost.toFixed(2)].join(' ')));
  say('  ("opened" counts job opens since activity tracking began on 2026-10-13; it is 0 for anything before that.)');
  say();

  /* ── the funnel ─────────────────────────────────────────────────────────── */
  say('HOW FAR EACH HAS EVER GOT   (of ' + n + ' testers; includes before the invites)');
  STEP.forEach((label, i) => {
    const got = testers.filter((t) => t.reached >= i);
    const stopped = testers.filter((t) => t.reached === i);
    say(`  ${pad(got.length + '/' + n, 6)} ${pad(label, 20)}${stopped.length && i < STEP.length - 1 ? '  stopped here: ' + names(stopped) : ''}`);
  });
  say();

  /* ── the recent window ──────────────────────────────────────────────────── */
  const recAct = recent(activity.filter((a) => !(people.find((p) => p.id === a.user_id) || {}).owner), 'at');
  const kinds = [...by(recAct, (a) => a.kind)].map(([k, v]) => `${k} ${v.length}`).sort();
  say(`LAST ${HOURS}H`);
  say(`  active testers: ${testers.filter((t) => t.active).length}/${n}${testers.some((t) => t.active) ? ' — ' + names(testers.filter((t) => t.active)) : ''}`);
  say(`  actions logged: ${recAct.length}${kinds.length ? ' — ' + kinds.join(', ') : ''}`);
  const recUse = recent(usage, 'created_at');
  say(`  searches: ${new Set(recUse.filter((e) => e.search_id).map((e) => e.search_id)).size} · scoring calls: ${recUse.filter((e) => e.kind === 'llm').length} · cost: ₹${recUse.reduce((s, e) => s + (+e.cost_inr || 0), 0).toFixed(2)}`);
  say();

  /* ── what broke ─────────────────────────────────────────────────────────── */
  const srvErr = usage.filter((e) => e.kind === 'error' && e.source !== 'heartbeat');
  const cliErr = testers.flatMap((t) => t.errors.map((e) => ({ ...e, name: t.name })));
  say('WHAT BROKE   (since the beta began)');
  if (!srvErr.length && !cliErr.length) say('  nothing recorded.');
  [...by(srvErr, (e) => `${e.source}: ${String(e.note || '').slice(0, 90)}`)].sort((a, b) => b[1].length - a[1].length).slice(0, 8)
    .forEach(([k, v]) => say(`  server ×${v.length}  ${k}  (last ${ist(v[v.length - 1].created_at)})`));
  [...by(cliErr, (e) => String((e.detail || {}).msg || '').slice(0, 90))].sort((a, b) => b[1].length - a[1].length).slice(0, 8)
    .forEach(([k, v]) => say(`  browser ×${v.length}  ${k}  — ${[...new Set(v.map((e) => e.name))].join(', ')}`));
  say();

  /* ── what they said ─────────────────────────────────────────────────────── */
  say(`WHAT THEY SAID   (${feedback.length} since the beta began, ${recent(feedback, 'created_at').length} in the last ${HOURS}h)`);
  if (!feedback.length) say('  nothing yet.');
  feedback.slice(0, 15).forEach((f) => {
    const who = (people.find((p) => p.id === f.user_id) || {}).name || 'anonymous';
    say(`  [${f.kind}] ${who}, ${ist(f.created_at)}: ${String(f.message || '').replace(/\s+/g, ' ').slice(0, 300)}`);
  });
  say();

  /* ── what it adds up to ─────────────────────────────────────────────────── */
  const ins = [];
  const unsaved = testers.filter((t) => t.unsaved);
  if (unsaved.length) ins.push(`DATA AT RISK — ${have(unsaved.length)} a profile that was never saved to the tables: ${names(unsaved)}. They see an empty app on reload. The app restores it from the backup copy on their next visit; if this line is still here tomorrow for the same person, that did not work.`);
  const noOpen = testers.filter((t) => !t.opened);
  if (noOpen.length) ins.push(`${have(noOpen.length)} not opened the app since the invites (of ${n}): ${names(noOpen)}. Nothing to learn from them yet — a nudge is the only move.`);
  const noCv = testers.filter((t) => t.opened && !t.profile);
  if (noCv.length) ins.push(`${have(noCv.length)} opened it and never added a CV: ${noCv.map((t) => t.name + (t.lastView ? ` (last screen ${t.lastView})` : '')).join(', ')}. That is the first screen losing them, before the product has shown anything.`);
  const noSearch = testers.filter((t) => t.profile && t.searches === 0 && t.jobs === 0);
  if (noSearch.length) ins.push(`${have(noSearch.length)} a profile and no jobs: ${names(noSearch)}. They got through onboarding and did not search — look at what the screen after onboarding asks of them.`);
  const lookers = testers.filter((t) => t.scored > 0 && t.applied === 0);
  if (lookers.length) ins.push(`${have(lookers.length)} scored jobs and applied to none: ${lookers.map((t) => `${t.name} (${t.scored} scored, ${t.jobOpens} opened)`).join(', ')}. Opened-but-not-applied means the jobs did not convince; never-opened means the list did not.`);
  const appliers = testers.filter((t) => t.applied > 0);
  const noFwd = appliers.filter((t) => !t.fwd);
  if (appliers.length) ins.push(`${have(appliers.length)} applied to something, of ${n} (${appliers.map((t) => `${t.name} ${t.applied}`).join(', ')}).` + (noFwd.length ? ` Of those, ${have(noFwd.length)} not set up mail forwarding: ${names(noFwd)} — reply tracking does nothing for them.` : ' All of them set up mail forwarding.'));
  const silentFwd = testers.filter((t) => t.fwd && t.mail === 0);
  if (silentFwd.length) ins.push(`${have(silentFwd.length)} set up forwarding and received no mail: ${names(silentFwd)}. Either no reply yet, or the Gmail filter was never saved — worth asking.`);
  const replies = testers.filter((t) => t.live > 0);
  if (replies.length) ins.push(`${have(replies.length)} a job in conversation: ${replies.map((t) => `${t.name} ${t.live}`).join(', ')}. This is the one outcome the product exists for.`);
  const dry = testers.filter((t) => typeof t.freeSearch === 'number' && t.freeSearch <= 2);
  if (dry.length) ins.push(`${dry.length} ${dry.length === 1 ? 'is' : 'are'} nearly out of free searches: ${dry.map((t) => `${t.name} (${t.freeSearch} left)`).join(', ')}. They are your heaviest users and are about to hit a wall — top them up or they stop.`);
  if (cliErr.length) ins.push(`${cliErr.length} browser error(s) hit ${new Set(cliErr.map((e) => e.name)).size} tester(s). See WHAT BROKE; each is something a tester saw and you did not.`);
  if (srvErr.length) ins.push(`${srvErr.length} server-side failure(s) since the beta began. See WHAT BROKE.`);
  const quietFb = testers.filter((t) => t.jobs > 0 && t.feedback === 0);
  if (quietFb.length && n) ins.push(`${have(quietFb.length)} used it and said nothing: ${names(quietFb)}. The Feedback button is not reaching them; ask directly.`);

  say('WHAT IT ADDS UP TO');
  if (!ins.length) say('  Nothing stands out yet.');
  ins.forEach((s, i) => say(`  ${i + 1}. ${s}`));
  say();
  say(`  Read these as counts of ${n} named people, not as rates. With this few testers one person is ${n ? Math.round(100 / n) : 0} points; nothing here generalises.`);
  say();

  const totalCost = usage.filter((e) => !(people.find((p) => p.id === e.user_id) || {}).owner).reduce((s, e) => s + (+e.cost_inr || 0), 0);
  // One line for the notification. morning.sh reads the last SUMMARY: line.
  say(`SUMMARY: active ${testers.filter((t) => t.active).length}/${n} · applied ${appliers.length} · new feedback ${recent(feedback, 'created_at').length} · errors ${cliErr.length + srvErr.length} · testers spent ₹${totalCost.toFixed(0)}`);
  console.log(out.join('\n'));
})().catch((e) => { console.error('insights failed:', e.message); process.exit(1); });
