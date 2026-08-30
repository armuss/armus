// ARMUS - iyzico redirects the buyer's browser here once they finish (or
// abandon) the Checkout Form. This is the ONLY place a real booking row
// ever gets created from a paid booking - it re-checks the payment status
// with iyzico itself (never trusts the redirect alone, which anyone could
// forge) before writing anything.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function,
// name it "payment-callback", paste this file in, Deploy. Then copy its
// URL (https://<project-ref>.functions.supabase.co/payment-callback) -
// create-payment already builds this same URL itself, so nothing needs
// to be pasted anywhere else.
//
// Needs the same secrets as create-payment (IYZICO_API_KEY,
// IYZICO_SECRET_KEY, optionally IYZICO_BASE_URL), plus:
//   SITE_URL - the site's real public URL (e.g. https://armus.vercel.app),
//     so the buyer lands back on the actual site after paying. Defaults
//     to https://armus.vercel.app if not set.

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

  if (!token) return redirectTo("booking.html?payment=failed");

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: pending } = await supabaseAdmin
    .from("pending_payments")
    .select("*")
    .eq("iyzico_token", token)
    .maybeSingle();

  if (!pending) return redirectTo("booking.html?payment=failed");

  const query =
    `teacher=${encodeURIComponent(pending.teacher_id)}&type=${encodeURIComponent(pending.type)}` +
    `&date=${encodeURIComponent(pending.lesson_date)}&time=${encodeURIComponent(pending.lesson_time)}`;

  // iyzico can call this more than once for the same token - if we
  // already turned this into a booking, don't create a second one
  if (pending.status === "succeeded" && pending.booking_id) {
    return redirectTo(`booking.html?payment=success&${query}`);
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
    return redirectTo(`booking.html?payment=failed&${query}`);
  }

  if (result.status !== "success" || result.paymentStatus !== "SUCCESS") {
    await supabaseAdmin.from("pending_payments").update({ status: "failed" }).eq("id", pending.id);
    return redirectTo(`booking.html?payment=failed&${query}`);
  }

  const { data: booking, error: bookingError } = await supabaseAdmin
    .from("bookings")
    .insert({
      student_id: pending.student_id,
      student_name: pending.student_name,
      teacher_id: pending.teacher_id,
      teacher_name: pending.teacher_name,
      type: pending.type,
      lesson_date: pending.lesson_date,
      lesson_time: pending.lesson_time,
      price: pending.price,
    })
    .select()
    .single();

  if (bookingError || !booking) {
    // money was taken but the booking row failed to write - flag it as
    // its own state rather than silently losing the payment, so it's
    // findable (pending_payments.status = 'paid_no_booking') instead of
    // just looking identical to a normal failure
    console.error("booking insert failed after successful payment", bookingError);
    await supabaseAdmin.from("pending_payments").update({ status: "paid_no_booking" }).eq("id", pending.id);
    return redirectTo(`booking.html?payment=error&${query}`);
  }

  await supabaseAdmin
    .from("pending_payments")
    .update({ status: "succeeded", booking_id: booking.id })
    .eq("id", pending.id);

  return redirectTo(`booking.html?payment=success&${query}`);
});
