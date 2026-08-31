// ARMUS - cancels a booking and, when eligible, refunds the original
// iyzico charge. Called by the student (my-lessons.html), the teacher
// (dashboard.html), or an admin (admin.html) - all three go through this
// one function so a refund is never skipped just because cancellation
// happened from a different panel.
//
// Policy:
//   - admin cancels: always a full refund (platform-side decision)
//   - teacher cancels: always a full refund (not the student's fault)
//   - student cancels >= 4 hours before the lesson: full refund
//   - student cancels < 4 hours before the lesson: no refund, but the
//     booking is still cancelled (frees the slot either way)
// A booking with no successful payment on file (pre-payment-system
// bookings, or a payment that never completed) simply has nothing to
// refund - it still gets cancelled normally.
//
// No secrets needed beyond IYZICO_API_KEY / IYZICO_SECRET_KEY (same ones
// create-payment already uses) and the auto-injected SUPABASE_* ones.

import Iyzipay from "npm:iyzipay@^2.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const iyzipay = new Iyzipay({
  apiKey: Deno.env.get("IYZICO_API_KEY") ?? "",
  secretKey: Deno.env.get("IYZICO_SECRET_KEY") ?? "",
  uri: Deno.env.get("IYZICO_BASE_URL") ?? "https://sandbox-api.iyzipay.com",
});

const FREE_CANCEL_HOURS = 4;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Giriş yapmalısın." }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return jsonResponse({ error: "Giriş yapmalısın." }, 401);

    const body = await req.json().catch(() => ({}));
    const bookingId = body.booking_id;
    if (!bookingId) return jsonResponse({ error: "booking_id gerekli." }, 400);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: booking } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (!booking) return jsonResponse({ error: "Rezervasyon bulunamadı." }, 404);
    if (booking.status === "cancelled") return jsonResponse({ error: "Bu rezervasyon zaten iptal edilmiş." }, 400);

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();

    const isAdmin = profile?.is_admin === true;
    const isStudent = user.id === booking.student_id;
    const isTeacher = String(user.id) === booking.teacher_id;

    if (!isAdmin && !isStudent && !isTeacher) {
      return jsonResponse({ error: "Bu rezervasyonu iptal etme yetkin yok." }, 403);
    }

    const lessonStart = new Date(`${booking.lesson_date}T${booking.lesson_time}:00`);
    if (new Date() > lessonStart) {
      return jsonResponse({ error: "Bu dersin zamanı geçti, iptal edilemez." }, 400);
    }

    let cancelledBy: string;
    let refundEligible: boolean;

    if (isAdmin) {
      cancelledBy = "admin";
      refundEligible = true;
    } else if (isStudent) {
      cancelledBy = "student";
      const hoursUntil = (lessonStart.getTime() - Date.now()) / 3_600_000;
      refundEligible = hoursUntil >= FREE_CANCEL_HOURS;
    } else {
      cancelledBy = "teacher";
      refundEligible = true;
    }

    const { data: payment } = await supabaseAdmin
      .from("pending_payments")
      .select("*")
      .eq("booking_id", booking.id)
      .eq("status", "succeeded")
      .maybeSingle();

    let refunded = false;

    if (refundEligible && payment?.iyzico_payment_transaction_id) {
      try {
        const refundResult: any = await new Promise((resolve, reject) => {
          iyzipay.refund.create({
            locale: Iyzipay.LOCALE.TR,
            conversationId: crypto.randomUUID(),
            paymentTransactionId: payment.iyzico_payment_transaction_id,
            price: Number(payment.price).toFixed(2),
            ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "85.34.78.112",
          }, (err: unknown, res: unknown) => {
            if (err) reject(err); else resolve(res);
          });
        });
        refunded = refundResult.status === "success";
        if (!refunded) console.error("iyzico refund failed", refundResult);
      } catch (err) {
        console.error("iyzico refund error", err);
      }
    }

    await supabaseAdmin
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: cancelledBy,
        refunded,
      })
      .eq("id", booking.id);

    return jsonResponse({ ok: true, refunded, refundEligible });

  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
