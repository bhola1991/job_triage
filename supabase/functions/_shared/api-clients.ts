// The TypeSafe client, server-side only. The API key comes from a Supabase
// secret in production and from .env.local when a local script (test-judge.ts)
// loads this file — never from the browser. The edge function must keep this
// key to itself; the browser sends only a Supabase session and structured state.

import { TypeSafeClient } from "npm:@typesafe-ai/sdk@0.6.0";

const need = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`server is missing the ${k} secret`);
  return v;
};

/* Which Jev to ask. Left unset the SDK sends "jev-latest", and "latest" is a
   moving target: the model behind it can change behaviour and price with no
   release on our side and no error to notice.

   Pinned 2026-09-28. The name is not written from memory -- it is what a live
   judgment reported as the model it actually ran on, which is the account's
   own answer rather than a guess. TYPESAFE_MODEL still overrides it, so trying
   a newer Jev needs no deploy.

   Pinning is what makes FLAG_P meaningful. That cut is calibrated against
   probabilities recorded from this model (scripts/eval/judgments.json); on a
   different one the same 0.8 means something else, and nothing would error.
   Moving this line means re-recording and re-running the sweep. */
const MODEL = Deno.env.get("TYPESAFE_MODEL") || "jev-1.13.0";

let ts: TypeSafeClient | undefined;
/** TypeSafe System One (Jev by default). Built on first use so a missing key
    does not take down every route in the function over one optional call. */
export function typesafe(): TypeSafeClient {
  need("TYPESAFE_API_KEY");
  return ts ??= new TypeSafeClient({ defaultModel: MODEL });
}
