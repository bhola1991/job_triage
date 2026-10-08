#!/usr/bin/env node
// Is the LIVE system actually working? Not the code -- the system.
//
//   node scripts/heartbeat.js            # exit 0 healthy, 1 not
//   node scripts/heartbeat.js --quiet    # print only problems
//
// Why this exists
// ---------------
// On 2026-10-08 two things were broken in production at the same time and
// NOTHING reported either, because both failures look exactly like disuse:
//
//   - the nightly corpus refresh had been frozen since 10-07, behind a socket
//     with no timeout. systemd said the timer was enabled and active and the
//     previous run was Result=success, because the run had never exited. A
//     timer will not schedule its next firing while its service is still
//     active, so one dead socket silently cancelled every following night.
//   - the DeepSeek account was at 402 Insufficient Balance, so scoring and
//     drafting were dead. The ledger's last DeepSeek row was 10-05 and nothing
//     had attempted a call since, so an empty balance and a feature nobody
//     used are indistinguishable from the data.
//
// The eight checks in CLAUDE.md §8 are all offline and all about code. Every
// one of them passed through both of those days. This is the other kind: it
// asks the live system questions whose answers code cannot predict.
//
// On failure it writes ONE row to usage_events (kind 'error', source
// 'heartbeat') so the outage has a queryable history, and exits non-zero so
// the systemd unit that runs it reports a failure rather than a success.
// Nothing is written when healthy -- a heartbeat that logs every success is a
// table nobody reads.
//
// A missing credential is a loud SKIP, never a pass: the whole point is that
// silence must not look like health.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const loadEnv = (p) => {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
};
loadEnv(path.join(ROOT, 'supabase/.env'));
loadEnv(path.join(ROOT, '.env.local'));

const QUIET = process.argv.includes('--quiet');
/* Set by refresh.sh when the heartbeat runs as the last step of the nightly
   pass. The unit check has to be skipped there, because at that moment THIS
   process is the service: ActiveState is `activating` by definition, and a
   legitimately long crawl would report itself as the very hang the check
   exists to find. Everything else -- corpus freshness, balances -- is exactly
   as meaningful from inside the run as from outside it. */
const IN_REFRESH = process.argv.includes('--in-refresh');
/* 26 hours, not 24: the timer fires at 04:00 with up to 30 minutes of jitter
   and the pass itself takes ~9 minutes, so a healthy system can legitimately
   be a little over a day since its last write. Two missed nights is 50h, so
   this still catches the failure it was written for on the first morning. */
const CORPUS_MAX_AGE_H = 26;
const DEEPSEEK_MIN_USD = 1.00;
/* A run of the refresh takes ~9 minutes. Anything still `activating` after an
   hour is the hang, not a slow night. */
const STUCK_AFTER_H = 1;

const fails = [], skips = [], notes = [];
const fail = (m) => fails.push(m);
const skip = (m) => skips.push(m);
const note = (m) => notes.push(m);

const get = async (url, init = {}) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
  return r.json();
};

/* ── 1. is the corpus still being fed? ─────────────────────────────────────
   The question the frozen timer needed asked. Compared as an INSTANT, not a
   date: the database is UTC and the machine that runs the crawl is IST, so
   `max(updated_at)::date = current_date` reads false for hours after a
   perfectly good run. Comparing dates is how this check lies in the
   reassuring direction. */
async function corpus() {
  const SB = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB || !SR) return skip('corpus: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (supabase/.env)');
  const rows = await get(`${SB}/rest/v1/job_index?select=updated_at&order=updated_at.desc&limit=1`,
    { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  if (!rows.length) return fail('corpus: job_index is EMPTY');
  const ageH = (Date.now() - Date.parse(rows[0].updated_at)) / 36e5;
  const msg = `corpus: last written ${ageH.toFixed(1)}h ago`;
  if (ageH > CORPUS_MAX_AGE_H) fail(`${msg} — over ${CORPUS_MAX_AGE_H}h, the nightly refresh is not landing`);
  else note(msg);
}

/* ── 2. can we still pay for a model call? ─────────────────────────────────
   /user/balance is free and needs no call to be made, so this answers "would
   scoring work" without spending anything to find out. The balance going to
   zero is invisible everywhere else until someone tries to score. */
async function deepseek() {
  const k = process.env.DEEPSEEK_API_KEY;
  if (!k) return skip('deepseek: DEEPSEEK_API_KEY not in the environment (it comes from the shell profile)');
  const d = await get('https://api.deepseek.com/user/balance', { headers: { Authorization: `Bearer ${k}` } });
  const bal = Number((d.balance_infos || []).find((b) => b.currency === 'USD')?.total_balance ?? NaN);
  if (!d.is_available) return fail('deepseek: the account reports is_available=false — scoring and drafting are dead');
  if (!isFinite(bal)) return fail('deepseek: could not read a USD balance from /user/balance');
  if (bal < DEEPSEEK_MIN_USD) fail(`deepseek: balance $${bal.toFixed(2)}, under $${DEEPSEEK_MIN_USD.toFixed(2)} — scoring will start failing with 402`);
  else note(`deepseek: available, $${bal.toFixed(2)}`);
}

/* ── 3. the contact finder's credits ───────────────────────────────────────
   A warning, not a failure: the HR lookup is one feature and it falls back to
   Apify when Mantiks has nothing left. Worth seeing before it runs out. */
async function mantiks() {
  const k = process.env.MANTIKS_API_KEY;
  if (!k) return skip('mantiks: MANTIKS_API_KEY not set (.env.local)');
  const d = await get('https://dashboard.mantiks.io/api/v2/credits/balance', { headers: { 'X-API-KEY': k } });
  const c = Number(d.leads_credits);
  if (!isFinite(c)) return skip('mantiks: no leads_credits in the reply');
  note(`mantiks: ${c} leads credit(s)${c === 0 ? ' — the contact finder will fall back to Apify' : ''}`);
}

/* ── 4. is the refresh stuck rather than finished? ─────────────────────────
   The exact shape of the 10-07 failure, and the one check that would have
   caught it the same morning: a unit that has been `activating` for hours is
   not a slow run, and while it stays that way no further night is scheduled.
   Local-only, so it skips anywhere but the machine that runs the crawl. */
/* Reading the timestamp is the fiddly part, and getting it wrong made the
   first version of this check USELESS in exactly the case it exists for.
   systemd's default format is `Thu 2026-10-08 04:48:15 IST`, and
   Date.parse() returns NaN on that -- the day name and the zone abbreviation
   defeat it. So `isFinite(ageH)` was false, the stuck branch never ran, and a
   hung unit would have been reported as merely `activating`.

   --timestamp=unix gives `@1791415095` and is exact. Older systemd does not
   have the flag, so the fallback strips the day name and the zone and parses
   the plain local datetime, which V8 does handle. Both were checked against a
   real unit and agreed to 0.01h.

   StateChangeTimestampMonotonic is deliberately NOT used: it is microseconds
   since boot, and on a laptop that suspends it disagreed with /proc/uptime by
   49 hours on the machine this was written on. */
function unitStateAgeH(unit) {
  const run = (cmd) => {
    try { return require('child_process').execSync(cmd, { encoding: 'utf8' }); }
    catch { return ''; }
  };
  const u = run(`systemctl --user show --timestamp=unix ${unit} -p StateChangeTimestamp 2>/dev/null`);
  const epoch = /StateChangeTimestamp=@(\d+)/.exec(u);
  if (epoch) return (Date.now() - Number(epoch[1]) * 1000) / 36e5;
  const h = run(`systemctl --user show ${unit} -p StateChangeTimestamp 2>/dev/null`);
  const plain = /StateChangeTimestamp=(?:\w{3}\s+)?(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/.exec(h);
  if (plain) {
    const t = Date.parse(plain[1]);
    if (isFinite(t)) return (Date.now() - t) / 36e5;
  }
  return NaN;
}

function refreshUnit() {
  const UNIT = 'jobtriage-refresh.service';
  if (IN_REFRESH) {
    return skip(`refresh unit: not checked from inside the run — this process IS ${UNIT}`);
  }
  let out;
  try {
    out = require('child_process')
      .execSync(`systemctl --user show ${UNIT} -p ActiveState 2>/dev/null`, { encoding: 'utf8' });
  } catch { return skip('refresh unit: no systemd user session here (not the crawl machine)'); }
  const state = /ActiveState=(\S+)/.exec(out)?.[1];
  if (!state) return skip('refresh unit: systemd did not report ActiveState');
  if (state === 'failed') {
    return fail(`refresh unit: ${state} — the last run exited non-zero; journalctl --user -u ${UNIT}`);
  }
  if (state !== 'activating') return note(`refresh unit: ${state}`);

  const ageH = unitStateAgeH(UNIT);
  /* An unreadable timestamp on an `activating` unit FAILS rather than passes.
     Not knowing how long it has been running is not evidence that it is fine,
     and treating it as fine is the bug this comment exists to prevent. */
  if (!isFinite(ageH)) {
    return fail(`refresh unit: activating, and its StateChangeTimestamp could not be read — ` +
      `cannot tell a running pass from the 17-hour hang. Check: systemctl --user status ${UNIT}`);
  }
  if (ageH > STUCK_AFTER_H) {
    fail(`refresh unit: STUCK — activating for ${ageH.toFixed(1)}h. While it stays active the timer schedules ` +
         `no further run, so every following night is silently cancelled. ` +
         `Fix: systemctl --user stop ${UNIT} (Persistent=true then catches the missed night)`);
  } else {
    note(`refresh unit: activating for ${ageH.toFixed(1)}h — a pass takes ~9 min`);
  }
}

/* A failed heartbeat is the only thing worth a row. units 0 and no user: the
   same shape the source-failure rows already use. Best-effort -- a ledger
   write must never be the reason a health check cannot report. */
async function record(reasons) {
  const SB = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB || !SR) return;
  try {
    await fetch(`${SB}/rest/v1/usage_events`, {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify([{ user_id: null, kind: 'error', source: 'heartbeat', units: 0,
        note: reasons.join(' | ').slice(0, 300) }]),
    });
  } catch (e) { console.error('  (could not log the failure: ' + e.message + ')'); }
}

(async () => {
  for (const [name, fn] of [['corpus', corpus], ['deepseek', deepseek], ['mantiks', mantiks]]) {
    try { await fn(); } catch (e) { fail(`${name}: ${e.message}`); }
  }
  try { refreshUnit(); } catch (e) { skip(`refresh unit: ${e.message}`); }

  if (!QUIET) notes.forEach((m) => console.log('  ok    ' + m));
  skips.forEach((m) => console.log('  SKIP  ' + m));
  fails.forEach((m) => console.log('  FAIL  ' + m));

  if (fails.length) {
    await record(fails);
    console.log(`\n${fails.length} PROBLEM(S) — logged to usage_events as source='heartbeat'`);
    process.exitCode = 1;
  } else if (!QUIET) {
    console.log(skips.length ? `\nHEALTHY (with ${skips.length} skip(s) — a SKIP is not a pass)` : '\nHEALTHY');
  }
})().catch((e) => { console.error('heartbeat failed to run:', e.message); process.exit(1); });
