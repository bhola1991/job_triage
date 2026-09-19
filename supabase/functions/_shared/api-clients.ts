// The DeepSeek and TypeSafe clients, in one place, for the edge functions.
//
// Server-side only. Keys come from Supabase secrets (Deno.env) in production and
// from .env.local when a local script loads this file -- never from the browser.
//
// Both clients are built on first use, not at import: a constructor that throws
// on a missing key would otherwise take down every route in the function,
// payments included, over a secret only one route needs.

import OpenAI from "npm:openai@7.18.0";
import { TypeSafeClient } from "npm:@typesafe-ai/sdk@0.6.0";

const need = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`server is missing the ${k} secret`);
  return v;
};

let ds: OpenAI | undefined;
/** DeepSeek through its OpenAI-compatible API. */
export function deepseek(): OpenAI {
  // maxRetries 0: the llm route has already taken a credit and refunds on
  // failure, and a silent retry of a long completion can outlast the edge
  // function's wall-clock limit.
  return ds ??= new OpenAI({ baseURL: "https://api.deepseek.com", apiKey: need("DEEPSEEK_API_KEY"), maxRetries: 0 });
}

let ts: TypeSafeClient | undefined;
/** TypeSafe System One. The SDK reads TYPESAFE_API_KEY itself; checked here so a
    missing secret fails with the same message as the others. */
export function typesafe(): TypeSafeClient {
  need("TYPESAFE_API_KEY");
  return ts ??= new TypeSafeClient();
}
