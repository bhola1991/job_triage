// Row round-trip self-check: node scripts/selfcheck-rows.js
//
// A job in this app is 27 strings. A row in Postgres is typed. The two are
// bridged by jobRow/coerceJob, and this asserts the bridge is lossless --
// because every way it can leak is silent, and two of them cost money.
//
// The one that proves the point: isScored() is
//   String(j.ai_score||'').trim() !== ''
// so a fit of exactly 0 stored in an int column comes back as the number 0,
// and 0||'' is ''. The job reads as never scored, gets scored again, and is
// still 0 next time. It would have re-scored that job on every run, forever,
// one credit at a time, and nothing anywhere would have said so.
const h = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const grab = re => { const m = h.match(re); if (!m) throw new Error('missing ' + re); return m[0]; };

const src = [
  grab(/const COLS = \[[\s\S]*?\];\n/),
  grab(/function keyOf[\s\S]*?\n}\n/),
  grab(/const usable = [^\n]*\n/),
  grab(/function blank\(\)[^\n]*\n/),
  grab(/const JOB_INT[\s\S]*?\nfunction coerceProfile[\s\S]*?\n}\n/),
].join('\n');

// today() is used by blank() and declared far above the slice.
const today = () => '2026-09-22';
const T = new Function('today', src +
  ';return {COLS,blank,keyOf,jobRow,coerceJob,profileRow,coerceProfile,JOB_TEXT};')(today);

const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + '\n  want ' + JSON.stringify(b) + '\n  got  ' + JSON.stringify(a));

/* Postgres does not hand back what the browser sent: jsonb arrives parsed, an
   int arrives as a number, and an absent value arrives as null rather than the
   empty string the app uses everywhere. Round-tripping through JSON here is
   not decoration -- it is the half of the trip that does the damage. */
const wire = row => JSON.parse(JSON.stringify(row));
const trip = j => T.coerceJob(wire(T.jobRow(j)));

// ---- the zero-score trap -------------------------------------------------
const zero = Object.assign(T.blank(), { title: 'Z', company: 'C', ai_score: '0', ai_reachability: '0' });
const z2 = trip(zero);
ok(z2.ai_score === '0', 'a fit of 0 survives as the string "0", not "" (got ' + JSON.stringify(z2.ai_score) + ')');
ok(String(z2.ai_score || '').trim() !== '', 'isScored() still says a 0-scored job is scored');
eq(z2, zero, 'zero-scored job round-trips whole');

// ---- an ordinary scored job ----------------------------------------------
const full = Object.assign(T.blank(), {
  title: 'Senior Backend Engineer', company: 'Acme', location: 'Remote',
  url: 'https://boards.greenhouse.io/acme/jobs/4455', description: 'Go and Postgres.',
  status: 'Applied', date_applied: '2026-09-01', follow_up_date: '2026-10-15',
  pitch_sent: 'Yes', notes: 'referred by a friend', source: 'ATS', query: 'backend',
  ai_score: '88', ai_reason: 'strong on the work', ai_flags: 'strong_fit,high_competition',
  ai_confidence: 'high', ai_reachability: '41', channel: 'posted', stage: 'sent',
  last_touch: '2026-09-20', contacts: '[{"name":"Dana","role":"HR"}]',
  events: '[{"on":"2026-09-01","kind":"sent","text":"applied"}]',
  added: '2026-08-30', posted: '2026-08-25', posted_lo: '2026-08-20',
  posted_hi: '2026-08-30', posted_src: 'feed',
});
eq(trip(full), full, 'a fully populated job round-trips whole');

// A blank row is the common case: every door starts here.
eq(trip(T.blank()), T.blank(), 'a blank job round-trips whole');

// ---- values a typed column cannot hold -----------------------------------
/* onCsv copies cells in verbatim -- no date parsing, no number check. The app
   has shown these back to the person ever since, so a "migration" that drops
   them is an edit to their data, not a cleanup. */
const messy = Object.assign(T.blank(), {
  title: 'M', company: 'C',
  date_applied: '12/03/2025',          // a date, but not to Postgres
  follow_up_date: 'next tuesday',      // not a date at all
  ai_score: '72.5',                    // a fit with a decimal point
  ai_reachability: 'high',             // a word in a number column
  contacts: 'not json at all',
});
eq(trip(messy), messy, 'values no typed column can hold survive via extras');

const row = T.jobRow(messy);
ok(row.date_applied === null && row.extras.date_applied === '12/03/2025', 'an unparseable date lands in extras, not in the date column');
ok(row.ai_score === 72 && row.extras.ai_score === '72.5', 'a fractional score keeps its column AND its exact value');
ok(row.ai_reachability === null && row.extras.ai_reachability === 'high', 'a word in an int column is kept, not dropped');

// extras stays empty when nothing needs rescuing -- otherwise every row would
// carry a second copy of itself.
eq(T.jobRow(full).extras, {}, 'a well-formed job needs no extras');

// ---- the column that is not in COLS --------------------------------------
const org = Object.assign(T.blank(), { title: 'O', company: 'C', origin: 'jsearch' });
ok(trip(org).origin === 'jsearch', 'origin survives, though COLS has never known about it');
ok(!('origin' in trip(T.blank())), 'origin stays absent when it was never set');

// ---- the row is typed where it can be -----------------------------------
const r = T.jobRow(full);
ok(typeof r.ai_score === 'number' && r.ai_score === 88, 'ai_score reaches Postgres as an int');
ok(Array.isArray(r.contacts) && r.contacts[0].name === 'Dana', 'contacts reaches Postgres as jsonb');
ok(r.job_key === 'u:https://boards.greenhouse.io/acme/jobs/4455', 'job_key is keyOf, the identity the app already uses');
ok(T.jobRow(Object.assign(T.blank(), { title: 'T', company: 'C', location: 'L' })).job_key === 't:t|c|l', 'a job with no url keys on title|company|location');

// ---- profiles ------------------------------------------------------------
const prof = {
  profile: {
    name: 'Alex', location: 'Bengaluru', country: 'India', country_code: 'in',
    headline: 'backend engineer', years_experience: 9, seniority: 'senior',
    domains: ['fintech'], strengths: ['Go', 'Postgres'], hard_skills: ['go', 'aws'],
    unusual_combination: 'payments plus infra', gaps: ['no k8s'], wrong_shapes: ['management'],
    tracks: [{ id: 'be', label: 'Backend', difficulty: 'easy', why: 'w', mode: 'permanent', titles: ['SRE'], boards: ['x.com'] }],
  },
  raw: 'the whole CV text', track: 'be', jobs: [], created: '2026-08-01',
};
const pr = T.coerceProfile(wire(T.profileRow('p_abc', prof)));
eq(pr, prof, 'a profile record round-trips whole');
ok(T.profileRow('p_abc', prof).cv_text === 'the whole CV text', 'raw is stored as cv_text');
ok(T.profileRow('p_abc', prof).local_id === 'p_abc', 'the app’s own profile key is preserved');

// A field the extraction prompt returned that has no column of its own.
const odd = JSON.parse(JSON.stringify(prof));
odd.profile.favourite_colour = 'green';
ok(T.coerceProfile(wire(T.profileRow('p_x', odd))).profile.favourite_colour === 'green', 'an unknown profile field is kept rather than dropped');

/* usable() is !!(p && p.profile). A record without one is broken, and the app
   routes past it -- but it may still hold jobs, so normalising it into a
   profile-shaped object would make it look repaired when it is not. */
const broken = { raw: 'x', jobs: [], created: '2026-01-01' };
const b2 = T.coerceProfile(wire(T.profileRow('p_b', broken)));
eq(b2, broken, 'a record with no .profile is stored verbatim and comes back broken, not fake-repaired');

console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASS');
