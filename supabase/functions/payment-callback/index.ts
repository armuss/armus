// ARMUS - iyzico redirects the buyer's browser here once they finish (or
// abandon) the Checkout Form. This is the ONLY place a real booking row
// (or, for a package purchase - migration_29.sql - a batch of
// lesson_credits) ever gets created from a paid charge - it re-checks the
// payment status with iyzico itself (never trusts the redirect alone,
// which anyone could forge) before writing anything.
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

// teacher_id can be a demo teacher (teachers-data.js, not a real
// Supabase user/profile) - only look one up when it's a real UUID
function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

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

  const isPackage = pending.type === "package";

  const query = isPackage
    ? `teacher=${encodeURIComponent(pending.teacher_id)}&type=package&quantity=${encodeURIComponent(pending.quantity)}`
    : `teacher=${encodeURIComponent(pending.teacher_id)}&type=${encodeURIComponent(pending.type)}` +
      `&date=${encodeURIComponent(pending.lesson_date)}&time=${encodeURIComponent(pending.lesson_time)}`;

  const successPath = isPackage ? `teacher.html?payment=success&${query}` : `booking.html?payment=success&${query}`;
  const failedPath = isPackage ? `teacher.html?payment=failed&${query}` : `booking.html?payment=failed&${query}`;
  const errorPath = isPackage ? `teacher.html?payment=error&${query}` : `booking.html?payment=error&${query}`;
  const slotTakenPath = `booking.html?payment=slot_taken&${query}`;

  // iyzico can call this more than once for the same token - if we
  // already fulfilled this payment (booking created, or credits granted
  // for a package), don't do it a second time
  if (pending.status === "succeeded" && (pending.booking_id || isPackage)) {
    return redirectTo(successPath);
  }

  // Claim this token atomically before doing any real work. Without this,
  // two concurrent callbacks for the same token (iyzico retrying, or two
  // browser tabs both landing on the redirect) could both read a
  // not-yet-"succeeded" status above and each go on to create a booking
  // or grant a batch of lesson credits for what was really one charge.
  const { data: claimed } = await supabaseAdmin
    .from("pending_payments")
    .update({ status: "processing" })
    .eq("id", pending.id)
    .in("status", ["pending", "failed"])
    .select()
    .maybeSingle();

  if (!claimed) {
    // lost the race (or this token is already past "pending"/"failed") -
    // re-read the current state instead of doing anything twice
    const { data: latest } = await supabaseAdmin
      .from("pending_payments")
      .select("*")
      .eq("id", pending.id)
      .single();
    if (latest?.status === "succeeded" && (latest.booking_id || isPackage)) {
      return redirectTo(successPath);
    }
    return redirectTo(failedPath);
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
    return redirectTo(failedPath);
  }

  if (result.status !== "success" || result.paymentStatus !== "SUCCESS") {
    await supabaseAdmin.from("pending_payments").update({ status: "failed" }).eq("id", pending.id);
    return redirectTo(failedPath);
  }

  // stored so cancel-booking can refund this exact charge later
  const transactionId = Array.isArray(result.itemTransactions) && result.itemTransactions[0]
    ? result.itemTransactions[0].paymentTransactionId
    : null;

  if (isPackage) {

    const quantity = Number(pending.quantity) || 0;
    const creditRows = Array.from({ length: quantity }, () => ({
      student_id: pending.student_id,
      teacher_id: pending.teacher_id,
      teacher_name: pending.teacher_name,
      status: "available",
    }));

    const { error: creditsError } = await supabaseAdmin.from("lesson_credits").insert(creditRows);

    if (creditsError) {
      // money was taken but the credits failed to write - flag it as its
      // own state rather than silently losing the payment, so it's
      // findable (pending_payments.status = 'paid_no_booking') instead of
      // just looking identical to a normal failure
      console.error("lesson_credits insert failed after successful package payment", creditsError);
      await supabaseAdmin.from("pending_payments").update({ status: "paid_no_booking" }).eq("id", pending.id);
      return redirectTo(errorPath);
    }

    await supabaseAdmin
      .from("pending_payments")
      .update({
        status: "succeeded",
        iyzico_payment_id: result.paymentId ?? null,
        iyzico_payment_transaction_id: transactionId,
      })
      .eq("id", pending.id);

    return redirectTo(successPath);
  }

  // migration_37.sql - which zone lesson_date/lesson_time is wall-clock
  // time IN, so this booking means the same real instant everywhere else
  // (cancel-booking, the reminder cron) reads it. Demo teachers have no
  // profile row to read a real timezone from, so they're always
  // Europe/Istanbul.
  let teacherTimezone = "Europe/Istanbul";
  if (isUuid(pending.teacher_id)) {
    const { data: teacherProfile } = await supabaseAdmin
      .from("profiles")
      .select("timezone")
      .eq("id", pending.teacher_id)
      .maybeSingle();
    teacherTimezone = teacherProfile?.timezone || "Europe/Istanbul";
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
      teacher_timezone: teacherTimezone,
      price: pending.price,
    })
    .select()
    .single();

  if (bookingError || !booking) {

    // 23505 = unique_violation - someone else grabbed this exact
    // teacher/date/time in the window between this student picking it
    // and iyzico confirming their charge (bookings_teacher_slot_unique,
    // see migration_35.sql). The charge already succeeded, so rather
    // than leaving this student's money in the manual paid_no_booking
    // follow-up below, grant them a lesson credit right away - same
    // mechanism cancel-booking uses - so they can immediately rebook a
    // different time with nothing lost.
    if (bookingError?.code === "23505" && !isPackage) {
      await supabaseAdmin.from("lesson_credits").insert({
        student_id: pending.student_id,
        teacher_id: pending.teacher_id,
        teacher_name: pending.teacher_name,
      });
      await supabaseAdmin.from("pending_payments").update({ status: "paid_no_booking" }).eq("id", pending.id);
      return redirectTo(slotTakenPath);
    }

    // money was taken but the booking row failed to write - flag it as
    // its own state rather than silently losing the payment, so it's
    // findable (pending_payments.status = 'paid_no_booking') instead of
    // just looking identical to a normal failure
    console.error("booking insert failed after successful payment", bookingError);
    await supabaseAdmin.from("pending_payments").update({ status: "paid_no_booking" }).eq("id", pending.id);
    return redirectTo(errorPath);
  }

  await supabaseAdmin
    .from("pending_payments")
    .update({
      status: "succeeded",
      booking_id: booking.id,
      iyzico_payment_id: result.paymentId ?? null,
      iyzico_payment_transaction_id: transactionId,
    })
    .eq("id", pending.id);

  return redirectTo(successPath);
});
