// ARMUS - cancels a booking and, when eligible, credits the student's
// ARMUS wallet balance for what they paid (nothing goes back to the
// card - see migration_25.sql). Called by the student (my-lessons.html),
// the teacher (dashboard.html), or an admin (admin.html) - all three go
// through this one function so a credit is never skipped just because
// cancellation happened from a different panel.
//
// Policy:
//   - admin cancels: always a full wallet credit (platform-side decision)
//   - teacher cancels: always a full wallet credit (not the student's fault)
//   - student cancels >= 4 hours before the lesson: full wallet credit
//   - student cancels < 4 hours before the lesson: no credit, but the
//     booking is still cancelled (frees the slot either way)
// A booking with no successful payment on file (pre-payment-system
// bookings, or a payment that never completed) simply has nothing to
// credit - it still gets cancelled normally.
//
// No secrets needed beyond the auto-injected SUPABASE_* ones.

import { createClient } from "npm:@supabase/supabase-js@2";

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

    if (refundEligible && payment?.status === "succeeded") {
      const { data: studentProfile } = await supabaseAdmin
        .from("profiles")
        .select("wallet_balance")
        .eq("id", booking.student_id)
        .single();

      const newBalance = Number(studentProfile?.wallet_balance || 0) + Number(payment.price);

      const { error: walletError } = await supabaseAdmin
        .from("profiles")
        .update({ wallet_balance: newBalance })
        .eq("id", booking.student_id);

      if (walletError) {
        console.error("wallet credit failed", walletError);
      } else {
        await supabaseAdmin.from("wallet_transactions").insert({
          student_id: booking.student_id,
          amount: payment.price,
          reason: "booking_cancelled",
          booking_id: booking.id,
        });
        refunded = true;
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
