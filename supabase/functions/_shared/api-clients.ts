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
   release on our side and no error to notice. Set TYPESAFE_MODEL to a real
   model name to freeze it.

   It is not hard-coded here because no model name should be written into this
   file from memory -- the account's own list is the only authority on what
   exists. Every judgment records the model it actually ran on in the usage
   ledger, so the name to pin is one query away rather than a guess. */
const MODEL = Deno.env.get("TYPESAFE_MODEL") || undefined;

let ts: TypeSafeClient | undefined;
/** TypeSafe System One (Jev by default). Built on first use so a missing key
    does not take down every route in the function over one optional call. */
export function typesafe(): TypeSafeClient {
  need("TYPESAFE_API_KEY");
  return ts ??= new TypeSafeClient({ defaultModel: MODEL });
}
