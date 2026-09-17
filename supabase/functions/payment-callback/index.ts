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
//   SITE_URL - the site's real public URL (https://armus.com.tr), so the
//     buyer lands back on the actual site after paying. Defaults to
//     https://armus.com.tr if not set - but set it explicitly in the
//     function's own secrets rather than relying on that default, since
//     it can go stale if the domain ever changes again.
//   RESEND_API_KEY, EMAIL_FROM - same as send-lesson-reminder, used here
//     to send a booking-confirmed email to both participants (or a
//     package-purchased email to the buyer) once the booking/credits are
//     actually written. A failed send here never fails the payment
//     itself - the booking/credits already exist by that point.

import Iyzipay from "npm:iyzipay@^2.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const iyzipay = new Iyzipay({
  apiKey: Deno.env.get("IYZICO_API_KEY") ?? "",
  secretKey: Deno.env.get("IYZICO_SECRET_KEY") ?? "",
  uri: Deno.env.get("IYZICO_BASE_URL") ?? "https://sandbox-api.iyzipay.com",
});

const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://armus.com.tr").replace(/\/$/, "");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("EMAIL_FROM") ?? "ARMUS <onboarding@resend.dev>";

const DAY_NAMES = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const MONTH_NAMES = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];
const EN_WEEKDAY_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// teacher_id can be a demo teacher (teachers-data.js, not a real
// Supabase user/profile) - only look one up when it's a real UUID
function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function redirectTo(path: string) {
  return new Response(null, { status: 302, headers: { Location: `${SITE_URL}/${path}` } });
}

// mirrors send-lesson-reminder's zonedTimeToUtc/formatDateTimeLabel - see
// that file for why the "double conversion" trick is needed and why this
// formats back out in each RECIPIENT's own timezone, not the teacher's.
function zonedTimeToUtc(dateKey: string, time: string, teacherTimezone: string): Date {
  const guess = new Date(`${dateKey}T${time}:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: teacherTimezone || "Europe/Istanbul",
      hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(guess).map((p) => [p.type, p.value]),
  );
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    hour, Number(parts.minute), Number(parts.second),
  );
  return new Date(guess.getTime() + (guess.getTime() - asIfUtc));
}

function formatDateTimeLabel(lessonInstant: Date, recipientTimezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: recipientTimezone || "Europe/Istanbul",
      hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", weekday: "short",
    }).formatToParts(lessonInstant).map((p) => [p.type, p.value]),
  );
  const dayIndex = EN_WEEKDAY_ORDER.indexOf(parts.weekday);
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${Number(parts.day)} ${MONTH_NAMES[Number(parts.month) - 1]} ${DAY_NAMES[dayIndex] ?? ""}, ${hour}:${parts.minute}`;
}

function escapeHtml(str: string) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function emailShell(bodyHtml: string) {
  return `
  <div style="background:#0d0d0f;padding:40px 20px;font-family:Arial,sans-serif;">
    <div style="max-width:440px;margin:0 auto;background:#1a1712;border:1px solid #2e2a22;border-radius:16px;padding:32px;text-align:center;">
      <div style="font-size:22px;font-weight:800;letter-spacing:-1px;background:linear-gradient(90deg,#e8c777,#b8860b);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:24px;">ARMUS</div>
      ${bodyHtml}
    </div>
  </div>`;
}

function bookingConfirmedEmailHtml(recipientName: string, otherName: string, whenLabel: string, typeLabel: string, joinUrl: string) {
  return emailShell(`
    <p style="color:#f4f4f2;font-size:14px;margin:0 0 6px;">Merhaba ${escapeHtml(recipientName)},</p>
    <p style="color:#a3a3a6;font-size:13px;line-height:1.6;margin:0 0 22px;">
      <strong style="color:#f4f4f2;">${escapeHtml(otherName)}</strong> ile ${escapeHtml(typeLabel)}in onaylandı:<br>
      <strong style="color:#e8c777;">${whenLabel}</strong>
    </p>
    <a href="${joinUrl}" style="display:inline-block;background:linear-gradient(90deg,#e8c777,#b8860b);color:#1c1c1e;font-size:14px;font-weight:700;padding:13px 26px;border-radius:12px;text-decoration:none;">Derslerimi Gör</a>
    <p style="color:#66666a;font-size:11px;margin:26px 0 0;">Ders saatine kadar hazır olman gerekmez, bağlantı ders başladığında açılacak.</p>
  `);
}

function packagePurchasedEmailHtml(recipientName: string, teacherName: string, quantity: number, dashboardUrl: string) {
  return emailShell(`
    <p style="color:#f4f4f2;font-size:14px;margin:0 0 6px;">Merhaba ${escapeHtml(recipientName)},</p>
    <p style="color:#a3a3a6;font-size:13px;line-height:1.6;margin:0 0 22px;">
      <strong style="color:#f4f4f2;">${escapeHtml(teacherName)}</strong> ile
      <strong style="color:#e8c777;">${quantity} derslik</strong> paketin satın alındı.
    </p>
    <a href="${dashboardUrl}" style="display:inline-block;background:linear-gradient(90deg,#e8c777,#b8860b);color:#1c1c1e;font-size:14px;font-weight:700;padding:13px 26px;border-radius:12px;text-decoration:none;">Ders Rezervasyonu Yap</a>
    <p style="color:#66666a;font-size:11px;margin:26px 0 0;">Ders haklarını dilediğin zaman kullanabilirsin.</p>
  `);
}

async function sendEmail(to: string, subject: string, html: string) {
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    });
    if (!resp.ok) console.error("resend send failed", to, await resp.text());
  } catch (err) {
    console.error("resend send threw", to, err);
  }
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

    const { data: buyerProfile } = await supabaseAdmin
      .from("profiles")
      .select("email, name")
      .eq("id", pending.student_id)
      .maybeSingle();

    if (buyerProfile?.email) {
      await sendEmail(
        buyerProfile.email,
        "Paketin satın alındı - ARMUS",
        packagePurchasedEmailHtml(buyerProfile.name, pending.teacher_name, quantity, `${SITE_URL}/my-lessons.html`),
      );
    }

    return redirectTo(successPath);
  }

  // migration_37.sql - which zone lesson_date/lesson_time is wall-clock
  // time IN, so this booking means the same real instant everywhere else
  // (cancel-booking, the reminder cron) reads it. Demo teachers have no
  // profile row to read a real timezone from, so they're always
  // Europe/Istanbul.
  let teacherTimezone = "Europe/Istanbul";
  let teacherProfile: { timezone?: string; email?: string; name?: string } | null = null;
  if (isUuid(pending.teacher_id)) {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("timezone, email, name")
      .eq("id", pending.teacher_id)
      .maybeSingle();
    teacherProfile = data;
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

  const { data: studentProfile } = await supabaseAdmin
    .from("profiles")
    .select("email, name, timezone")
    .eq("id", pending.student_id)
    .maybeSingle();

  const lessonInstant = zonedTimeToUtc(pending.lesson_date, pending.lesson_time, teacherTimezone);
  const typeLabel = pending.type === "trial" ? "deneme ders" : "ders";
  const joinUrl = `${SITE_URL}/my-lessons.html`;

  if (studentProfile?.email) {
    await sendEmail(
      studentProfile.email,
      "Dersin onaylandı - ARMUS",
      bookingConfirmedEmailHtml(
        studentProfile.name, pending.teacher_name,
        formatDateTimeLabel(lessonInstant, studentProfile.timezone), typeLabel, joinUrl,
      ),
    );
  }
  if (teacherProfile?.email) {
    await sendEmail(
      teacherProfile.email,
      "Yeni bir dersin var - ARMUS",
      bookingConfirmedEmailHtml(
        teacherProfile.name, pending.student_name,
        formatDateTimeLabel(lessonInstant, teacherProfile.timezone), typeLabel, joinUrl,
      ),
    );
  }

  return redirectTo(successPath);
});
