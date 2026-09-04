// ARMUS - iyzico redirects the buyer's browser here once they finish (or
// abandon) a "Para Ekle" wallet top-up. Re-checks the payment status with
// iyzico itself before crediting anything, same as payment-callback does
// for bookings.
//
// IMPORTANT: after deploying, go to this function's Settings and turn
// OFF "Verify JWT" - this call carries no Supabase auth token, same as
// payment-callback.
//
// Needs the same secrets as create-wallet-topup (IYZICO_API_KEY,
// IYZICO_SECRET_KEY, optionally IYZICO_BASE_URL), plus:
//   SITE_URL - defaults to "https://armus.vercel.app"

import Iyzipay from "npm:iyzipay@^2.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const iyzipay = new Iyzipay({
  apiKey: Deno.env.get("IYZICO_API_KEY") ?? "",
  secretKey: Deno.env.get("IYZICO_SECRET_KEY") ?? "",
  uri: Deno.env.get("IYZICO_BASE_URL") ?? "https://sandbox-api.iyzipay.com",
});

const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://armus.vercel.app").replace(/\/$/, "");

function redirectTo(path: string) {
  return new Response(null, { status: 302, headers: { Location: `${SITE_URL}/${path}` } });
}

Deno.serve(async (req) => {

  let token = "";
  try {
    const form = await req.formData();
    token = String(form.get("token") || "");
  } catch {
    token = new URL(req.url).searchParams.get("token") || "";
  }

  if (!token) return redirectTo("wallet.html?topup=failed");

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: topup } = await supabaseAdmin
    .from("wallet_topups")
    .select("*")
    .eq("iyzico_token", token)
    .maybeSingle();

  if (!topup) return redirectTo("wallet.html?topup=failed");

  // iyzico can call this more than once for the same token
  if (topup.status === "succeeded") {
    return redirectTo("wallet.html?topup=success");
  }

  let result: any;
  try {
    result = await new Promise((resolve, reject) => {
      iyzipay.checkoutForm.retrieve({ locale: Iyzipay.LOCALE.TR, token }, (err: unknown, res: unknown) => {
        if (err) reject(err); else resolve(res);
      });
    });
  } catch (err) {
    console.error("iyzico retrieve failed", err);
    return redirectTo("wallet.html?topup=failed");
  }

  if (result.status !== "success" || result.paymentStatus !== "SUCCESS") {
    await supabaseAdmin.from("wallet_topups").update({ status: "failed" }).eq("id", topup.id);
    return redirectTo("wallet.html?topup=failed");
  }

  const { data: studentProfile } = await supabaseAdmin
    .from("profiles")
    .select("wallet_balance")
    .eq("id", topup.student_id)
    .single();

  await supabaseAdmin
    .from("profiles")
    .update({ wallet_balance: Number(studentProfile?.wallet_balance || 0) + Number(topup.amount) })
    .eq("id", topup.student_id);

  await supabaseAdmin.from("wallet_transactions").insert({
    student_id: topup.student_id,
    amount: topup.amount,
    reason: "topup",
  });

  await supabaseAdmin
    .from("wallet_topups")
    .update({ status: "succeeded", iyzico_payment_id: result.paymentId ?? null })
    .eq("id", topup.id);

  return redirectTo("wallet.html?topup=success");
});
