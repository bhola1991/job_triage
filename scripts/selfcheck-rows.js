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
/* The read side ALWAYS sets intent, strict and limits, so a record written
   before those columns existed comes back with them rather than with holes --
   that is deliberate, and it is why the expected shape here carries them while
   the input above does not. See INTAKE.md. */
const withIntake = JSON.parse(JSON.stringify(prof));
Object.assign(withIntake.profile, {
  intent: 'browsing', strict: 2,
  limits: { relocate: true, onsite_ok: true, min_pay: 0, avoid: [] },
});
eq(pr, withIntake, 'a profile record round-trips whole, with the intake defaults filled in');

/* ── what the person wants, defaulted so nothing regresses ────────────────
   Every one of these defaults has to mean "behave exactly as before". A
   profile that predates the columns must not acquire a red line, and
   `strict` must not land on its MINIMUM: Number(null) is 0, which clamped to
   1 -- the loosest band -- instead of the balanced 2 everything was tuned at.
   That was a real bug in the first version of strictOf. */
ok(pr.profile.intent === 'browsing', 'a profile with no intent reads back as browsing, not undefined');
ok(pr.profile.strict === 2, 'a profile with no strict reads back as the DEFAULT 2, not the minimum 1: ' + pr.profile.strict);
ok(typeof pr.profile.limits === 'object' && !Array.isArray(pr.profile.limits),
  'limits round-trips as an object, not the [] PROF_JSON would have made it');
ok(pr.profile.limits.relocate === true && pr.profile.limits.onsite_ok === true,
  'the limit defaults are PERMISSIVE — false would gate every job for every old profile');

// Values the person actually chose must survive, including through extras.
const wants = JSON.parse(JSON.stringify(prof));
Object.assign(wants.profile, { intent: 'now', strict: 3, exemplar: 'Senior Editor at Acme',
  limits: { relocate: false, onsite_ok: false, min_pay: 80000, avoid: ['agency'] } });
const w = T.coerceProfile(wire(T.profileRow('p_w', wants))).profile;
ok(w.intent === 'now' && w.strict === 3, 'chosen intent and strict survive the round trip: ' + w.intent + '/' + w.strict);
ok(typeof w.strict === 'number', 'strict comes back a NUMBER, not the string PROF_TEXT would have made it');
ok(w.exemplar === 'Senior Editor at Acme', 'the exemplar survives');
ok(w.limits.min_pay === 80000 && w.limits.avoid.join() === 'agency' && w.limits.relocate === false,
  'real limits survive: ' + JSON.stringify(w.limits));
// An unknown intent is not a third state the gates have to handle.
const junk = JSON.parse(JSON.stringify(prof));
junk.profile.intent = 'whenever'; junk.profile.strict = 99;
const jr = T.coerceProfile(wire(T.profileRow('p_j', junk))).profile;
ok(jr.intent === 'browsing', 'an unknown intent falls back to browsing: ' + jr.intent);
ok(jr.strict === 3, 'an out-of-range strict clamps rather than passing through: ' + jr.strict);
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

/* inbox_token is set once by the Replies panel and read by the Email Worker to
   route a forwarded reply. saveRows() upserts a whole profile row, and
   PostgREST only SETs the columns a request body names -- so the token
   survives exactly as long as profileRow() keeps not naming it. If it ever
   does, every routine profile save silently nulls the address and inbound mail
   starts landing on an unknown token, which looks like "forwarding stopped
   working" and has nothing to do with forwarding. Both branches are checked
   because the broken-profile branch builds its own key set. */
{
  const keys = (r) => Object.keys(r);
  ok(!keys(T.profileRow('p_abc', prof)).includes('inbox_token'),
    'profileRow does not name inbox_token, so an upsert cannot wipe it');
  ok(!keys(T.profileRow('p_broken', { nope: true })).includes('inbox_token'),
    'the broken-profile branch does not name inbox_token either');
  /* PostgREST's batch upsert unions the keys across the array and nulls the
     ones an object is missing, so a non-uniform batch would null real columns.
     Uniformity across the two branches is what makes that safe. */
  const a = keys(T.profileRow('p_abc', prof)).sort().join(',');
  const b = keys(T.profileRow('p_broken', { nope: true })).sort().join(',');
  ok(a === b, 'both profileRow branches emit the same columns, so a mixed batch nulls nothing');
}

/* ── no handler binds an id that nothing anywhere renders ─────────────────
   `$('#x').onclick = …` throws TypeError on null, and inside a render
   function that takes the whole screen down with it.

   Be clear about what this does and does not catch. It is a WHOLE-FILE
   check, so it catches an id that exists nowhere -- a rename, a deletion, a
   typo. It does NOT catch the id being rendered on a different screen from
   the one binding it, which is the bug that prompted this on 2026-10-08: the
   onboarding finish button moved from step 2 to step 3, step 2 kept
   `$('#onbDone').onclick`, and `id="onbDone"` still existed -- in step 3.
   Catching that needs per-render-branch scope, which is a parser, not a
   regex. This is the cheap half of the problem, and it is still worth having.

   An id counts as rendered if it appears as id="x", as .id = 'x', or as a
   bare quoted literal anywhere -- the last because several are passed into
   helpers (pwField('auPass', …)) rather than written into markup. */
{
  const app = h;   // already the whole file, read at the top of this script
  const rendered = new Set();
  for (const m of app.matchAll(/\bid="([A-Za-z][\w-]*)"/g)) rendered.add(m[1]);
  for (const m of app.matchAll(/\.id\s*=\s*'([A-Za-z][\w-]*)'/g)) rendered.add(m[1]);
  // Ids handed to a helper that writes the markup, e.g. pwField('auPass', …).
  for (const m of app.matchAll(/['"]([A-Za-z][\w-]*)['"]/g)) rendered.add(m[1]);
  const bound = new Map();
  for (const m of app.matchAll(/\$\('#([A-Za-z][\w-]*)'\)/g)) {
    bound.set(m[1], (bound.get(m[1]) || 0) + 1);
  }
  const missing = [...bound.keys()].filter((id) => !rendered.has(id));
  ok(missing.length === 0,
    'every id bound with $("#…") is rendered somewhere: missing ' + JSON.stringify(missing));
  ok(bound.size > 40, 'the id scan actually found bindings (' + bound.size + '), so this is not vacuous');

  // The step the intake added, specifically.
  ['onbWant', 'onbDone', 'onbBack3', 'limRelocate', 'limOnsite', 'limPay', 'onbExemplar']
    .forEach((id) => ok(rendered.has(id), `intake step renders #${id}`));
}

console.log(process.exitCode ? 'SOME FAILED' : 'ALL PASS');
