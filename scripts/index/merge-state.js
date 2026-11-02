// Merge the bucket's copy of a crawl-state file with the repo's, instead of
// letting one replace the other (state.sh pull).
//
//   node merge-state.js sources.json  <repo> <pulled>   > out   union of every list, keys from both
//   node merge-state.js lines         <repo> <pulled>   > out   union of lines (probe-boards ledger)
//   node merge-state.js --test
//
// Why: pull used to overwrite the repo's sources.json with the bucket's, and the
// crawl then pushed that back. So a board added in the repo never reached a
// crawl: the 30 Indian boards merged in #57 were dropped on 2026-11-02, silently.
// The bucket gains slugs the harvest finds; the repo gains slugs people add.
// Both have to survive.
// ponytail: a union never removes. Taking a board OUT of the repo does not
// take it out of the bucket; delete it from the bucket's copy too (state.sh pull,
// edit, push) if one ever has to go.
'use strict';
const fs = require('fs');

function merge(repo, pulled) {
  if (Array.isArray(repo) && Array.isArray(pulled)) {
    const seen = new Set(repo.map((x) => JSON.stringify(x)));
    return repo.concat(pulled.filter((x) => !seen.has(JSON.stringify(x))));
  }
  if (repo && pulled && typeof repo === 'object' && typeof pulled === 'object' && !Array.isArray(repo) && !Array.isArray(pulled)) {
    const out = {};
    for (const k of new Set([...Object.keys(repo), ...Object.keys(pulled)]))
      out[k] = k in repo && k in pulled ? merge(repo[k], pulled[k]) : (k in repo ? repo[k] : pulled[k]);
    return out;
  }
  return repo === undefined ? pulled : repo;   // a note or a setting: the repo's word
}
const lines = (a, b) => [...new Set([...a.split('\n'), ...b.split('\n')].filter(Boolean))].join('\n') + '\n';

const [mode, a, b] = process.argv.slice(2);
if (mode === '--test') {
  const assert = require('assert');
  const r = merge({ _note: 'repo', greenhouse: ['a', 'groww'], jsonld: { x: { sitemap: 'r' } }, feeds: { f: 1 } },
                  { _note: 'old', greenhouse: ['a', 'found'], jsonld: { y: { sitemap: 'b' } }, lever: ['z'] });
  assert.deepStrictEqual(r.greenhouse, ['a', 'groww', 'found'], 'a list keeps both sides once');
  assert.deepStrictEqual(Object.keys(r.jsonld).sort(), ['x', 'y'], 'boards from both sides');
  assert.deepStrictEqual(r.lever, ['z'], 'a list only the bucket has');
  assert.deepStrictEqual(r.feeds, { f: 1 }, 'a list only the repo has');
  assert.strictEqual(r._note, 'repo', 'a note is the repo\'s');
  assert.strictEqual(lines('a\nb\n', 'b\nc\n'), 'a\nb\nc\n', 'ledger lines once each');
  console.log('ALL PASS');
} else if (mode === 'sources.json') {
  process.stdout.write(JSON.stringify(merge(JSON.parse(fs.readFileSync(a, 'utf8')), JSON.parse(fs.readFileSync(b, 'utf8'))), null, 2) + '\n');
} else if (mode === 'lines') {
  process.stdout.write(lines(fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8')));
} else { console.error('usage: merge-state.js sources.json|lines <repo> <pulled> | --test'); process.exit(2); }
