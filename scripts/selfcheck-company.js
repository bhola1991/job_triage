// Company hiring signals, as the app reads them (2026-11-02).
//
//   node scripts/selfcheck-company.js     # must print ALL PASS
//
// Offline. Two things can drift apart without anything else noticing: the
// spelling rule (coKey in index.html, public.company_key() in the migration)
// -- if they differ, a company's facts are silently never found -- and the
// words a row shows (coFacts), which must stay facts and say an agency is one.
'use strict';
const fs = require('fs'), path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261102_01_company_stats.sql'), 'utf8');
const grab = (re) => { const m = h.match(re); if (!m) throw new Error('missing in index.html: ' + re); return m[0]; };
const src = [grab(/const COS = new Map\(\);[^\n]*\n/), grab(/const coKey = [^\n]*\n/), grab(/const coOf = [^\n]*\n/),
  grab(/const repeatedHere = [^\n]*\n/), grab(/function coFacts[\s\S]*?\n}\n/)].join('\n');
const T = new Function(src + '; return { COS, coKey, coFacts };')();

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok    ' : '  FAIL  ') + m); if (!c) bad++; };

const words = (s) => (s.match(/\(private\|[a-z|]+\)/) || [''])[0];
ok(words(sql) && words(sql) === words(grab(/const coKey = [^\n]*\n/)), 'the suffix list is the same in the app and in public.company_key()');
ok(T.coKey('Zeta Suite Pvt. Ltd.') === 'zetasuite' && T.coKey('RECRUIT EXPRESS PTE LTD') === 'recruitexpress'
  && T.coKey('Razorpay Software Private Limited') === 'razorpaysoftware' && T.coKey('Coca-Cola Co.') === 'cocacola',
  'coKey gives the keys the database gives (checked against live Postgres 2026-11-02)');

T.COS.set('zetasuite', { open_roles: 4, new_7d: 3, days_open: 5, repeated: ['backend engineer'], is_agency: false });
T.COS.set('recruitexpress', { open_roles: 1, new_7d: 1, days_open: null, repeated: [], is_agency: true });
T.COS.set('quietco', { open_roles: 1, new_7d: 0, days_open: 40, repeated: [], is_agency: false });
ok(T.coFacts({ company: 'Zeta Suite Pvt Ltd', title: 'Backend Engineer' }, true) === 'this role posted more than once, 3 new roles this week',
  'a row: the role posted more than once first, then the company\'s pace');
ok(/roles stay up about 5 days/.test(T.coFacts({ company: 'Zeta Suite', title: 'Designer' })) && !/more than once/.test(T.coFacts({ company: 'Zeta Suite', title: 'Designer' })),
  'the scorer gets everything, and a title not repeated is not called repeated');
ok(T.coFacts({ company: 'Recruit Express', title: 'Nurse' }, true).startsWith('a recruitment agency'), 'an agency says so first');
ok(T.coFacts({ company: 'Quiet Co', title: 'X' }, true) === '' && T.coFacts({ company: 'Nobody Known', title: 'X' }) === '',
  'one open role and nothing new is not news; a company we know nothing about says nothing');

console.log(bad ? `${bad} FAILED` : 'ALL PASS');
process.exit(bad ? 1 : 0);
