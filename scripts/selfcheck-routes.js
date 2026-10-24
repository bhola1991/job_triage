// Routes, phase 2: stories to pitch and people to ask, turned from a model's
// answer into rows. Offline: the model is a stub, the code is index.html's own.
//
//   node scripts/selfcheck-routes.js     # must print ALL PASS
//
// What it guards is mostly one promise: a person's NAME is only ever written
// onto a row when it is someone in the user's own imported network. A model
// asked "who should this reporter ask?" will happily name a real editor it has
// guessed at, and a note drafted "Dear <guess>" to the wrong person is worse
// than one addressed to the desk.
'use strict';
const h = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const grab = (re) => { const m = h.match(re); if (!m) throw new Error('missing in index.html: ' + re); return m[0]; };
const src = [
  grab(/const chOf {3}= [^\n]*\n/),
  grab(/const OPP = \{[\s\S]*?\n\};\n/),
  grab(/const ROUTE_CH = [^\n]*\n/),
  grab(/const YOU_RULE = [^\n]*\n/),
  grab(/function grabJSON[\s\S]*?\n}\n/),
  grab(/async function routeOpps[\s\S]*?\n}\n/),
  grab(/const MONTHS=\{[^\n]*\n/),
  grab(/const httpUrl = [^\n]*\n/),
  grab(/function deadlineOk[\s\S]*?\n}\n/),
  grab(/function placeRow[\s\S]*?\n}\n/),
].join('\n');

let REPLY = '', ASKED = '';
const CONNS = [{ n: 'Ravi Das', p: 'Political editor', c: 'Ei Samay' }];
const ctx = {
  P: () => ({ profile: { location: 'Kolkata', country: 'India' }, raw: 'cv', jobs: [] }),
  loadConns: () => CONNS,
  networkCompanies: (conns) => [{ name: 'Ei Samay', people: conns }],
  senderBlock: () => 'WHO THEY ARE: a reporter',
  claude: async (prompt) => { ASKED = prompt; return REPLY; },
  blank: () => ({ title: '', company: '', url: '', location: '', description: '', contacts: '[]', channel: 'posted' }),
  fitOf: (j) => Number(j.ai_score) || 0,
  TOK_CAP: 16000, globalThis: {},
};
const T = new Function(...Object.keys(ctx), src + '; return { chOf, OPP, routeOpps, deadlineOk, placeRow };')(...Object.values(ctx));

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok    ' : '  FAIL  ') + m); if (!c) bad++; };

(async () => {
  ok(T.chOf({ channel: 'pitch' }) === 'pitch' && T.chOf({ channel: 'PERSON ' }) === 'person'
    && T.chOf({ channel: 'cold' }) === 'cold' && T.chOf({ channel: 'whatever' }) === 'posted' && T.chOf({}) === 'posted',
    'chOf: the four kinds, anything else is a posting');
  ok(['posted', 'cold', 'pitch', 'person'].every(c => T.OPP[c].sent && T.OPP[c].status && T.OPP[c].toast && T.OPP[c].key),
    'every kind has its words for sent, status, toast and the key');

  const trk = { id: 'rep', label: 'Political reporter', how_hired: 'Through editors.' };
  REPLY = JSON.stringify({ items: [
    { title: 'Political editor', org: 'Ei Samay', who: 'Ravi Das', why: 'w', ask: 'advice', fit: 90, reach: 60 },
    { title: 'Bureau chief', org: 'The Telegraph', who: 'Somebody Guessed', why: 'w', ask: 'advice', fit: 80, reach: 30 },
    { title: 'Weak match', org: 'Somewhere', fit: 30, reach: 50 },
    { title: 'No organisation', fit: 90, reach: 50 },
  ] });
  const people = await T.routeOpps(trk, 'people', ['Old one (X)']);
  ok(people.length === 2, `people: under-40 fit and rows with no organisation are dropped (${people.length} kept)`);
  ok(people.every(j => j.channel === 'person' && j.dir === 'rep' && j.source === 'Suggested'), 'people: channel, direction and source set');
  const known = people.find(j => j.company === 'Ei Samay'), guessed = people.find(j => j.company === 'The Telegraph');
  ok(known && JSON.parse(known.contacts)[0].name === 'Ravi Das', 'a name from their own network becomes the contact');
  ok(guessed && guessed.contacts === '[]' && !JSON.stringify(guessed).includes('Somebody Guessed'), 'a name the model guessed is written nowhere');
  ok(/Never "he", "she"/.test(ASKED), 'the prompt says to write to the person, never guessing a pronoun');
  ok(ASKED.includes('Ravi Das (Political editor) at Ei Samay') && ASKED.includes('Old one (X)'), 'the prompt carries their network and what they already have');

  REPLY = '```json\n' + JSON.stringify({ items: [{ title: 'Drainage contracts', org: 'Scroll', who: 'metro editor', why: 'w', fit: 85, reach: 40, website: 'https://scroll.in/about' }] }) + '\n```';
  const pitch = await T.routeOpps(trk, 'pitch', []);
  ok(pitch.length === 1 && pitch[0].channel === 'pitch' && /^Commissioned by: metro editor$/m.test(pitch[0].description), 'pitch: who commissions it is kept on the row');
  ok(pitch[0].site === 'scroll.in' && pitch[0].ai_score === '85' && pitch[0].ai_reachability === '40', 'pitch: site trimmed to a domain, scores carried');

  // Deadlines: two cycles on one official site stay two rows, and no date comes from the model.
  REPLY = JSON.stringify({ items: [
    { title: 'IBPS PO', org: 'IBPS', url: 'https://www.ibps.in/', window: 'usually August', ask: 'graduate, 20-30', fit: 80, reach: 50 },
    { title: 'IBPS Clerk', org: 'IBPS', url: 'https://www.ibps.in/', window: 'usually July', fit: 70, reach: 60 },
    { title: 'Coaching site', org: 'X', url: 'javascript:alert(1)', fit: 70, reach: 60 },
  ] });
  const dl = await T.routeOpps(trk, 'deadline', []);
  ok(dl.length === 3 && dl[0].url !== dl[1].url && dl[0].url.startsWith('https://www.ibps.in/#ibps-po'), 'deadlines: two cycles on one site are two rows');
  ok(dl[2].url === '' && dl.every(j => j.channel === 'deadline' && !j.deadline), 'deadlines: a non-web url is dropped, and no row carries a date from the model');
  ok(/^Usually: usually August$/m.test(dl[0].description) && /^Eligibility: graduate, 20-30$/m.test(dl[0].description), 'deadlines: the usual window and eligibility are kept');

  // deadlineOk: the quote must be on the page AND name the date.
  const page = 'Online registration of application: 01.08.2026 to 21.08.2026. Last date for fee payment 21 August 2026.';
  ok(T.deadlineOk(page, '2026-08-21', 'Last date for fee payment 21 August 2026'), 'a quote on the page that names the date passes (month by name)');
  ok(T.deadlineOk(page, '2026-08-21', 'from 01.08.2026 to 21.08.2026'.replace('from ', '')), 'a quote on the page that names the date passes (month by number)');
  ok(!T.deadlineOk(page, '2026-08-25', 'Last date for fee payment 21 August 2026'), 'a date the quote does not name fails');
  ok(!T.deadlineOk(page, '2026-09-21', 'Last date for fee payment 21 September 2026'), 'a quote that is not on the page fails');
  ok(!T.deadlineOk(page, '21-08-2026', 'Last date for fee payment 21 August 2026') && !T.deadlineOk(page, '2026-08-21', '21 Aug'), 'a malformed date, or a quote too short to mean anything, fails');

  // placeRow: a Maps place as a row.
  const pl = T.placeRow({ title: 'Bhojohori Manna', url: 'https://maps.google.com/?cid=1', categoryName: 'Bengali restaurant', city: 'Kolkata',
    neighborhood: 'Ekdalia', phone: '+91 33 0000', reviewsCount: 90, totalScore: 4.3, website: 'https://bhojohorimanna.com/menu' }, { id: 'chef', label: 'Chef' }, 'Commis chef');
  ok(pl.channel === 'place' && pl.company === 'Bhojohori Manna' && pl.title === 'Commis chef' && pl.location === 'Ekdalia, Kolkata' && pl.dir === 'chef', 'placeRow: name, role, where and direction');
  ok(pl.site === 'bhojohorimanna.com' && /^Ask about: Commis chef$/m.test(pl.description) && pl.ai_reachability === '75', 'placeRow: site trimmed, what to ask kept, a small place is more reachable');

  console.log(bad ? `${bad} FAILED` : 'ALL PASS');
  process.exit(bad ? 1 : 0);
})();
