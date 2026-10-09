#!/usr/bin/env node
// Does src/reply-match.mjs decide the right thing about an inbound email?
//
//   node scripts/selfcheck-reply.js
//
// Why this check exists
// --------------------
// jobs.stage reaching 'live' is the ONLY record in this project that anybody
// ever heard back, and every claim about matcher quality is measured against
// it. So the automation that writes it has to be wrong in the safe direction:
// a missed reply costs the user one click, a false reply silently corrupts the
// ground truth and there is nothing left to notice it with.
//
// The fixtures below are therefore mostly near-misses: mail that reads like a
// reply and is not, companies that nearly match, senders that nearly resolve.
// Each case asserts the ACTION, not a score, because the action is what
// touches the database.
//
// Offline on purpose -- no network, no model, no Supabase. The classifier is
// phrase sets precisely so this can run in the §8 harness beside the others.
'use strict';

let fail = 0;
const ok = (name, cond, got) => {
  if (cond) return;
  fail++;
  console.log(`  FAIL ${name}${got === undefined ? '' : `  got ${JSON.stringify(got)}`}`);
};

/* The user's pipeline. Two Acme-ish rows on purpose: 'Acme Pvt Ltd' and
   'Acme Labs' normalise to the same thing ('acme'), which is the ambiguity an
   over-eager matcher would resolve by picking one. */
const JOBS = [
  { job_key: 'u:gh-acme', company: 'Acme Pvt Ltd',  url: 'https://boards.greenhouse.io/acme/jobs/1', stage: 'sent' },
  { job_key: 'u:acme-labs', company: 'Acme Labs',   url: 'https://acmelabs.io/careers/2',            stage: 'sent' },
  { job_key: 'u:zephyr',  company: 'Zephyr Systems', url: 'https://zephyr.co.in/jobs/7',             stage: 'sent' },
  { job_key: 'u:nimbus',  company: 'Nimbus',        url: 'https://jobs.lever.co/nimbus/3',           stage: 'sent' },
  { job_key: 'u:talked',  company: 'Orbit',         url: 'https://orbit.dev/careers/9',              stage: 'live' },
  { job_key: 'u:untouched', company: 'Quarry',      url: 'https://quarry.io/jobs/4',                 stage: 'new' },
  { job_key: 'u:gone',    company: 'Vellum',        url: 'https://vellum.com/jobs/5',                stage: 'sent', deleted: true },
];

const mail = (o) => ({ to: 'r.' + 'a'.repeat(32) + '@in.jobtriage.app', date: '2026-10-05T09:00:00Z', ...o });

(async () => {
  const M = await import('../src/reply-match.mjs');
  const { decide, classify, matchJob, normCompany, hostRoot, tokenFrom } = M;

  /* ── normalising ──────────────────────────────────────────────────────── */
  console.log('normalising');
  ok('suffixes drop', normCompany('Acme Pvt Ltd') === 'acme', normCompany('Acme Pvt Ltd'));
  ok('ampersand spelled', normCompany('Smith & Co') === 'smith and', normCompany('Smith & Co'));
  ok('punctuation drops', normCompany('Zephyr-Systems, Inc.') === 'zephyr', normCompany('Zephyr-Systems, Inc.'));
  ok('two labels', hostRoot('mail.careers.acme.com') === 'acme.com', hostRoot('mail.careers.acme.com'));
  ok('co.in keeps three', hostRoot('careers.zephyr.co.in') === 'zephyr.co.in', hostRoot('careers.zephyr.co.in'));
  ok('address strips', hostRoot('hr@acme.com') === 'acme.com', hostRoot('hr@acme.com'));
  ok('bare label is nothing', hostRoot('localhost') === '', hostRoot('localhost'));

  /* ── routing ──────────────────────────────────────────────────────────── */
  console.log('routing');
  ok('token read', tokenFrom(`r.${'b'.repeat(32)}@in.jobtriage.app`) === 'b'.repeat(32));
  ok('token in a list', tokenFrom(`other@x.com, "R" <r.${'c'.repeat(32)}@in.jobtriage.app>`) === 'c'.repeat(32));
  ok('short token refused', tokenFrom('r.abc@in.jobtriage.app') === null);
  ok('wrong prefix refused', tokenFrom(`x.${'a'.repeat(32)}@in.jobtriage.app`) === null);
  ok('no token', tokenFrom('hello@in.jobtriage.app') === null);

  /* ── the three outcomes ───────────────────────────────────────────────── */
  console.log('outcomes');

  // An ATS receipt. The case that must NOT become a reply.
  let d = decide(mail({
    from: 'Greenhouse <no-reply@us.greenhouse-mail.io>',
    subject: 'Thank you for applying to Zephyr Systems',
    text: 'We have received your application and will review your background shortly.',
    headers: { 'auto-submitted': 'auto-generated' },
  }), JOBS);
  ok('ats ack is an ack', d.kind === 'ack', d);
  ok('ats ack confirms applied', d.action === 'confirm-applied', d.action);
  ok('ats ack found the company', d.matched === 'u:zephyr', d.matched);

  // A rejection, believed even though it is automated.
  d = decide(mail({
    from: 'Nimbus Recruiting <no-reply@hire.lever.co>',
    subject: 'Your application to Nimbus',
    text: 'After careful review we have decided to move forward with other candidates.',
    headers: { 'list-unsubscribe': '<https://hire.lever.co/u>' },
  }), JOBS);
  ok('rejection classified', d.kind === 'reject', d);
  ok('rejection closes', d.action === 'set-stage' && d.stage === 'closed', d);

  // A person, from the company's own domain. The one that earns 'live'.
  d = decide(mail({
    from: 'Priya Rao <priya@zephyr.co.in>',
    subject: 'Re: Data Engineer',
    text: 'Thanks for your note. Are you available for a 30 minute call this week?',
  }), JOBS);
  ok('human reply classified', d.kind === 'human', d);
  ok('human reply goes live', d.action === 'set-stage' && d.stage === 'live', d);
  ok('matched on sender domain', d.how === 'sender-domain=url-host', d.how);

  /* ── the near-misses ──────────────────────────────────────────────────── */
  console.log('near-misses');

  // Reads exactly like a reply; a bulk header says it is not.
  d = decide(mail({
    from: 'Zephyr Careers <careers@zephyr.co.in>',
    subject: 'Interview tips from Zephyr',
    text: 'Want to schedule a call with one of our recruiters? Here is how to prepare.',
    headers: { 'list-id': '<news.zephyr.co.in>' },
  }), JOBS);
  ok('bulk header vetoes human', d.kind === 'unclear', d);
  ok('bulk header writes nothing', d.action === 'note-only', d.action);

  // Same, vetoed by the sender box instead of a header.
  d = decide(mail({
    from: 'no-reply@zephyr.co.in',
    subject: 'Next steps',
    text: 'Please book a time using the link below. Do not reply to this message.',
  }), JOBS);
  ok('do-not-reply vetoes human', d.kind === 'unclear', d);
  ok('do-not-reply writes nothing', d.action === 'note-only', d.action);

  // Two rows normalise to 'acme'. Picking one would be a coin flip.
  d = decide(mail({
    from: 'recruiting@us.greenhouse-mail.io',
    subject: 'Your application to Acme',
    text: 'A recruiter at Acme would like to speak with you about next steps.',
  }), JOBS);
  ok('ambiguous company refuses', d.action === 'store-unmatched', d);
  ok('ambiguity is named', d.how === 'ambiguous-company-in-text', d.how);

  // A company the user never applied to.
  d = decide(mail({
    from: 'talent@unrelated-corp.com',
    subject: 'We are hiring!',
    text: 'Are you available for a quick chat about a role at Unrelated Corp?',
  }), JOBS);
  ok('unknown company unmatched', d.action === 'store-unmatched', d);
  ok('unknown company named', d.how === 'unmatched', d.how);

  // A job at stage 'new' cannot receive a reply -- nobody applied.
  d = decide(mail({
    from: 'hr@quarry.io',
    subject: 'Re: your interest',
    text: 'Are you available to interview next Tuesday?',
  }), JOBS);
  ok('stage new is not a candidate', d.matched === null, d);

  // Deleted rows are not candidates either.
  d = decide(mail({
    from: 'hr@vellum.com',
    subject: 'Re: application',
    text: 'Could you share your notice period?',
  }), JOBS);
  ok('deleted row is not a candidate', d.matched === null, d);

  // Already live: no second announcement.
  d = decide(mail({
    from: 'sam@orbit.dev',
    subject: 'Re: Re: chat',
    text: 'Following up -- what are your salary expectations?',
  }), JOBS);
  ok('already live notes only', d.action === 'note-only' && d.matched === 'u:talked', d);

  // Nothing fires. 'unclear' is the honest answer and changes nothing.
  d = decide(mail({
    from: 'priya@zephyr.co.in',
    subject: 'Re: Data Engineer',
    text: 'Noted, thanks.',
  }), JOBS);
  ok('no cue is unclear', d.kind === 'unclear' && d.action === 'note-only', d);

  /* ── ordering ─────────────────────────────────────────────────────────── */
  console.log('ordering');

  // A rejection that also thanks you for applying must read as a rejection.
  let c = classify({
    from: 'no-reply@ashbyhq.com',
    subject: 'Your application',
    text: 'Thank you for applying to Nimbus. Unfortunately, we are not moving forward.',
  });
  ok('reject beats ack', c.kind === 'reject', c);

  // An ack that mentions an interview must not read as a reply.
  c = classify({
    from: 'no-reply@workable.com',
    subject: 'Application received',
    text: 'We have received your application. If shortlisted we will invite you to an interview.',
  });
  ok('ack beats human cue', c.kind === 'ack', c);

  // The thread hook beats sender and text when a Message-ID is on the row.
  const threaded = JOBS.map((j) => (j.job_key === 'u:nimbus' ? { ...j, sent_message_id: '<abc@jobtriage>' } : j));
  const m = matchJob(mail({
    from: 'someone@elsewhere.example',
    inReplyTo: '<ABC@jobtriage>',
    subject: 'Re: Zephyr Systems role',
    text: 'about Zephyr Systems',
  }), threaded);
  ok('in-reply-to wins', m.job && m.job.job_key === 'u:nimbus', m.how);

  /* ── MIME, as it actually arrives ─────────────────────────────────────── */
  console.log('mime');
  const P = await import('../src/mime-lite.mjs');

  // Folded headers. A Content-Type with its boundary on the next line is the
  // ordinary case, and not unfolding it loses the body entirely.
  let pm = P.parseMail([
    'From: Priya Rao <priya@zephyr.co.in>',
    'Subject: Re: Data Engineer',
    'Content-Type: multipart/alternative;',
    '\tboundary="==_b1_=="',
    'Message-ID: <m1@zephyr>',
    '',
    '--==_b1_==',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Are you available for a call this week?',
    '--==_b1_==',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Are you available for a call this week?</p>',
    '--==_b1_==--',
  ].join('\r\n'));
  ok('folded boundary read', pm.text.includes('available for a call'), pm.text);
  ok('subject read', pm.subject === 'Re: Data Engineer', pm.subject);
  ok('plain part preferred over html', !pm.text.includes('<p>'), pm.text);

  // quoted-printable, with a multi-byte character split across two =XX.
  pm = P.parseMail([
    'From: hr@zephyr.co.in', 'Subject: Re: role',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable', '',
    'Caf=C3=A9 chat =E2=80=94 are you available=',
    ' next week?',
  ].join('\r\n'));
  ok('qp decodes utf-8', pm.text.includes('Café') && pm.text.includes('—'), pm.text);
  ok('qp soft break joined', pm.text.includes('available next week'), pm.text);

  // base64, which is how most ATS mail arrives.
  pm = P.parseMail([
    'From: no-reply@us.greenhouse-mail.io', 'Subject: Thank you for applying to Zephyr Systems',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64', '',
    Buffer.from('We have received your application.', 'utf8').toString('base64'),
  ].join('\r\n'));
  ok('base64 decodes', pm.text.includes('received your application'), pm.text);

  // html only, tags stripped.
  pm = P.parseMail([
    'From: hr@zephyr.co.in', 'Subject: hello',
    'Content-Type: text/html; charset=utf-8', '',
    '<div><style>p{}</style><p>Are you&nbsp;available?</p></div>',
  ].join('\r\n'));
  ok('html stripped', pm.text === 'Are you available?', pm.text);

  // Headers the classifier vetoes on must survive parsing.
  pm = P.parseMail(['From: a@b.com', 'List-Unsubscribe: <https://x>', 'Subject: s', '', 'body'].join('\r\n'));
  ok('bulk header survives', pm.headers['list-unsubscribe'] !== undefined, Object.keys(pm.headers));

  // An attachment part must not become the body.
  pm = P.parseMail([
    'From: hr@zephyr.co.in', 'Subject: s',
    'Content-Type: multipart/mixed; boundary="b2"', '',
    '--b2', 'Content-Type: application/pdf; name="jd.pdf"',
    'Content-Disposition: attachment; filename="jd.pdf"', '', 'JVBERi0x',
    '--b2', 'Content-Type: text/plain', '', 'Could you share your notice period?',
    '--b2--',
  ].join('\r\n'));
  ok('attachment skipped', pm.text.includes('notice period'), pm.text);

  /* ── Gmail's forwarding handshake ─────────────────────────────────────── */
  console.log('gmail handshake');
  const conf = P.parseMail([
    'From: Gmail Team <forwarding-noreply@google.com>',
    'Subject: Gmail Forwarding Confirmation - Receive Mail from you@gmail.com', '',
    'Confirmation code: 123456789',
  ].join('\r\n'));
  ok('confirmation code found', P.gmailConfirmCode(conf) === '123456789', P.gmailConfirmCode(conf));
  ok('not a reply', classify(conf).kind !== 'human', classify(conf));
  const spoof = P.parseMail(['From: attacker@evil.com', 'Subject: Gmail Forwarding Confirmation', '', 'Confirmation code: 999999999'].join('\r\n'));
  ok('spoofed confirmation refused', P.gmailConfirmCode(spoof) === null, P.gmailConfirmCode(spoof));
  // What Gmail really sent on 2026-10-09: no code anywhere, a confirm link
  // (vf-) and a cancel link (uf-) in the body.
  const confLink = P.parseMail([
    'From: forwarding-noreply@google.com',
    'Subject: (Gmail Forwarding Confirmation - Receive Mail from you@gmail.com', '',
    'you@gmail.com has requested to automatically forward mail to your email address.',
    'please click the link below to confirm the request:',
    'https://mail-settings.google.com/mail/vf-%5BANGjdJ_9jOO%5D-QS1pzNn',
    'click this link to cancel this verification:',
    'https://mail.google.com/mail/uf-%5BANGjdJ8sq%5D-QS1pzNn',
    'http://support.google.com/mail/bin/answer.py?answer=184973.',
  ].join('\r\n'));
  ok('no code in a link-only confirmation', P.gmailConfirmCode(confLink) === null, P.gmailConfirmCode(confLink));
  ok('confirm link found, not the cancel link',
    P.gmailConfirmLink(confLink) === 'https://mail-settings.google.com/mail/vf-%5BANGjdJ_9jOO%5D-QS1pzNn', P.gmailConfirmLink(confLink));
  const spoofLink = P.parseMail(['From: attacker@evil.com', 'Subject: Gmail Forwarding Confirmation', '', 'https://mail.google.com/mail/vf-abc'].join('\r\n'));
  ok('spoofed confirm link refused', P.gmailConfirmLink(spoofLink) === null, P.gmailConfirmLink(spoofLink));
  const offHost = P.parseMail(['From: forwarding-noreply@google.com', 'Subject: Gmail Forwarding Confirmation', '', 'https://mail.google.com.evil.com/mail/vf-abc https://evil.com/mail/vf-abc'].join('\r\n'));
  ok('link on another host refused', P.gmailConfirmLink(offHost) === null, P.gmailConfirmLink(offHost));
  const cancelOnly = P.parseMail(['From: forwarding-noreply@google.com', 'Subject: Gmail Forwarding Confirmation', '', 'https://mail.google.com/mail/uf-abc'].join('\r\n'));
  ok('cancel link alone is not offered', P.gmailConfirmLink(cancelOnly) === null, P.gmailConfirmLink(cancelOnly));
  const notconf = P.parseMail(['From: noreply@google.com', 'Subject: Security alert', '', 'New sign-in 123456789'].join('\r\n'));
  ok('unrelated google mail is not a code', P.gmailConfirmCode(notconf) === null, P.gmailConfirmCode(notconf));

  /* ── raw email straight through to a decision ─────────────────────────── */
  console.log('end to end');
  const raw = [
    'From: Priya Rao <priya@zephyr.co.in>',
    'To: r.' + 'a'.repeat(32) + '@jobtriage.app',
    'Subject: Re: Data Engineer role',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable', '',
    'Thanks =E2=80=94 are you available for a call on Thursday?',
  ].join('\r\n');
  const parsed = P.parseMail(raw);
  ok('token routed off the envelope', tokenFrom(parsed.to) === 'a'.repeat(32), parsed.to);
  d = decide(parsed, JOBS);
  ok('raw mail reaches live', d.action === 'set-stage' && d.stage === 'live', d);

  // The same mail, with a bulk header bolted on, must write nothing.
  const bulked = P.parseMail(raw.replace('Subject:', 'List-Id: <news>\r\nSubject:'));
  ok('bulk header survives to the veto', decide(bulked, JOBS).action === 'note-only', decide(bulked, JOBS));

  console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('failed:', e); process.exit(1); });
