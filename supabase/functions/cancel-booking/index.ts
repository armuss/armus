// ARMUS - cancels a booking and, when eligible, grants the student one
// lesson credit tied to that lesson's teacher (see migration_28.sql) -
// not money, a lesson owed back. Called by the student (my-lessons.html),
// the teacher (dashboard.html), or an admin (admin.html) - all three go
// through this one function so a credit is never skipped just because
// cancellation happened from a different panel.
//
// Policy:
//   - admin cancels: always a full credit (platform-side decision)
//   - teacher cancels: always a full credit (not the student's fault)
//   - student cancels >= 4 hours before the lesson: full credit
//   - student cancels < 4 hours before the lesson: no credit, but the
//     booking is still cancelled (frees the slot either way)
// A booking with no successful payment on file (pre-payment-system
// bookings, a payment that never completed, or a lesson that was itself
// booked for free with a credit) simply has nothing to credit - it still
// gets cancelled normally. That last case matters: it's what stops a
// student from farming free lessons by repeatedly cancelling a
// credit-covered booking.
//
// No secrets needed beyond the auto-injected SUPABASE_* ones.

import { createClient } from "npm:@supabase/supabase-js@2";

const FREE_CANCEL_HOURS = 4;

// lesson_date/lesson_time are plain wall-clock strings with no zone of
// their own - booking.teacher_timezone (migration_37.sql) says which
// IANA zone they're wall-clock time IN. This turns them into the real
// UTC instant, correctly handling DST for any zone (not just
// Europe/Istanbul, which has none) - the standard "double conversion"
// trick: format a UTC guess back in the target zone, see how far off the
// wall-clock reading is, and shift by that difference. Without this, the
// "lesson already passed" check and the 4-hour free-cancellation window
// below were computed as if lesson_date/lesson_time were UTC, which for
// an Europe/Istanbul (UTC+3) teacher put both about 3 hours later than
// the real lesson time.
function armusZonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const guess = new Date(`${dateStr}T${timeStr}:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "Europe/Istanbul",
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

    const lessonStart = armusZonedTimeToUtc(booking.lesson_date, booking.lesson_time, booking.teacher_timezone);
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

    // Claim the cancellation with a conditional update (status must
    // still be "confirmed") BEFORE granting any credit, instead of
    // trusting the "booking.status === 'cancelled'" check above (done
    // against a SELECT taken before any of this) and writing
    // status: "cancelled" unconditionally at the very end. Two calls
    // racing for the same booking - a double-clicked cancel button, a
    // retried request after a slow response, the student and an admin
    // both cancelling within the same instant - could otherwise both
    // pass that early check while the booking was still "confirmed" in
    // both, and both go on to grant a lesson credit below: one
    // cancelled booking silently refunded twice. This update affecting
    // no row means another request already won the race and this one
    // stops here, before anything gets credited.
    const { data: claimedBooking } = await supabaseAdmin
      .from("bookings")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: cancelledBy })
      .eq("id", booking.id)
      .eq("status", "confirmed")
      .select()
      .maybeSingle();

    if (!claimedBooking) {
      return jsonResponse({ error: "Bu rezervasyon zaten iptal edilmiş." }, 400);
    }

    const { data: payment } = await supabaseAdmin
      .from("pending_payments")
      .select("*")
      .eq("booking_id", booking.id)
      .eq("status", "succeeded")
      .maybeSingle();

    let refunded = false;

    if (refundEligible && payment?.status === "succeeded") {
      const { error: creditError } = await supabaseAdmin.from("lesson_credits").insert({
        student_id: booking.student_id,
        teacher_id: booking.teacher_id,
        teacher_name: booking.teacher_name,
        source_booking_id: booking.id,
      });

      if (creditError) {
        console.error("lesson credit grant failed", creditError);
      } else {
        refunded = true;
        await supabaseAdmin.from("bookings").update({ refunded: true }).eq("id", booking.id);
      }
    }

    return jsonResponse({ ok: true, refunded, refundEligible });

  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
