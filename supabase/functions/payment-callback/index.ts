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
//   TRIGGER_SECRET - same as the other trigger-called functions: the
//     armus-reconcile-payments cron (migration_110.sql) calls this every
//     15 minutes with it to settle checkouts whose redirect never came
//     back (see reconcile below). Keep "Verify JWT" OFF - iyzico's
//     redirect carries no Supabase token either.
//
// migration_110.sql also adds card top-ups: a credit worth less than a
// trial pays its part and the card the rest (pending_payments.credit_id,
// booking_price). The credit is held while the student pays; this
// function uses it for the booking, or gives it back.

import Iyzipay from "npm:iyzipay@^2.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const iyzipay = new Iyzipay({
  apiKey: Deno.env.get("IYZICO_API_KEY") ?? "",
  secretKey: Deno.env.get("IYZICO_SECRET_KEY") ?? "",
  uri: Deno.env.get("IYZICO_BASE_URL") ?? "https://sandbox-api.iyzipay.com",
});

const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://armus.com.tr").replace(/\/$/, "");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
// shared with the armus-reconcile-payments cron (migration_110.sql)
const TRIGGER_SECRET = Deno.env.get("TRIGGER_SECRET") ?? "";
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

// A teacher's full real name is never shown to a student anywhere -
// only "Ahmet Y." (see auth.js armusShortDisplayName) - so a student
// can't take that name off ARMUS and look the teacher up elsewhere,
// bypassing the platform. Same policy here for the emails this function
// sends the student; never applied to a student's own name shown to
// their teacher.
function shortDisplayName(fullName: string) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "Öğretmen";
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
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

function retrieveCheckout(token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    iyzipay.checkoutForm.retrieve({ locale: Iyzipay.LOCALE.TR, token }, (err: unknown, res: unknown) => {
      if (err) reject(err); else resolve(res);
    });
  });
}

function isPaid(result: any) {
  return result?.status === "success" && result?.paymentStatus === "SUCCESS";
}

// migration_110.sql: a card top-up holds its credit ('reserved') while
// the student is on iyzico's page. An unpaid checkout gives it back.
async function releaseHeldCredit(supabaseAdmin: any, pending: any) {
  if (!pending.credit_id) return;
  await supabaseAdmin
    .from("lesson_credits")
    .update({ status: "available", reserved_payment_id: null })
    .eq("id", pending.credit_id)
    .eq("reserved_payment_id", pending.id)
    .eq("status", "reserved");
}

// A paid charge that can't become its booking (slot taken, time passed,
// teacher closed, trial rule) goes back on the balance in full:
//   - a top-up: the held credit comes back worth the whole lesson (its
//     value + what the card paid), tied to this lesson's teacher - same
//     as refund_booking_to_credit does for a cancelled top-up
//   - otherwise: a new credit with this teacher worth what was paid
async function creditForUnbookedPayment(supabaseAdmin: any, pending: any) {
  if (pending.credit_id) {
    const { data: credit } = await supabaseAdmin
      .from("lesson_credits")
      .select("*")
      .eq("id", pending.credit_id)
      .maybeSingle();
    const foldable = credit && (
      (credit.status === "reserved" && credit.reserved_payment_id === pending.id) ||
      (credit.status === "used" && !credit.used_booking_id)
    );
    if (foldable) {
      const { data: folded } = await supabaseAdmin
        .from("lesson_credits")
        .update({
          status: "available",
          used_at: null,
          used_booking_id: null,
          reserved_payment_id: null,
          value: Number(credit.value || 0) + Number(pending.price),
          teacher_id: pending.teacher_id,
          teacher_name: pending.teacher_name,
          transferred_at: null,
        })
        .eq("id", credit.id)
        .eq("status", credit.status)
        .select()
        .maybeSingle();
      if (folded) return;
    }
  }
  await supabaseAdmin.from("lesson_credits").insert({
    student_id: pending.student_id,
    teacher_id: pending.teacher_id,
    teacher_name: pending.teacher_name,
    value: Number(pending.price),
    source: "payment_issue",
    pending_payment_id: pending.id,
  });
}

type Settled = { outcome: "success" | "error" | "slot_taken" | "time_passed"; bookedType?: string };

// Everything after iyzico has confirmed the charge, for a row this
// request has already claimed ('processing'). Shared by the browser
// redirect and the reconcile run, so a payment whose callback never
// arrived ends up exactly where it would have.
async function settlePaidCheckout(supabaseAdmin: any, pending: any, result: any): Promise<Settled> {

  const isPackage = pending.type === "package";

  // stored so cancel-booking can refund this exact charge later
  const transactionId = Array.isArray(result.itemTransactions) && result.itemTransactions[0]
    ? result.itemTransactions[0].paymentTransactionId
    : null;
  const paidFields = {
    iyzico_payment_id: result.paymentId ?? null,
    iyzico_payment_transaction_id: transactionId,
  };

  if (isPackage) {

    const quantity = Number(pending.quantity) || 0;
    // migration_110.sql: each lesson remembers its share of the price -
    // that's what it's worth if it's refunded or moved to another teacher
    const perLesson = quantity > 0 ? Math.round((Number(pending.price) / quantity) * 100) / 100 : null;
    const creditRows = Array.from({ length: quantity }, () => ({
      student_id: pending.student_id,
      teacher_id: pending.teacher_id,
      teacher_name: pending.teacher_name,
      status: "available",
      value: perLesson,
      source: "package",
      pending_payment_id: pending.id,
    }));

    const { error: creditsError } = await supabaseAdmin.from("lesson_credits").insert(creditRows);

    if (creditsError) {
      // money was taken but the credits failed to write - flag it as its
      // own state rather than silently losing the payment, so it's
      // findable (pending_payments.status = 'paid_no_booking') instead of
      // just looking identical to a normal failure
      console.error("lesson_credits insert failed after successful package payment", creditsError);
      await supabaseAdmin.from("pending_payments").update({ status: "paid_no_booking", ...paidFields }).eq("id", pending.id);
      return { outcome: "error" };
    }

    await supabaseAdmin
      .from("pending_payments")
      .update({ status: "succeeded", ...paidFields })
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

    return { outcome: "success" };
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

  // create-payment already rejected a past slot at the moment the charge
  // was started, but iyzico's own checkout step (3D-Secure, a buyer who
  // just sits on the payment page) can take long enough that the lesson's
  // real start time has since passed by the time this callback runs. The
  // charge already succeeded and cancel-booking never cancels (or
  // refunds) a lesson that's already over, so writing the booking anyway
  // would create an unrefundable booking for a lesson time that can
  // never happen - grant a credit instead, same as the slot-taken race
  // below, so the buyer can rebook a real time with nothing lost.
  const lessonStart = zonedTimeToUtc(pending.lesson_date, pending.lesson_time, teacherTimezone);
  if (lessonStart < new Date()) {
    await creditForUnbookedPayment(supabaseAdmin, pending);
    await supabaseAdmin
      .from("pending_payments")
      .update({ status: "time_passed", ...paidFields })
      .eq("id", pending.id);
    return { outcome: "time_passed" };
  }

  // a top-up (migration_110.sql): the held credit pays the rest of this
  // lesson. If an earlier callback for this same checkout already handed
  // it back (a transient iyzico error) it's taken again while still unused.
  let topUpCreditId: string | null = null;
  if (pending.credit_id) {
    const { data: fromHold } = await supabaseAdmin
      .from("lesson_credits")
      .update({ status: "used", used_at: new Date().toISOString(), reserved_payment_id: null })
      .eq("id", pending.credit_id)
      .eq("status", "reserved")
      .eq("reserved_payment_id", pending.id)
      .select()
      .maybeSingle();
    const claimedCredit = fromHold || (await supabaseAdmin
      .from("lesson_credits")
      .update({ status: "used", used_at: new Date().toISOString() })
      .eq("id", pending.credit_id)
      .eq("status", "available")
      .select()
      .maybeSingle()).data;
    if (!claimedCredit) {
      // spent on something else in the meantime - only the card part of
      // this lesson is paid, so it can't be booked; needs a person
      console.error("top-up credit no longer available for a paid checkout", pending.id);
      await supabaseAdmin.from("pending_payments").update({ status: "paid_no_booking", ...paidFields }).eq("id", pending.id);
      return { outcome: "error" };
    }
    topUpCreditId = claimedCredit.id;
  }

  const bookingRow = {
    student_id: pending.student_id,
    student_name: pending.student_name,
    teacher_id: pending.teacher_id,
    teacher_name: pending.teacher_name,
    type: pending.type,
    lesson_date: pending.lesson_date,
    lesson_time: pending.lesson_time,
    teacher_timezone: teacherTimezone,
    // with a top-up the card paid only the difference - the lesson itself
    // costs booking_price
    price: pending.booking_price ?? pending.price,
  };

  let { data: booking, error: bookingError } = await supabaseAdmin
    .from("bookings")
    .insert(bookingRow)
    .select()
    .single();

  // AR005 = bookings_enforce_one_trial (migration_110.sql): this student
  // already had a trial with this teacher by the time the charge cleared
  // (two checkouts at once). A trial costs the same as a regular lesson,
  // so the paid time is booked as a regular lesson instead. Not for a
  // top-up - a credit from another teacher only ever covers a trial.
  if (bookingError?.code === "AR005" && !pending.credit_id) {
    ({ data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .insert({ ...bookingRow, type: "lesson" })
      .select()
      .single());
  }

  if (bookingError || !booking) {

    // 23505 = unique_violation - someone else grabbed this exact
    // teacher/date/time in the window between this student picking it
    // and iyzico confirming their charge (bookings_teacher_slot_unique,
    // see migration_35.sql). AR001 = the bookings_enforce_no_overlap
    // trigger (migration_103.sql) - someone else's booking OVERLAPS
    // this slot without being identical to it (a lesson runs 50 minutes
    // on a 30-minute grid, so e.g. 10:00 and 10:30 overlap without ever
    // colliding on the exact (date, time) the unique index checks).
    // Either way the charge already succeeded, so rather than leaving
    // this student's money in the manual paid_no_booking follow-up
    // below, grant them a lesson credit right away - same mechanism
    // cancel-booking uses - so they can immediately rebook a different
    // time with nothing lost. AR002 (bookings_enforce_teacher_not_banned,
    // migration_104.sql) is the rare case of the teacher's account being
    // closed while this student was still on iyzico's checkout page - no
    // lesson with them can be created anymore, so it gets the same
    // credit-instead outcome (reusing the slot_taken state rather than a
    // dedicated one for something this rare). AR005 here is a top-up
    // trial refused by the one-trial rule.
    if (["23505", "AR001", "AR002", "AR005"].includes(bookingError?.code)) {
      await creditForUnbookedPayment(supabaseAdmin, pending);
      // 'slot_taken' (migration_84.sql), not 'paid_no_booking' - this is
      // a fully resolved outcome (credit already granted), not a stuck
      // state needing manual follow-up, and a duplicate/retried callback
      // for this same token needs to be able to tell the two apart
      await supabaseAdmin
        .from("pending_payments")
        .update({ status: "slot_taken", ...paidFields })
        .eq("id", pending.id);
      return { outcome: "slot_taken" };
    }

    // money was taken but the booking row failed to write - flag it as
    // its own state rather than silently losing the payment, so it's
    // findable (pending_payments.status = 'paid_no_booking') instead of
    // just looking identical to a normal failure. A top-up's credit goes
    // back to the balance as it was; the card part is the manual follow-up.
    console.error("booking insert failed after successful payment", bookingError);
    if (topUpCreditId) {
      await supabaseAdmin
        .from("lesson_credits")
        .update({ status: "available", used_at: null })
        .eq("id", topUpCreditId)
        .eq("status", "used");
    }
    await supabaseAdmin.from("pending_payments").update({ status: "paid_no_booking", ...paidFields }).eq("id", pending.id);
    return { outcome: "error" };
  }

  if (topUpCreditId) {
    await supabaseAdmin
      .from("lesson_credits")
      .update({ used_booking_id: booking.id })
      .eq("id", topUpCreditId);
  }

  await supabaseAdmin
    .from("pending_payments")
    .update({ status: "succeeded", booking_id: booking.id, ...paidFields })
    .eq("id", pending.id);

  const { data: studentProfile } = await supabaseAdmin
    .from("profiles")
    .select("email, name, timezone")
    .eq("id", pending.student_id)
    .maybeSingle();

  const typeLabel = booking.type === "trial" ? "deneme ders" : "ders";
  const joinUrl = `${SITE_URL}/my-lessons.html`;

  if (studentProfile?.email) {
    await sendEmail(
      studentProfile.email,
      "Dersin onaylandı - ARMUS",
      bookingConfirmedEmailHtml(
        studentProfile.name, shortDisplayName(pending.teacher_name),
        formatDateTimeLabel(lessonStart, studentProfile.timezone), typeLabel, joinUrl,
      ),
    );
  }
  if (teacherProfile?.email) {
    await sendEmail(
      teacherProfile.email,
      "Yeni bir dersin var - ARMUS",
      bookingConfirmedEmailHtml(
        teacherProfile.name, pending.student_name,
        formatDateTimeLabel(lessonStart, teacherProfile.timezone), typeLabel, joinUrl,
      ),
    );
  }

  return { outcome: "success", bookedType: booking.type };
}

// The armus-reconcile-payments cron (migration_110.sql), every 15
// minutes: checkouts 35 minutes to 48 hours old that never got a working
// callback (the student closed the tab after paying, a network blip) are
// asked about once more. iyzico's checkout token lives 30 minutes, so by
// then the answer is final: paid -> settled exactly like the redirect
// would have; not paid -> 'expired' (a held credit goes back). Each row
// is looked at once (last_reconciled_at); a row iyzico couldn't be asked
// about stays for the next run.
async function reconcile(supabaseAdmin: any) {
  const now = Date.now();
  const { data: rows } = await supabaseAdmin
    .from("pending_payments")
    .select("*")
    .in("status", ["pending", "failed"])
    .is("last_reconciled_at", null)
    .lt("created_at", new Date(now - 35 * 60_000).toISOString())
    .gt("created_at", new Date(now - 48 * 3_600_000).toISOString())
    .order("created_at", { ascending: true })
    .limit(25);

  const summary = { checked: 0, settled: 0, expired: 0 };

  for (const row of rows || []) {
    summary.checked++;
    const stamp = new Date().toISOString();

    if (!row.iyzico_token) {
      // the checkout never even opened
      await supabaseAdmin
        .from("pending_payments")
        .update({ status: row.status === "pending" ? "expired" : row.status, last_reconciled_at: stamp })
        .eq("id", row.id)
        .eq("status", row.status);
      await releaseHeldCredit(supabaseAdmin, row);
      if (row.status === "pending") summary.expired++;
      continue;
    }

    let result: any;
    try {
      result = await retrieveCheckout(row.iyzico_token);
    } catch (err) {
      console.error("reconcile: iyzico retrieve failed", row.id, err);
      continue;
    }

    if (!isPaid(result)) {
      await supabaseAdmin
        .from("pending_payments")
        .update({ status: row.status === "pending" ? "expired" : row.status, last_reconciled_at: stamp })
        .eq("id", row.id)
        .eq("status", row.status);
      await releaseHeldCredit(supabaseAdmin, row);
      if (row.status === "pending") summary.expired++;
      continue;
    }

    const { data: claimed } = await supabaseAdmin
      .from("pending_payments")
      .update({ status: "processing", last_reconciled_at: stamp })
      .eq("id", row.id)
      .in("status", ["pending", "failed"])
      .select()
      .maybeSingle();
    if (!claimed) continue;

    await settlePaidCheckout(supabaseAdmin, claimed, result);
    summary.settled++;
  }

  return summary;
}

Deno.serve(async (req) => {

  // the reconcile cron - never iyzico, never a browser
  if (req.headers.get("x-armus-trigger-secret") !== null) {
    if (!TRIGGER_SECRET || req.headers.get("x-armus-trigger-secret") !== TRIGGER_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }
    try {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const summary = await reconcile(supabaseAdmin);
      return new Response(JSON.stringify(summary), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err) {
      console.error("reconcile failed", err);
      return new Response("error", { status: 500 });
    }
  }

  let token = "";
  try {
    const form = await req.formData();
    token = String(form.get("token") || "");
  } catch {
    token = new URL(req.url).searchParams.get("token") || "";
  }

  if (!token) return redirectTo("booking.html?payment=failed");

  // Wraps the rest of the handler - every other Edge Function in this
  // codebase wraps its whole body and returns a fixed generic response
  // on any uncaught error; this one didn't, so a transient failure here
  // (a network blip mid-request, an unexpected null) would fall through
  // to Deno's own default error response instead of this function's own
  // controlled redirect, leaving the buyer's browser on a broken page
  // in the middle of a real payment instead of routed back to
  // booking.html with a clear "something went wrong" state.
  try {

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

  const queryFor = (type: string) => isPackage
    ? `teacher=${encodeURIComponent(pending.teacher_id)}&type=package&quantity=${encodeURIComponent(pending.quantity)}`
    : `teacher=${encodeURIComponent(pending.teacher_id)}&type=${encodeURIComponent(type)}` +
      `&date=${encodeURIComponent(pending.lesson_date)}&time=${encodeURIComponent(pending.lesson_time)}`;
  const query = queryFor(pending.type);

  const successPathFor = (type: string) => isPackage
    ? `teacher.html?payment=success&${queryFor(type)}`
    : `booking.html?payment=success&${queryFor(type)}`;
  const successPath = successPathFor(pending.type);
  const failedPath = isPackage ? `teacher.html?payment=failed&${query}` : `booking.html?payment=failed&${query}`;
  const errorPath = isPackage ? `teacher.html?payment=error&${query}` : `booking.html?payment=error&${query}`;
  const slotTakenPath = `booking.html?payment=slot_taken&${query}`;
  const timePassedPath = `booking.html?payment=time_passed&${query}`;

  // the booking this checkout became (a trial can come out a regular
  // lesson - see AR005 in settlePaidCheckout)
  const bookedSuccessPath = async (bookingId: string | null) => {
    if (!bookingId) return successPath;
    const { data: b } = await supabaseAdmin.from("bookings").select("type").eq("id", bookingId).maybeSingle();
    return successPathFor(b?.type || pending.type);
  };

  // iyzico can call this more than once for the same token - if we
  // already fulfilled this payment (booking created, or credits granted
  // for a package), don't do it a second time
  if (pending.status === "succeeded" && (pending.booking_id || isPackage)) {
    return redirectTo(await bookedSuccessPath(pending.booking_id));
  }

  // Claim this token atomically before doing any real work. Without this,
  // two concurrent callbacks for the same token (iyzico retrying, or two
  // browser tabs both landing on the redirect) could both read a
  // not-yet-"succeeded" status above and each go on to create a booking
  // or grant a batch of lesson credits for what was really one charge.
  // The reconcile run claims the same way, so it never races this either.
  const { data: claimed } = await supabaseAdmin
    .from("pending_payments")
    .update({ status: "processing" })
    .eq("id", pending.id)
    .in("status", ["pending", "failed"])
    .select()
    .maybeSingle();

  if (!claimed) {
    // lost the race (or this token is already past "pending"/"failed") -
    // re-read the current state instead of doing anything twice. If the
    // winning request is still mid-flight ("processing"), briefly poll for
    // it to finish instead of immediately telling this browser the payment
    // failed - a duplicated redirect/webhook hit for the same token is
    // routine (iyzico retry, two open tabs), and the winner usually
    // resolves within a second or two.
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: latest } = await supabaseAdmin
        .from("pending_payments")
        .select("*")
        .eq("id", pending.id)
        .single();
      if (latest?.status === "succeeded" && (latest.booking_id || isPackage)) {
        return redirectTo(await bookedSuccessPath(latest.booking_id));
      }
      // 'expired' (migration_110.sql): the reconcile run already found
      // this checkout unpaid
      if (latest?.status === "failed" || latest?.status === "expired") {
        return redirectTo(failedPath);
      }
      // both are fully resolved, self-service outcomes (migration_84.sql)
      // - the charge succeeded and a lesson credit was already granted,
      // there's nothing left for this duplicate request to do
      if (latest?.status === "slot_taken") {
        return redirectTo(slotTakenPath);
      }
      if (latest?.status === "time_passed") {
        return redirectTo(timePassedPath);
      }
      // a genuine write failure the winning request already gave up on -
      // same terminal outcome this duplicate would reach on its own
      if (latest?.status === "paid_no_booking") {
        return redirectTo(errorPath);
      }
      // still "processing" - give the winner a moment to finish
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    return redirectTo(failedPath);
  }

  let result: any;
  try {
    result = await retrieveCheckout(token);
  } catch (err) {
    console.error("iyzico retrieve failed", err);
    // roll the claim back so a retry (iyzico's own, the buyer reloading,
    // or the reconcile run) can attempt this token again instead of
    // finding it stuck forever in "processing" and permanently
    // unrecoverable without a manual DB fix
    await supabaseAdmin.from("pending_payments").update({ status: "failed" }).eq("id", pending.id);
    await releaseHeldCredit(supabaseAdmin, pending);
    return redirectTo(failedPath);
  }

  if (!isPaid(result)) {
    await supabaseAdmin.from("pending_payments").update({ status: "failed" }).eq("id", pending.id);
    await releaseHeldCredit(supabaseAdmin, pending);
    return redirectTo(failedPath);
  }

  const settled = await settlePaidCheckout(supabaseAdmin, claimed, result);
  if (settled.outcome === "success") return redirectTo(successPathFor(settled.bookedType || pending.type));
  if (settled.outcome === "slot_taken") return redirectTo(slotTakenPath);
  if (settled.outcome === "time_passed") return redirectTo(timePassedPath);
  return redirectTo(errorPath);

  } catch (err) {
    console.error(err);
    return redirectTo("booking.html?payment=error");
  }
});
