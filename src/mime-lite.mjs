// Enough MIME to classify an email, and no more.
//
// Why this is hand-written
// -----------------------
// Cloudflare hands an Email Worker `message.raw` as a stream and no parser.
// The usual answer is postal-mime from npm -- but this repo has no
// package.json at the root, on purpose (CLAUDE.md §3: "Open index.html. That's
// the whole install."), and adding one so a Worker can read a Subject line is
// the wrong trade.
//
// So this is deliberately minimal, and it is honest about that. What it does:
// unfold the header block, pick the first text/plain part of a multipart body
// (falling back to text/html with tags stripped), and decode base64 and
// quoted-printable. What it does NOT do: nested multiparts beyond one level,
// RFC 2047 encoded-words in the Subject, attachments, signature verification.
//
// Degrading is cheap here, which is why minimal is acceptable. The classifier
// in reply-match.mjs reads the SUBJECT plus body cues, and the subject arrives
// from message.headers without any of this. A body that fails to decode costs
// a classification that comes back 'unclear' and writes nothing -- the same
// safe direction everything else in this feature fails in.

/* Read a bounded prefix of the raw message. 256 KB is far past any plausible
   recruiter reply and far short of an attachment, so a mail with a 4 MB PDF
   costs us the attachment and not the memory. */
const RAW_CAP = 256 * 1024;

export async function readRaw(stream, cap = RAW_CAP) {
  if (typeof stream === 'string') return stream.slice(0, cap);
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= cap) break;
  }
  const buf = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { buf.set(c.subarray(0, Math.min(c.length, size - at)), at); at += c.length; }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, Math.min(at, cap)));
}

/* Headers are case-insensitive and may be folded across lines (RFC 5322
   §2.2.3): a continuation starts with whitespace and belongs to the header
   above it. Unfolding first is what makes a long Content-Type with its
   boundary on the second line readable at all. */
export function splitHeaders(src) {
  const end = src.search(/\r?\n\r?\n/);
  const head = end === -1 ? src : src.slice(0, end);
  const body = end === -1 ? '' : src.slice(end).replace(/^\r?\n\r?\n/, '');
  const headers = {};
  let last = null;
  for (const raw of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(raw) && last) { headers[last] += ' ' + raw.trim(); continue; }
    const i = raw.indexOf(':');
    if (i <= 0) continue;
    last = raw.slice(0, i).trim().toLowerCase();
    // First wins. A second Subject: is either a bug or an attempt at one.
    if (!(last in headers)) headers[last] = raw.slice(i + 1).trim();
  }
  return { headers, body };
}

const param = (v, name) => {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"|${name}\\s*=\\s*([^;\\s]+)`, 'i').exec(String(v || ''));
  return m ? (m[1] ?? m[2]) : null;
};

function decodeB64(s) {
  try {
    const clean = s.replace(/[^A-Za-z0-9+/=]/g, '');
    const bin = typeof atob === 'function' ? atob(clean) : Buffer.from(clean, 'base64').toString('binary');
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch { return ''; }
}

/* Quoted-printable: soft line breaks are an '=' at end of line, and =XX is a
   byte. Decoded to bytes first and then as UTF-8, because a multi-byte
   character arrives as several =XX in a row and decoding each one alone turns
   every non-ASCII name into mojibake. */
function decodeQP(s) {
  const joined = s.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === '=' && /^[0-9a-f]{2}$/i.test(joined.slice(i + 1, i + 3))) {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const cp = joined.charCodeAt(i);
      if (cp < 128) bytes.push(cp);
      else for (const b of new TextEncoder().encode(joined[i])) bytes.push(b);
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
}

function decodeBody(body, enc) {
  const e = String(enc || '').toLowerCase().trim();
  if (e === 'base64') return decodeB64(body);
  if (e === 'quoted-printable') return decodeQP(body);
  return body;
}

/* Tags out, entities for the five characters that actually appear in prose,
   and whitespace collapsed. Not sanitisation -- nothing renders this, it is
   only ever matched against phrase sets and stored as an excerpt. */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* One level of multipart, preferring text/plain. A multipart/alternative holds
   the same message twice and the plain half is the one written for reading;
   going deeper would mean handling multipart/related inside alternative inside
   mixed, which is where a real parser earns its keep and this one stops. */
function bodyText(headers, body) {
  const ct = headers['content-type'] || '';
  const boundary = param(ct, 'boundary');
  if (!/^multipart\//i.test(ct) || !boundary) {
    const txt = decodeBody(body, headers['content-transfer-encoding']);
    return /^text\/html/i.test(ct) ? htmlToText(txt) : txt;
  }
  const parts = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?\\r?\\n?`));
  let html = null;
  for (const part of parts) {
    if (!part.trim()) continue;
    const p = splitHeaders(part);
    const pct = p.headers['content-type'] || 'text/plain';
    if (/^multipart\//i.test(pct)) {
      const inner = bodyText(p.headers, p.body);
      if (inner) return inner;
      continue;
    }
    if (param(pct, 'name') || /attachment/i.test(p.headers['content-disposition'] || '')) continue;
    const txt = decodeBody(p.body, p.headers['content-transfer-encoding']);
    if (/^text\/plain/i.test(pct) && txt.trim()) return txt;
    if (/^text\/html/i.test(pct) && txt.trim() && html === null) html = htmlToText(txt);
  }
  return html || '';
}

/* The shape reply-match.mjs expects, from a raw message. */
export function parseMail(raw) {
  const { headers, body } = splitHeaders(String(raw || ''));
  return {
    headers,
    from: headers.from || '',
    to: headers.to || '',
    subject: headers.subject || '',
    date: headers.date || null,
    inReplyTo: headers['in-reply-to'] || '',
    references: headers.references || '',
    messageId: headers['message-id'] || '',
    text: bodyText(headers, body),
  };
}

/* ── Gmail's forwarding handshake ────────────────────────────────────────── */

/* Setting up a Gmail forward is not one step: Gmail mails a confirmation code
   to the destination and will not forward anything until it is entered back.
   That mail lands HERE, where the person cannot read it -- so without this the
   setup instructions end in a dead end.
   Recognised narrowly, by sender AND shape, because a code surfaced in the UI
   is a code someone is going to paste somewhere. */
const GMAIL_CONFIRM_FROM = /(^|[@.])google\.com$/i;

export function gmailConfirmCode(mail) {
  const from = String(mail.from || '').toLowerCase();
  const dom = (from.match(/<([^>]+)>/)?.[1] || from).split('@')[1] || '';
  if (!GMAIL_CONFIRM_FROM.test(dom)) return null;
  const hay = `${mail.subject || ''}\n${mail.text || ''}`;
  if (!/forward/i.test(hay)) return null;
  const m = /confirmation code[^0-9]{0,40}(\d{6,12})/i.exec(hay) || /\b(\d{9})\b/.exec(hay);
  return m ? m[1] : null;
}
