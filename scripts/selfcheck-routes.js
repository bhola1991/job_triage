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
  grab(/const EXAM_SITES = \[[\s\S]*?\n\];\n/),
  grab(/const examSite = [^\n]*\n/),
  grab(/async function routeOpps[\s\S]*?\n}\n/),
  grab(/const MONTHS=\{[^\n]*\n/),
  grab(/const httpUrl = [^\n]*\n/),
  grab(/function deadlineOk[\s\S]*?\n}\n/),
  grab(/function placeRow[\s\S]*?\n}\n/),
  grab(/function dateWindows[\s\S]*?\n}\n/),
  grab(/function closedOk[\s\S]*?\n}\n/),
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
const T = new Function(...Object.keys(ctx), src + '; return { chOf, OPP, routeOpps, deadlineOk, placeRow, dateWindows, closedOk };')(...Object.values(ctx));

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
  REPLY = JSON.stringify({ items: [{ title: 'Clerkship Examination', org: 'WBPSC', url: '', website: 'wbpsc.gov.in', fit: 80, reach: 45 }] });
  const fb = await T.routeOpps(trk, 'deadline', []);
  ok(fb[0].url === 'https://psc.wb.gov.in/#clerkship-examination', 'deadlines: a known body\'s real site replaces the one the model got wrong');
  REPLY = JSON.stringify({ items: [{ title: 'NABARD Grade A', org: 'NABARD', url: '', website: 'nabard.org', fit: 80, reach: 45 },
    { title: 'IBPS RRB', org: 'Institute of Banking Personnel Selection (IBPS)', url: 'https://www.ibps.in/index.php/crp-rrb/', fit: 80, reach: 45 }] });
  const fb2 = await T.routeOpps(trk, 'deadline', []);
  ok(fb2[0].url === 'https://nabard.org/#nabard-grade-a' && fb2[1].url.startsWith('https://www.ibps.in/index.php/crp-rrb/#'),
    'deadlines: an unknown body falls back to its own site; a page on the known body\'s own site is kept');
  ok(/^Usually: usually August$/m.test(dl[0].description) && /^Eligibility: graduate, 20-30$/m.test(dl[0].description), 'deadlines: the usual window and eligibility are kept');

  // deadlineOk: the quote must be on the page AND name the date.
  const page = 'Online registration of application: 01.08.2026 to 21.08.2026. Last date for fee payment 21 August 2026.';
  ok(T.deadlineOk(page, '2026-08-21', 'Last date for fee payment 21 August 2026'), 'a quote on the page that names the date passes (month by name)');
  ok(T.deadlineOk(page, '2026-08-21', 'from 01.08.2026 to 21.08.2026'.replace('from ', '')), 'a quote on the page that names the date passes (month by number)');
  ok(!T.deadlineOk(page, '2026-08-25', 'Last date for fee payment 21 August 2026'), 'a date the quote does not name fails');
  ok(!T.deadlineOk(page, '2026-09-21', 'Last date for fee payment 21 September 2026'), 'a quote that is not on the page fails');
  ok(!T.deadlineOk(page, '21-08-2026', 'Last date for fee payment 21 August 2026') && !T.deadlineOk(page, '2026-08-21', '21 Aug'), 'a malformed date, or a quote too short to mean anything, fails');

  // dateWindows: what the model is shown of a long notice.
  const notice = 'x'.repeat(20000) + ' The last date for online registration is 21.08.2026 at 6 pm. ' + 'y'.repeat(20000);
  const w = T.dateWindows(notice);
  ok(w.includes('last date for online registration is 21.08.2026') && w.length < 1200, 'dateWindows: a date deep in a long notice reaches the model, and little else does');
  ok(T.dateWindows('no dates here at all').startsWith('no dates'), 'dateWindows: with nothing to match, the start of the text');
  const listing = Array.from({ length: 30 }, (_, k) => `POST ${k}: Wealth officer ${k}. LAST DATE TO APPLY : 0${(k % 9) + 1}-11-2026. ` + 'z'.repeat(400)).join(' ')
    + ' JUNIOR ASSOCIATES (CUSTOMER SUPPORT) LAST DATE TO APPLY : 30-11-2026.';
  ok(T.dateWindows(listing, 1500, ['Junior', 'Associates']).includes('JUNIOR ASSOCIATES (CUSTOMER SUPPORT) LAST DATE TO APPLY : 30-11-2026')
    && !T.dateWindows(listing, 1500).includes('30-11-2026'), 'dateWindows: on a long listing, the item named comes first');

  // closedOk: "registration is over" needs words from the page that name the item.
  const sbi = 'RECRUITMENT OF JUNIOR ASSOCIATES (CUSTOMER SUPPORT & SALES) (PRELIMINARY EXAMINATION CALL LETTER IS AVAILABLE FOR DOWNLOAD) ENGAGEMENT OF SPECIALIST CADRE OFFICERS (RESULT DECLARED)';
  const ja = ['Junior', 'Associate', 'Customer', 'Support'];
  ok(T.closedOk(sbi, 'JUNIOR ASSOCIATES (CUSTOMER SUPPORT & SALES) (PRELIMINARY EXAMINATION CALL LETTER IS AVAILABLE', ja), 'closedOk: an admit-card line naming the item counts');
  ok(!T.closedOk(sbi, 'SPECIALIST CADRE OFFICERS (RESULT DECLARED)', ja), 'closedOk: a line about another post on the same page does not');
  ok(!T.closedOk(sbi, 'JUNIOR ASSOCIATES REGISTRATION CLOSED', ja), 'closedOk: words that are not on the page do not');

  // placeRow: a Maps place as a row.
  const pl = T.placeRow({ title: 'Bhojohori Manna', url: 'https://maps.google.com/?cid=1', categoryName: 'Bengali restaurant', city: 'Kolkata',
    neighborhood: 'Ekdalia', phone: '+91 33 0000', reviewsCount: 90, totalScore: 4.3, website: 'https://bhojohorimanna.com/menu' }, { id: 'chef', label: 'Chef' }, 'Commis chef');
  ok(pl.channel === 'place' && pl.company === 'Bhojohori Manna' && pl.title === 'Commis chef' && pl.location === 'Ekdalia, Kolkata' && pl.dir === 'chef', 'placeRow: name, role, where and direction');
  ok(pl.site === 'bhojohorimanna.com' && /^Ask about: Commis chef$/m.test(pl.description) && pl.ai_reachability === '75', 'placeRow: site trimmed, what to ask kept, a small place is more reachable');

  console.log(bad ? `${bad} FAILED` : 'ALL PASS');
  process.exit(bad ? 1 : 0);
})();
