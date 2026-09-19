// Smoke test: one DeepSeek call and one TypeSafe call through the shared
// clients, to prove the keys in .env.local work. Prints no key material.
//
//   deno run --node-modules-dir=none --env-file=.env.local --allow-env --allow-net --allow-read test-apis.ts

import { choice } from "npm:@typesafe-ai/sdk@0.6.0";
import { deepseek, typesafe } from "./supabase/functions/_shared/api-clients.ts";

let failed = 0;
async function check(name: string, run: () => Promise<string>) {
  const t = performance.now();
  try {
    const out = await run();
    console.log(`PASS ${name} (${Math.round(performance.now() - t)}ms): ${out}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}

await check("deepseek", async () => {
  const r = await deepseek().chat.completions.create({
    model: "deepseek-chat", max_tokens: 10,
    messages: [{ role: "user", content: "Reply with the single word: pong" }],
  });
  return JSON.stringify(r.choices[0]?.message?.content?.trim());
});

await check("typesafe", async () => {
  const r = await typesafe().systemOne({
    state: { posting: "Senior backend engineer, Go and Postgres, fully remote, apply by Friday." },
    questions: {
      kind: choice("What kind of role is described in `posting`?", { engineering: null, sales: null, design: null }),
    },
  });
  return JSON.stringify(r.answers.kind.choice);
});

Deno.exit(failed ? 1 : 0);
