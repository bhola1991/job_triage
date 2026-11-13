// node scripts/selfcheck-verify.js -- the liveness store forgets what the database forgets.
// checks.json kept every posting ever seen until 2026-11-13, outgrew the longest
// string V8 will write, and stopped the nightly crawl three nights running.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-'));
const job = (source, closed_on) => ({ source, first_seen: '2026-10-01', last_seen: '2026-11-01', runs: 3, reposts: 0, absent_runs: closed_on ? 2 : 0, closed_on });
fs.writeFileSync(path.join(T, 'store.json'), JSON.stringify({ runs: 5, jobs: {
  'https://n/1': job('naukri-sitemap', null),      // retired source: forgotten
  'https://g/old': job('greenhouse', '2026-10-03'), // closed 41 days: forgotten
  'https://g/recent': job('greenhouse', '2026-11-03'),
  'https://g/open': job('greenhouse', null),
} }));
fs.writeFileSync(path.join(T, 'snap.jsonl'), '{"url":"https://g/open","source":"greenhouse"}\n');
execFileSync('node', [path.join(__dirname, 'index/verify.js'), path.join(T, 'snap.jsonl'),
  '--store', path.join(T, 'store.json'), '--suspect', path.join(T, 's.jsonl'), '--asof', '2026-11-13', '--prune', '30']);
const kept = Object.keys(JSON.parse(fs.readFileSync(path.join(T, 'store.json'), 'utf8')).jobs).sort().join(',');
fs.rmSync(T, { recursive: true });
if (kept !== 'https://g/open,https://g/recent') { console.log('FAIL kept ' + kept); process.exit(1); }
console.log('ALL PASS');
