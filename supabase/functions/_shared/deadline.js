// The rules a closing date has to pass, for the shared exam refresh
// (exam_refresh in ../api/index.ts). Plain JS on purpose: index.html carries the
// same rules (deadlineOk, closedOk, dateWindows) for the per-person check, and
// scripts/selfcheck-routes.js runs BOTH copies on the same cases, so the two
// cannot drift apart without a check going red.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const norm = (x) => String(x || "").toLowerCase().replace(/\s+/g, " ").trim();

export const daysTo = (d, today) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""))
  ? Math.round((new Date(d + "T00:00:00") - new Date(today + "T00:00:00")) / 864e5) : null;

/* A date counts only if its quote is on the page AND names that day and month. */
export function dateOk(text, closes, quote) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(closes || "")) || isNaN(new Date(closes))) return false;
  const q = norm(quote);
  if (q.length < 8 || !norm(text).includes(q)) return false;
  const [, m, d] = closes.split("-").map(Number);
  const dayIn = new RegExp(`(^|\\D)0?${d}(\\D|$)`).test(q);
  const monthIn = q.includes(MONTHS[m - 1]) || new RegExp(`(^|\\D)0?${m}[./-]|[./-]0?${m}(\\D|$)`).test(q);
  return dayIn && monthIn;
}

/* "Registration is over" needs words on the page that name the item, and no year older than this one. */
export function closedOk(text, quote, words, today) {
  const q = norm(quote);
  if (q.length < 12 || !norm(text).includes(q)) return false;
  const years = (q.match(/\b20\d\d\b/g) || []).map(Number);
  if (years.length && Math.max(...years) < Number(String(today).slice(0, 4))) return false;
  return words.map((w) => String(w).toLowerCase()).filter((w) => w.length > 3).some((w) => q.includes(w));
}

/* The parts of a page that can hold a date, the first one (a table's header) first. */
export function dateWindows(text, cap) {
  const t = String(text || ""), re = /last date|closing date|deadline|apply (?:by|before|till|until|on or before)|closes? on|applications? (?:open|close)|online (?:registration|application)|important dates|schedule of|registration|enddate/gi;
  const spans = []; let m;
  while ((m = re.exec(t)) && spans.length < 80) {
    const a = Math.max(0, m.index - 250), b = Math.min(t.length, m.index + 350);
    const a2 = spans.length ? Math.max(a, spans[spans.length - 1][1]) : a;
    if (b > a2) spans.push([a2, b]);
  }
  if (!spans.length) return t.slice(0, cap);
  let out = ""; for (const [a, b] of spans) { if (out.length >= cap) break; out += (out ? " … " : "") + t.slice(a, b); }
  return out.slice(0, cap);
}
