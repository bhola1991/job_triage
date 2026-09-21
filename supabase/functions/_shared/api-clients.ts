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

let ts: TypeSafeClient | undefined;
/** TypeSafe System One (Jev by default). Built on first use so a missing key
    does not take down every route in the function over one optional call. */
export function typesafe(): TypeSafeClient {
  need("TYPESAFE_API_KEY");
  return ts ??= new TypeSafeClient();
}
