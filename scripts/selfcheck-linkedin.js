// The LinkedIn data archive, read the way the app reads it (2026-10-29).
//
//   node scripts/selfcheck-linkedin.js     # must print ALL PASS
//
// Offline. Runs index.html's own readZip / csvObjects / liDate / importArchive
// over scripts/fixtures/linkedin-archive.zip -- a made-up archive in LinkedIn's
// shapes (a note above the Connections header, "10/24/26, 9:41 AM" dates,
// Job Applications inside Jobs/). What it guards most is privacy: what a
// message SAYS must never be kept anywhere, only who and when.
'use strict';
const fs = require('fs'), path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const grab = (re) => { const m = h.match(re); if (!m) throw new Error('missing in index.html: ' + re); return m[0]; };
const src = [
  grab(/function parseCSV[\s\S]*?\n}\n/), grab(/function parseConnections[\s\S]*?\n}\n/),
  grab(/async function readZip[\s\S]*?\n}\n/), grab(/function csvObjects[\s\S]*?\n}\n/), grab(/function liDate[\s\S]*?\n}\n/),
  grab(/const liUrl = [^\n]*\n/), grab(/const RECRUITER = [^\n]*\n/),
  grab(/async function importArchive[\s\S]*?\n}\n/), grab(/function liText[\s\S]*?\n}\n/),
].join('\n');

// What the app around these functions would be: one profile, storage, saving.
let CONNS = [], SAVED = 0;
const PROFILE = { profile: { tracks: [{ id: 'seo', label: 'SEO content writer' }] }, track: 'seo', raw: '', jobs: [] };
const ctx = {
  P: () => PROFILE, loadConns: () => CONNS, saveConns: (l) => { CONNS = l; return true; },
  blank: () => ({ title: '', company: '', url: '', location: '', description: '', contacts: '[]', channel: 'posted', events: '[]', stage: 'new' }),
  setStage: (j, st) => { j.stage = st; }, stOf: (j) => j.stage,
  setList: (j, k, v) => { j[k] = JSON.stringify(v); },
  addJobs: (list) => { PROFILE.jobs.push(...list); return list.length; },
  httpUrl: (u) => /^https?:\/\//.test(u) ? u : '', today: () => '2026-10-29', track: () => {}, save: async () => { SAVED++; },
};
const T = new Function(...Object.keys(ctx), src + '; return { readZip, liDate, importArchive };')(...Object.values(ctx));

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok    ' : '  FAIL  ') + m); if (!c) bad++; };

(async () => {
  const buf = fs.readFileSync(path.join(__dirname, 'fixtures', 'linkedin-archive.zip'));
  const file = { name: 'linkedin-archive.zip', arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };

  const z = await T.readZip(file);
  ok(z.names.length === 7 && (await z.text('Job Applications.csv') || '').includes('Minerva'), 'readZip: every entry, a file inside a folder found by its own name');
  ok(T.liDate('27 Oct 2024') === '2024-10-27' && T.liDate('2024-05-03 14:22:10 UTC') === '2024-05-03' && T.liDate('10/24/26, 9:41 AM') === '2026-10-24',
    'liDate: all three of LinkedIn\'s date shapes, on the right day east of UTC');
  let threw = ''; try { await T.readZip({ name: 'x.csv', arrayBuffer: async () => new TextEncoder().encode('a,b\n1,2\n').buffer }); } catch (e) { threw = e.message; }
  ok(/not a \.zip/.test(threw), 'readZip: a file that is not a zip says so');

  const now = Date.parse('2026-10-29T12:00:00Z');
  const r = await T.importArchive(file, now);
  ok(r.conns === 3 && CONNS.length === 3, 'connections read past the note above the header');
  const rita = CONNS.find((c) => c.n === 'Rita Sen'), amit = CONNS.find((c) => c.n === 'Amit Roy');
  ok(rita.m === '2026-10-20' && rita.mf === '2026-10-19' && rita.k === 2 && amit.m === '2025-09-24' && !amit.mf,
    'messages: last contact, last from them, how often -- matched by profile URL, trailing slash or not');
  ok(r.talked === 1, 'only people written to in the last year count as talked to');
  ok(!JSON.stringify(CONNS).includes('SECRET') && !JSON.stringify(PROFILE).includes('SECRET'), 'what a message says is kept nowhere');

  const li = PROFILE.profile.linkedin;
  ok(li && li.headline === 'Content writer, SEO' && li.positions.length === 2 && li.skills.join() === 'SEO,Copywriting,WordPress' && li.education.length === 1,
    'profile: headline, roles, skills and education saved to the profile');
  ok(PROFILE.raw.startsWith('Test Person\nContent writer, SEO') && PROFILE.raw.includes('Content Writer at Braintree Education'), 'no CV yet: the archive\'s profile becomes one');

  const apps = PROFILE.jobs.filter((j) => j.source === 'LinkedIn applications');
  ok(apps.length === 2 && !apps.some((j) => j.company === 'Too Old Ltd'), 'applications: the last year only');
  const recent = apps.find((j) => j.company === 'Minerva Infotech'), older = apps.find((j) => j.company === 'Health Plus');
  ok(recent.stage === 'sent' && recent.date_applied === '2026-10-24' && older.stage === 'closed', 'applications: the last month waiting on a reply, older ones closed');

  const rec = PROFILE.jobs.filter((j) => j.source === 'LinkedIn messages');
  ok(rec.length === 1 && rec[0].company === 'Braintree Education' && JSON.parse(rec[0].contacts)[0].name === 'Rita Sen' && rec[0].channel === 'person',
    'a recruiter you know who wrote this year becomes someone to ask; an editor does not');
  ok(SAVED === 1, 'saved once');

  console.log(bad ? `${bad} FAILED` : 'ALL PASS');
  process.exit(bad ? 1 : 0);
})();
