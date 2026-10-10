#!/usr/bin/env node
// Do the Worker's two public write routes accept only what they should?
//
//   node scripts/selfcheck-worker.js
//
// Why this exists
// ---------------
// /api/feedback and /api/contact are the only endpoints in this project that
// an unauthenticated stranger can write through, and /api/feedback inserts
// with the SERVICE ROLE -- it is the one place where an anonymous request
// reaches past RLS. Everything else the app does goes through the anon key
// under a policy.
//
// It also could not be checked in production, which is what prompted this: the
// route answers 503 until SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set
// as Worker secrets, and that check runs before validation -- so every probe
// came back 503 and proved nothing about the validation behind it.
//
// Offline: the handler is imported and driven with a stub env and a stubbed
// global fetch, so nothing is sent and no key is needed.
'use strict';
const fs = require('fs');
const path = require('path');

let fail = 0;
const ok = (name, cond, got) => {
  if (cond) return;
  fail++;
  console.log(`  FAIL ${name}${got === undefined ? '' : `  got ${JSON.stringify(got)}`}`);
};

/* Node warns that src/index.js is ESM without a "type": "module" nearby --
   caused by a package.json OUTSIDE this repo, in the home directory, which is
   not ours to edit. The repo has no root package.json on purpose (CLAUDE.md
   §3). Silenced here only, so a real warning still shows. */
const realWarn = process.emitWarning;
process.emitWarning = (w, ...rest) =>
  /MODULE_TYPELESS_PACKAGE_JSON/.test(String(rest[0] && rest[0].code || rest[0] || '')) ||
  /Module type of/.test(String(w)) ? undefined : realWarn.call(process, w, ...rest);

const ENV = { SUPABASE_URL: 'https://stub.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'stub-service-role' };

/* The handler logs to console.error on the 503 and 502 paths, which is correct
   in production and confusing in a check that ends in ALL PASS -- a reader
   cannot tell an expected log from a real one. Muted around the cases that
   provoke it, and asserted to have happened, so the logging itself is still
   covered rather than merely hidden. */
let logged = [];
async function quiet(fn) {
  const real = console.error;
  logged = [];
  console.error = (...a) => { logged.push(a.join(' ')); };
  try { return await fn(); } finally { console.error = real; }
}

/* Captures what the handler would have sent to PostgREST, and answers 201 so
   the happy path completes. Restored after each call. */
let sent = null;
function withStubbedFetch(fn, reply = { ok: true, status: 201 }) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent = { url: String(url), init, body: init && init.body ? JSON.parse(init.body) : null };
    return { ok: reply.ok, status: reply.status, text: async () => '', json: async () => ({}) };
  };
  return fn().finally(() => { globalThis.fetch = real; });
}

const post = (body, env = ENV) =>
  new Request('https://x/api/feedback', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

(async () => {
  const W = (await import('../src/index.js')).default;
  const call = (req, env = ENV) => W.fetch(req, env, {});
  const json = async (r) => [r.status, await r.json()];

  /* ── routing ──────────────────────────────────────────────────────────── */
  console.log('routing');
  let [st, b] = await json(await call(new Request('https://x/api/feedback')));
  ok('GET is refused', st === 405, [st, b]);

  // Anything not a named route must fall through to the static assets, never
  // be handled here.
  let served = false;
  await call(new Request('https://x/index.html'), { ...ENV, ASSETS: { fetch: async () => { served = true; return new Response('ok'); } } });
  ok('unknown path falls through to ASSETS', served);

  /* ── the misconfiguration that bit in production ──────────────────────── */
  console.log('misconfiguration');
  [st, b] = await json(await quiet(() => call(post({ kind: 'bug', message: 'x' }), {})));
  ok('no Supabase binding is a 503, not a 500', st === 503, [st, b]);
  ok('and says so', /not configured/i.test(b.error), b);
  ok('and leaves a log line to find it by', logged.some(l => /no Supabase binding/i.test(l)), logged);

  /* ── validation ───────────────────────────────────────────────────────── */
  console.log('validation');
  const cases = [
    ['invalid JSON',        'not json',                                        400, /Invalid JSON/i],
    ['no message',          { kind: 'bug' },                                   400, /required/i],
    ['blank message',       { kind: 'bug', message: '   ' },                   400, /required/i],
    ['unknown kind',        { kind: 'nope', message: 'x' },                    400, /Unknown kind/i],
    ['missing kind',        { message: 'x' },                                  400, /Unknown kind/i],
    ['honeypot filled',     { kind: 'bug', message: 'x', website: 'spam' },     400, /Invalid submission/i],
    ['non-string message',  { kind: 'bug', message: { a: 1 } },                400, /required/i],
  ];
  for (const [name, body, want, re] of cases) {
    const [s, j] = await json(await withStubbedFetch(() => call(post(body))));
    ok(name + ' is rejected', s === want && re.test(j.error || ''), [s, j]);
  }
  for (const k of ['bug', 'idea', 'confusing', 'other']) {
    const [s] = await json(await withStubbedFetch(() => call(post({ kind: k, message: 'x' }))));
    ok(`kind ${k} is accepted`, s === 200, s);
  }

  /* ── what actually gets written ───────────────────────────────────────── */
  console.log('the insert');
  sent = null;
  let [s2] = await json(await withStubbedFetch(() => call(post({
    kind: 'bug', message: 'it broke', reply_to: '  me@example.test  ',
    context: { jobs: 12, scored: 3, track: 'AI Ops', busy: true, nothing: null },
  }))));
  ok('happy path is 200', s2 === 200, s2);
  ok('writes to feedback', /\/rest\/v1\/feedback$/.test(sent.url), sent.url);
  ok('uses the service role', sent.init.headers.apikey === ENV.SUPABASE_SERVICE_ROLE_KEY);
  // The whole point of the anonymous door: it must never claim a user.
  ok('user_id is null', sent.body.user_id === null, sent.body.user_id);
  ok('via records the door', sent.body.via === 'anon', sent.body.via);
  ok('reply_to is trimmed', sent.body.reply_to === 'me@example.test', sent.body.reply_to);
  ok('context survives', sent.body.context.jobs === 12 && sent.body.context.busy === true, sent.body.context);
  ok('null in context survives', sent.body.context.nothing === null, sent.body.context);

  /* Context comes from the client, so it is bounded and never trusted. It is
     read by a human and a reader script, never executed and never used to
     authorise anything -- but it must not be usable as free storage either. */
  console.log('context is bounded');
  const big = {};
  for (let i = 0; i < 60; i++) big['k' + i] = 'v';
  big.nested = { a: 1 };
  big.arr = [1, 2, 3];
  big.long = 'x'.repeat(5000);
  big['n'.repeat(200)] = 'y';
  sent = null;
  await withStubbedFetch(() => call(post({ kind: 'other', message: 'm', context: big })));
  const c = sent.body.context;
  ok('key count capped at 24', Object.keys(c).length <= 24, Object.keys(c).length);
  ok('nested objects dropped', c.nested === undefined, c.nested);
  ok('arrays dropped', c.arr === undefined, c.arr);
  ok('long values truncated', !Object.values(c).some(v => typeof v === 'string' && v.length > 300));
  ok('long keys truncated', !Object.keys(c).some(k => k.length > 40));
  sent = null;
  await withStubbedFetch(() => call(post({ kind: 'other', message: 'm', context: [1, 2, 3] })));
  ok('an array context becomes {}', JSON.stringify(sent.body.context) === '{}', sent.body.context);
  sent = null;
  await withStubbedFetch(() => call(post({ kind: 'bug', message: 'z'.repeat(9000) })));
  ok('message capped at 4000', sent.body.message.length === 4000, sent.body.message.length);

  /* ── a failed insert must not read as success ─────────────────────────── */
  console.log('failure');
  const [s3, j3] = await json(await quiet(() => withStubbedFetch(
    () => call(post({ kind: 'bug', message: 'x' })), { ok: false, status: 401 })));
  ok('a rejected insert is a 502', s3 === 502, [s3, j3]);
  ok('and does not claim ok', j3.ok === false, j3);
  ok('and logs the upstream status', logged.some(l => /feedback insert 401/.test(l)), logged);

  /* ── the contact route keeps its honeypot ─────────────────────────────── */
  console.log('contact');
  const cpost = (body) => new Request('https://x/api/contact', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  [st, b] = await json(await call(cpost({ email: 'a@b.c', message: 'x', website: 'spam' })));
  ok('contact honeypot rejects', st === 400 && /Invalid submission/i.test(b.error), [st, b]);
  [st, b] = await json(await call(cpost({ message: 'x' })));
  ok('contact needs an email', st === 400, [st, b]);

  /* ── the public price list against the code ─────────────────────────────
     A price on a public page is a promise about money, and it was the only
     number in this project nothing compared against its source. The drift it
     catches had already happened twice, and in both cases the code KNEW: the
     edge function carries the comment "linkedin is gone (see SCRAPERS).
     pricing.html must not promise it." and the page promised it for three more
     days; the same page charged "AI scoring or drafting ... 1" after drafting
     moved to the pro tier at 3.

     Asserted here rather than in a block of its own, because a separate
     top-level IIFE raced this one and its `process.exitCode` was then reset by
     the line below -- a failing price check that exits 0 is worse than no
     check, and this repo has been bitten by invisible failures before. */
  console.log('pricing');
  {
    const ROOT = path.resolve(__dirname, '..');
    const fn = fs.readFileSync(path.join(ROOT, 'supabase/functions/api/index.ts'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'pricing.html'), 'utf8');
    const num = (re, what) => { const m = re.exec(fn); if (!m) throw new Error('could not read ' + what); return Number(m[1]); };
    const board = num(/boardSearch:\s*(\d+)/, 'COST.boardSearch');
    const apifyQ = num(/apifyQuery:\s*(\d+)/, 'COST.apifyQuery');
    const pro = num(/LLM_COST[^=]*=\s*\{[^}]*pro:\s*(\d+)/, 'LLM_COST.pro');
    const flash = num(/LLM_COST[^=]*=\s*\{[^}]*flash:\s*(\d+)/, 'LLM_COST.flash');

    /* Tempered so the body cannot cross </tr>. Without that the non-greedy
       match ran from the packs table's first row all the way to the credits
       table's first price, and reported the two tables as one row. */
    const rows = [...html.matchAll(/<tr>\s*<td>((?:(?!<\/tr>)[\s\S])*?)<\/td>\s*<td>(\d+)<\/td>\s*<\/tr>/g)]
      .map((m) => ({ text: m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(), price: Number(m[2]) }));
    const row = (re) => rows.find((r) => re.test(r.text));

    ok('the credits table parsed', rows.length >= 4, rows.length);
    const search = row(/^Job board search/i);
    ok(`board search is priced at COST.boardSearch (${board})`, search && search.price === board, search && search.price);
    const score = row(/^AI scoring/i);
    ok(`scoring is priced at the flash tier (${flash})`, score && score.price === flash, score && score.price);
    const draft = row(/^Draft/i);
    ok(`drafting is priced at the pro tier (${pro})`, draft && draft.price === pro, draft && draft.price);
    const hr = row(/hiring contacts/i);
    ok(`a contact lookup is priced at apifyQuery x3 (${apifyQ * 3})`, hr && hr.price === apifyQ * 3, hr && hr.price);

    /* A source the code removed must not be advertised. LinkedIn went on
       2026-10-03 because scraping it directly is against its terms; Glassdoor
       is only ever reached through the Google fallback, and only when every
       other source came back empty, so naming it as a board we read is a
       promise the product does not keep. */
    ['LinkedIn', 'Glassdoor'].forEach((gone) =>
      ok(`${gone} is not advertised as a board we read`, !new RegExp(gone, 'i').test(html)));

    /* privacy.html names Apify's scrapers one by one, so a deleted scraper is a
       false DISCLOSURE as well as a false advert -- it tells someone their
       search terms go to a LinkedIn scraper that no longer exists. Checked
       against SCRAPERS rather than a hard-coded list, so the next removal is
       caught too. */
    const priv = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
    const apifyList = /runs the searches on ([^)]*)\)/.exec(priv);
    ok('privacy.html names Apify\'s scrapers', !!apifyList);

    /* Matched against the SCRAPERS DECLARATION, not the file's text. The first
       version of this check searched the whole edge function for the site name
       and was therefore vacuous: "linkedin" still appears twenty times in the
       comments that record its removal, so re-adding it to the disclosure
       passed. A name must resolve to a live actor key or one of the boards an
       actor is configured with. */
    /* Anchored on the `}> = {` that closes the TYPE annotation. A plainer
       /const SCRAPERS[^=]*=/ does not work: the annotation contains
       `input: (c: Ctx, rows: number) => object`, so [^=]* stops at that
       arrow and the match dies. */
    const block = /const SCRAPERS[\s\S]*?\}>\s*=\s*\{([\s\S]*?)\n\};/.exec(fn);
    ok('the SCRAPERS declaration was found', !!block);
    const live = new Set();
    if (block) {
      for (const m of block[1].matchAll(/^  ([a-z][a-z0-9]*):\s*\{/gm)) live.add(m[1]);
      for (const m of block[1].matchAll(/boards:\s*\[([^\]]*)\]/g)) {
        for (const b of m[1].split(',')) {
          const t = b.trim().replace(/^["']|["']$/g, '');
          if (t) live.add(t.toLowerCase());
        }
      }
    }
    ok('SCRAPERS keys parsed', live.size >= 4, [...live]);
    ok('the deleted linkedin actor is really gone from SCRAPERS', !live.has('linkedin'), [...live]);
    if (apifyList) {
      apifyList[1].split(/,| and /).map((x) => x.trim()).filter(Boolean).forEach((site) => {
        // Google is the search-scraper actor, declared as ACTOR not in SCRAPERS.
        if (/^google$/i.test(site)) return;
        ok(`privacy.html: Apify really does run ${site}`,
          live.has(site.replace(/\s+/g, '').toLowerCase()), { site, live: [...live] });
      });
    }

    /* Every outbound processor must be NAMED in privacy.html. This is the
       direction of error that matters in a disclosure: an over-disclosure is
       untidy, an omission is the thing a regulator asks about. Four were missing
       until 2026-10-08 -- TypeSafe, Mantiks, Resend and Cloudflare -- and
       TypeSafe was the significant one, because it receives the posting text
       together with the person's name, location, strengths and gaps on every
       judged search. */
    [
      ['DeepSeek', /api\.deepseek\.com/],
      ['TypeSafe', /typesafe/i],
      ['Mantiks', /dashboard\.mantiks\.io/],
      ['Apify', /api\.apify\.com/],
      ['Razorpay', /razorpay/i],
    ].forEach(([name, re]) => {
      if (!re.test(fn)) return;         // not wired, so not required to be named
      ok(`privacy.html names ${name}, which the edge function calls`,
        new RegExp(name, 'i').test(priv), name);
    });
    const worker = fs.readFileSync(path.join(ROOT, 'src/index.js'), 'utf8');
    if (/api\.resend\.com/.test(worker)) {
      ok('privacy.html names Resend, which the Worker calls', /resend/i.test(priv));
    }
    /* The CDNs the BROWSER is sent to, which no server-side grep would find. */
    const app = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    [['jsDelivr', /cdn\.jsdelivr\.net/], ['cdnjs', /cdnjs\.cloudflare\.com/]]
      .forEach(([name, re]) => {
        if (!re.test(app)) return;
        ok(`privacy.html names ${name}, which index.html loads from`,
          new RegExp(name, 'i').test(priv), name);
      });

    /* The free-tier number is a promise on two public pages and a column
       default in billing.sql, transcribed by hand into both. It went from 5 to
       10 on 2026-10-08 and that is three places to change; this is the check
       that stops the pages drifting from the database the way the LinkedIn
       line did. */
    const billing = fs.readFileSync(path.join(ROOT, 'billing.sql'), 'utf8');
    const freeSearch = /free_search\s+integer[^\n]*default\s+(\d+)/.exec(billing);
    ok('billing.sql declares a free_search default', !!freeSearch);
    if (freeSearch) {
      const n = freeSearch[1];
      [['pricing.html', html], ['refund.html', fs.readFileSync(path.join(ROOT, 'refund.html'), 'utf8')]]
        .forEach(([name, text]) => {
          const claim = /(\d+)\s+free job board searches/.exec(text);
          ok(`${name} states a free-search count`, !!claim, name);
          if (claim) ok(`${name} says ${n} free searches, matching billing.sql`, claim[1] === n,
            { page: claim[1], billing: n });
        });
      /* The app prints the number too, on the sign-in screen and in the credits
         dialog. It was left at 5 when the other three moved to 10, so a new
         tester read "10 free" on the pricing page and "5 free" a click later. */
      const app = /const FREE_SEARCH_START = (\d+)/.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
      ok(`index.html says ${n} free searches, matching billing.sql`, !!app && app[1] === n, { app: app && app[1], billing: n });
    }

    /* Data residency is a compliance claim, so it is checked against the
       project, not remembered. ap-southeast-2 is SYDNEY; this check exists
       because the first draft of that sentence said Singapore. */
    ok('privacy.html does not claim a Supabase region it is not in',
      !/singapore/i.test(priv) || !/ap-southeast-2/.test(priv));

    /* And a board the page names must still be declared in the edge function. */
    ['Indeed', 'Naukri', 'Instahyre', 'CutShort', 'Foundit', 'Upwork',
     'Workable', 'Adzuna', 'Jooble', 'Careerjet', 'Remotive', 'Remote OK'].forEach((b) => {
      const flat = fn.toLowerCase().replace(/\s+/g, '');
      ok(`${b}: named on the price list and live in the code`,
        !new RegExp(b, 'i').test(html) || flat.includes(b.replace(/\s+/g, '').toLowerCase()));
    });
  }

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('failed:', e); process.exit(1); });
