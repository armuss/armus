// ARMUS - cancels a booking and, when eligible, grants the student one
// lesson credit tied to that lesson's teacher (see migration_28.sql) -
// not money, a lesson owed back. Called by the student (my-lessons.html),
// the teacher (dashboard.html), or an admin (admin.html) - all three go
// through this one function so a credit is never skipped just because
// cancellation happened from a different panel.
//
// Policy (Preply's cancellation policy, 12-hour window):
//   - admin cancels: the lesson always goes back to the student's balance
//   - teacher cancels: always goes back too (not the student's fault)
//   - student cancels >= 12 hours before the lesson: goes back to their
//     balance, the teacher isn't paid
//   - student cancels < 12 hours before the lesson: "Cancelled and Paid"
//     (bookings.late_cancel, migration_105.sql) - nothing goes back, and
//     a regular lesson is paid to the teacher exactly as if it had
//     happened, since their time was reserved (a late-cancelled TRIAL
//     follows the existing trial rule - its fee stays with ARMUS). The
//     booking is still cancelled either way, which frees the slot.
// "Goes back to the balance" means: a card-paid lesson grants a new
// lesson credit tied to that teacher; a lesson that was itself paid
// for with a credit gets THAT SAME credit back (status flipped back to
// available), never a freshly minted one. Restoring rather than minting
// is what makes it safe to refund a credit-paid lesson even when the
// STUDENT cancels it (this used to give them nothing, to stop credit
// "farming"): a credit tied to teacher A, spent on a trial with teacher
// B, would otherwise come back as a brand-new credit tied to B - good
// for a full lesson with B - turning a cheap teacher's credit into an
// expensive teacher's lesson. Getting the original credit back can never
// be worth more than what was spent. A booking with no successful
// payment on file (pre-payment-system bookings) simply has nothing to
// give back - it still gets cancelled normally.
//
// Also sends a cancellation email (RESEND_API_KEY, EMAIL_FROM secrets,
// same as the other Edge Functions) to whichever participant did NOT
// initiate the cancellation - the one who clicked "cancel" already gets
// immediate feedback in the UI, so re-emailing them their own action
// would just be noise. An admin cancellation notifies both, since
// neither participant did it themselves.
//
// SITE_URL, RESEND_API_KEY, EMAIL_FROM - same as create-payment /
// payment-callback / send-lesson-reminder.

import { createClient } from "npm:@supabase/supabase-js@2";

// mirrored by bookings.js's ARMUS_FREE_CANCEL_HOURS (my-lessons.html's
// refund hint) - keep the two in sync
const FREE_CANCEL_HOURS = 12;
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://armus.com.tr").replace(/\/$/, "");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("EMAIL_FROM") ?? "ARMUS <onboarding@resend.dev>";

const DAY_NAMES = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const MONTH_NAMES = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];
const EN_WEEKDAY_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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

function cancelledEmailHtml(recipientName: string, otherName: string, whenLabel: string, note: string) {
  return `
  <div style="background:#0d0d0f;padding:40px 20px;font-family:Arial,sans-serif;">
    <div style="max-width:440px;margin:0 auto;background:#1a1712;border:1px solid #2e2a22;border-radius:16px;padding:32px;text-align:center;">
      <div style="font-size:22px;font-weight:800;letter-spacing:-1px;background:linear-gradient(90deg,#e8c777,#b8860b);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:24px;">ARMUS</div>
      <p style="color:#f4f4f2;font-size:14px;margin:0 0 6px;">Merhaba ${escapeHtml(recipientName)},</p>
      <p style="color:#a3a3a6;font-size:13px;line-height:1.6;margin:0 0 10px;">
        <strong style="color:#f4f4f2;">${escapeHtml(otherName)}</strong> ile
        <strong style="color:#e8c777;">${whenLabel}</strong> için planlanan ders iptal edildi.
      </p>
      <p style="color:#a3a3a6;font-size:12.5px;line-height:1.6;margin:0 0 22px;">${escapeHtml(note)}</p>
      <a href="${SITE_URL}/my-lessons.html" style="display:inline-block;background:linear-gradient(90deg,#e8c777,#b8860b);color:#1c1c1e;font-size:14px;font-weight:700;padding:13px 26px;border-radius:12px;text-decoration:none;">Derslerimi Gör</a>
    </div>
  </div>`;
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

// lesson_date/lesson_time are plain wall-clock strings with no zone of
// their own - booking.teacher_timezone (migration_37.sql) says which
// IANA zone they're wall-clock time IN. This turns them into the real
// UTC instant, correctly handling DST for any zone (not just
// Europe/Istanbul, which has none) - the standard "double conversion"
// trick: format a UTC guess back in the target zone, see how far off the
// wall-clock reading is, and shift by that difference. Without this, the
// "lesson already passed" check and the free-cancellation window
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
    // "Cancelled and Paid" - a student cancelling inside the 12-hour
    // window (see this file's header)
    const lateCancel = cancelledBy === "student" && !refundEligible;

    const { data: claimedBooking } = await supabaseAdmin
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: cancelledBy,
        late_cancel: lateCancel,
      })
      .eq("id", booking.id)
      .eq("status", "confirmed")
      .select()
      .maybeSingle();

    if (!claimedBooking) {
      return jsonResponse({ error: "Bu rezervasyon zaten iptal edilmiş." }, 400);
    }

    let refunded = false;

    if (refundEligible) {
      const { data: payment } = await supabaseAdmin
        .from("pending_payments")
        .select("id")
        .eq("booking_id", booking.id)
        .eq("status", "succeeded")
        .maybeSingle();

      if (payment) {
        // card-paid: the lesson goes back as a new credit with this teacher
        const { error: creditError } = await supabaseAdmin.from("lesson_credits").insert({
          student_id: booking.student_id,
          teacher_id: booking.teacher_id,
          teacher_name: booking.teacher_name,
          source_booking_id: booking.id,
        });
        if (creditError) console.error("lesson credit grant failed", creditError);
        else refunded = true;
      } else {
        // credit-paid (no pending_payments row - see this file's header):
        // the very credit that paid for it comes back. Conditional on it
        // still being "used" by THIS booking, so two racing calls can't
        // both count it as restored.
        const { data: restoredCredit, error: restoreError } = await supabaseAdmin
          .from("lesson_credits")
          .update({ status: "available", used_booking_id: null, used_at: null })
          .eq("used_booking_id", booking.id)
          .eq("status", "used")
          .select("id")
          .maybeSingle();
        if (restoreError) console.error("lesson credit restore failed", restoreError);
        else if (restoredCredit) refunded = true;
      }

      if (refunded) {
        await supabaseAdmin.from("bookings").update({ refunded: true }).eq("id", booking.id);
      }
    }

    const studentNote = refunded
      ? "Bu ders ders hakkı olarak bakiyene geri eklendi, dilediğin zaman kullanabilirsin."
      : (cancelledBy === "student"
        ? "Derse 12 saatten az kaldığı için ders hakkı iade edilmedi."
        : "Bu ders için bir şey ödemene gerek kalmadı.");
    const teacherNote = cancelledBy === "student"
      ? (lateCancel
        ? (booking.type === "trial"
          ? "Öğrenci derse 12 saatten az kala iptal etti. Bu saatin artık boş, başka bir öğrenci rezervasyon yapabilir."
          : "Öğrenci derse 12 saatten az kala iptal ettiği için bu dersin ücreti sana ödenecek. Bu saatin artık boş, başka bir öğrenci rezervasyon yapabilir.")
        : "Bu saatin artık boş, başka bir öğrenci rezervasyon yapabilir.")
      : "İptalin kaydedildi.";

    const [{ data: studentProfile }, teacherProfileRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("email, name, timezone").eq("id", booking.student_id).maybeSingle(),
      isUuid(booking.teacher_id)
        ? supabaseAdmin.from("profiles").select("email, name, timezone").eq("id", booking.teacher_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const teacherProfile = teacherProfileRes.data;

    const notifyStudent = cancelledBy !== "student";
    const notifyTeacher = cancelledBy !== "teacher";

    if (notifyStudent && studentProfile?.email) {
      await sendEmail(
        studentProfile.email,
        "Bir dersin iptal edildi - ARMUS",
        cancelledEmailHtml(
          studentProfile.name, shortDisplayName(booking.teacher_name),
          formatDateTimeLabel(lessonStart, studentProfile.timezone), studentNote,
        ),
      );
    }
    if (notifyTeacher && teacherProfile?.email) {
      await sendEmail(
        teacherProfile.email,
        "Bir dersin iptal edildi - ARMUS",
        cancelledEmailHtml(
          teacherProfile.name, booking.student_name,
          formatDateTimeLabel(lessonStart, teacherProfile.timezone), teacherNote,
        ),
      );
    }

    return jsonResponse({ ok: true, refunded, refundEligible, lateCancel });

  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
