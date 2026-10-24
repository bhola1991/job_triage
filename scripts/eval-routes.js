// Does the model say how a kind of work is really got? (routes, 2026-10-24)
//
//   node scripts/eval-routes.js            offline: the recorded answers vs the labels
//   node scripts/eval-routes.js --record   asks DeepSeek again and rewrites the answers
//
// Like eval-matcher: the offline run calls no model, so it moves only when this
// repo changes. --record needs DEEPSEEK_API_KEY from the SHELL (not .env.local).
//
// The prompt and the rules are read out of index.html, so this measures the
// words the app actually sends, not a copy of them. Each case is labelled with
// the routes its TOP weight may be (a chef's top route is local or people, never
// advertised) and, where it matters, a ceiling on "advertised" -- the failure
// that started this: a reporter whose list was empty because only boards were read.
'use strict';
const fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, 'eval', 'routes.json');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const slice = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('not found in index.html: ' + a); return src.slice(i, j); };
const T = new Function(slice('const ROUTES = [', 'const routesOf') + '; return { ROUTES, ROUTES_JSON, ROUTES_RULES, normRoutes };')();

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const prompt = c => `A person based in ${c.location} is pursuing these kinds of work:
- id "${c.id}": ${c.label} (titles: ${c.titles.join(', ')})

Return ONLY a JSON object, no preamble, no markdown fences, keyed by id:
{"<id>":{"routes":${T.ROUTES_JSON},"how_hired":""}}

${T.ROUTES_RULES}`;

async function record() {
  const KEY = process.env.DEEPSEEK_API_KEY;
  if (!KEY) { console.error('DEEPSEEK_API_KEY is not set in this shell.'); process.exit(1); }
  for (const c of data.cases) {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(180000),
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: data.model, max_tokens: 2000, messages: [{ role: 'user', content: prompt(c) }] }),
    });
    if (!r.ok) throw new Error(`${c.id}: ${r.status} ${(await r.text()).slice(0, 120)}`);
    const txt = ((await r.json()).choices?.[0]?.message?.content || '').replace(/^```(json)?|```$/gm, '');
    const d = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1))[c.id] || {};
    c.recorded = { routes: d.routes || {}, how_hired: d.how_hired || '', at: new Date().toISOString().slice(0, 10) };
    console.log(c.id.padEnd(12), JSON.stringify(T.normRoutes(c.recorded.routes)), '|', c.recorded.how_hired);
  }
  fs.writeFileSync(FILE, JSON.stringify(data, null, 1) + '\n');
}

function check() {
  let bad = 0;
  const ok = (cond, msg) => { console.log((cond ? '  ok    ' : '  FAIL  ') + msg); if (!cond) bad++; };
  // normRoutes itself: shares out to 1, drops junk, empty is null.
  const n = T.normRoutes({ advertised: 2, people: 2, nonsense: 9, pitch: -1 });
  ok(n && n.advertised === 0.5 && n.people === 0.5 && !('nonsense' in n) && !('pitch' in n), 'normRoutes shares out and drops junk');
  ok(T.normRoutes({}) === null && T.normRoutes(null) === null, 'normRoutes: nothing in, null out');
  for (const c of data.cases) {
    const r = c.recorded && T.normRoutes(c.recorded.routes);
    if (!r) { ok(false, `${c.id}: no recorded answer -- run with --record`); continue; }
    const top = Object.entries(r).sort((a, b) => b[1] - a[1])[0][0];
    const adv = r.advertised || 0;
    ok(c.expect.top.includes(top) && (c.expect.adv_max == null || adv <= c.expect.adv_max),
      `${c.id.padEnd(12)} top ${top} (want ${c.expect.top.join('|')})` + (c.expect.adv_max != null ? `, advertised ${adv} (max ${c.expect.adv_max})` : ''));
  }
  console.log(bad ? `${bad} FAILED` : 'ALL PASS');
  process.exit(bad ? 1 : 0);
}

process.argv.includes('--record') ? record().then(check) : check();
