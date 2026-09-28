// Records the model answers that scripts/eval/ commits, so every offline check
// downstream is deterministic. Two independent recorders, one per model:
//
//   deno run --node-modules-dir=none --env-file=.env.local --allow-env --allow-net --allow-read --allow-write \
//     scripts/record-eval.ts --deepseek [--all]
//   deno run ... scripts/record-eval.ts --jev [--only <case-id>]
//
// --deepseek fills `recorded` on any case that lacks it (--all re-records every
// case) and writes scripts/eval/cases.json. That field is what eval-matcher.js
// measures THIS repository against, so re-record it when the scoring prompt
// changes and commit the diff -- that diff is the prompt's effect, isolated.
//
// --jev writes scripts/eval/judgments.json: one raw judgement per case, which is
// what tune-flag-thresholds.js sweeps. Jev is asked all ten questions on every
// posting, so a judgement is the only way to tune FLAG_P offline.
//
// Deno rather than Node for the Jev half, because it imports the real
// _shared/judge.ts. Rebuilding those questions here would let the thing being
// measured drift from the thing being shipped, which is the whole failure this
// file exists to prevent. DEEPSEEK_API_KEY comes from the shell, not .env.local.
import { buildJudge, shapeJudge } from "../supabase/functions/_shared/judge.ts";
import { typesafe } from "../supabase/functions/_shared/api-clients.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const CASES = `${ROOT}scripts/eval/cases.json`;
const JUDGMENTS = `${ROOT}scripts/eval/judgments.json`;

const args = Deno.args;
const has = (f: string) => args.includes(f);
const argOf = (f: string) => { const i = args.indexOf(f); return i > -1 ? args[i + 1] : undefined; };

const cases = JSON.parse(await Deno.readTextFile(CASES));

/* The app is one IIFE, so nothing in it is importable: the functions have to be
   sliced out of the source and compiled as one unit. Same pattern, and same
   reason, as scripts/eval-matcher.js. */
const html = (await Deno.readTextFile(`${ROOT}index.html`)).replace(/\r\n/g, "\n");
const grab = (re: RegExp) => {
  const m = html.match(re);
  if (!m) throw new Error("missing " + re);
  return m[0];
};
const APP = new Function(
  grab(/const today = [^\n]*\n/) +
  /* LLM.deepseek.body reads both of these. Sliced rather than restated so the
     recording is made on the model the app actually scores with, reasoning
     budget and all -- a `recorded` captured on a different model measures
     nothing this repo ships. */
  grab(/const TOK_CAP = [^\n]*\n/) +
  grab(/const DS_MODELS = [^\n]*\n/) +
  grab(/const LLM = \{[\s\S]*?\n\};\n/) +
  grab(/function grabJSON[\s\S]*?\n}\n/) +
  grab(/function sysPrompt\(prof, track\)\{[\s\S]*?JSON object only\.`;\n}\n/) +
  grab(/const candidateOf = [\s\S]*?\n\};\n/) +
  ";return {sysPrompt,grabJSON,candidateOf,LLM};",
)() as {
  sysPrompt: (p: unknown, t: unknown) => string;
  grabJSON: (s: string) => any;
  candidateOf: (p: any, t: string) => unknown;
  LLM: any;
};

const track = (cases.profile.tracks || [])[0] || {};

// ── DeepSeek: the `recorded` field ─────────────────────────────────────────
if (has("--deepseek")) {
  const key = Deno.env.get("DEEPSEEK_API_KEY");
  if (!key) throw new Error("DEEPSEEK_API_KEY is not set (it comes from the shell, not .env.local)");
  const todo = cases.cases.filter((c: any) => has("--all") || !c.recorded);
  if (!todo.length) console.log("every case already has `recorded`; pass --all to re-record");

  // Batched the way the app batches, so the model sees the same shape of request
  // it sees in production rather than a one-job prompt it never gets.
  const SIZE = 6;
  for (let i = 0; i < todo.length; i += SIZE) {
    const batch = todo.slice(i, i + SIZE);
    const jobs = batch.map((c: any, k: number) => ({
      id: String(i + k),
      title: String(c.job.title || ""),
      company: String(c.job.company || ""),
      location: String(c.job.location || ""),
      description: String(c.job.description || "").slice(0, 700) || "(no description available)",
    }));
    const cfg = APP.LLM.deepseek;
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: cfg.headers(key),
      // No tier and no token override: the default is the pro model with
      // reasoning on, which is what a scoring run gets.
      body: JSON.stringify(cfg.body(APP.sysPrompt(cases.profile, track) + "\n\nJOBS TO SCORE:\n" + JSON.stringify(jobs))),
    });
    if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const parsed = APP.grabJSON(cfg.read(await res.json()));
    const items: any[] = Array.isArray(parsed) ? parsed : (parsed.r || parsed.results || []);
    const byId: Record<string, any> = {};
    items.forEach((it) => { byId[String(it.id)] = it; });
    batch.forEach((c: any, k: number) => {
      const it = byId[String(i + k)];
      if (!it) { console.warn(`  ${c.id}: no answer in the batch`); return; }
      // The RAW item, short keys and all -- eval-matcher.js reads recorded.s,
      // recorded.re, recorded.c and recorded.f directly.
      const rec: any = { s: it.s ?? it.score ?? 0, re: it.re ?? it.reachability ?? 45, c: String(it.c ?? it.confidence ?? "l").toLowerCase(), f: it.f ?? it.flags ?? [] };
      c.recorded = rec;
      console.log(`  ${c.id.padEnd(24)} s=${rec.s} re=${rec.re} c=${rec.c} f=${JSON.stringify((rec.f || []).map((x: any) => x.code))}`);
    });
  }
  await Deno.writeTextFile(CASES, JSON.stringify(cases, null, 2) + "\n");
  console.log(`wrote ${CASES}`);
}

// ── Jev: scripts/eval/judgments.json ───────────────────────────────────────
if (has("--jev")) {
  const only = argOf("--only");
  const out: any = { _note: "", model: "", recorded: new Date().toISOString().slice(0, 10), judgments: {} };
  try {
    const prev = JSON.parse(await Deno.readTextFile(JUDGMENTS));
    out.judgments = prev.judgments || {};
  } catch { /* first run */ }

  const candidate = APP.candidateOf(cases.profile, track.id);
  let models = new Set<string>();
  let inTok = 0;
  for (const c of cases.cases) {
    if (only && c.id !== only) continue;
    const posting = {
      title: String(c.job.title || ""), company: String(c.job.company || ""),
      location: String(c.job.location || ""),
      description: String(c.job.description || "").slice(0, 4000),
    };
    const { state, questions } = buildJudge(posting, candidate);
    const jv = shapeJudge(await typesafe().systemOne({ state, questions }));
    models.add(jv.model);
    inTok += jv.usage?.input_tokens || 0;
    out.judgments[c.id] = jv;
    const fired = jv.flags.filter((f: any) => f.probability >= 0.5).map((f: any) => f.code);
    console.log(`  ${c.id.padEnd(24)} conf=${String(jv.confidence).padEnd(6)} fired@0.5=${JSON.stringify(fired)}`);
  }
  out.model = [...models].join(",");
  out._note =
    "Raw Jev judgements, one per case in cases.json, captured live and committed so scripts/tune-flag-thresholds.js " +
    "runs offline and deterministically. Written by scripts/record-eval.ts --jev. Nothing is thresholded here: the whole " +
    "point is that the probabilities are kept raw so a threshold sweep costs nothing to re-run. Re-record when the " +
    "questions in supabase/functions/_shared/judge.ts change, or when the model does -- a calibrated cut point does not " +
    "survive a model bump, so `model` above is the version any threshold in the repo was tuned against.";
  await Deno.writeTextFile(JUDGMENTS, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${JUDGMENTS} (model ${out.model}, ${inTok} input tokens)`);
}

if (!has("--deepseek") && !has("--jev")) {
  console.error("nothing to do: pass --deepseek and/or --jev");
  Deno.exit(2);
}
