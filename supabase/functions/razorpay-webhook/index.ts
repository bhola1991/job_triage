// Razorpay -> credits, for when the buyer closes the tab before checkout's
// success callback reaches `api`. Deploy with --no-verify-jwt: Razorpay has no
// Supabase session; the webhook signature is what authenticates it.
//
// Secret: RAZORPAY_WEBHOOK_SECRET (the one you type when creating the webhook).
// Dashboard: Settings -> Webhooks -> URL .../functions/v1/razorpay-webhook, event "order.paid".

import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function hmacHex(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const raw = await req.text();             // signature is over the exact bytes
  const got = req.headers.get("X-Razorpay-Signature") || "";
  const want = await hmacHex(Deno.env.get("RAZORPAY_WEBHOOK_SECRET")!, raw);
  let diff = got.length ^ want.length;
  for (let i = 0; i < want.length; i++) diff |= (got.charCodeAt(i) || 0) ^ want.charCodeAt(i);
  if (diff) return new Response("bad signature", { status: 400 });
  const ev = JSON.parse(raw);
  if (ev.event === "order.paid") {
    const order = ev.payload?.order?.entity?.id;
    const payment = ev.payload?.payment?.entity?.id;
    const { error } = await admin.rpc("mark_order_paid", { p_order: order, p_payment: payment });
    if (error) return new Response("retry", { status: 500 });   // Razorpay retries non-2xx
  }
  return new Response("ok");
});
