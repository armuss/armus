// ARMUS - emails each affected student when their lessons are cancelled
// by the system rather than by a person. Never called by the site
// itself. Two callers, each passing its own reason:
//   - "teacher_banned": a teacher's account was closed by the attendance
//     system (10 upheld no-shows), which cancels every one of that
//     teacher's upcoming lessons (migration_104.sql's
//     profiles_cancel_lessons_on_ban trigger)
//   - "teacher_no_show": an admin upheld a student's report that the
//     teacher never showed up, which cancels that lesson and gives it
//     back to the student (migration_106.sql's
//     handle_attendance_report_resolution)
//
// IMPORTANT: after deploying this function, go to its Settings and turn
// OFF "Verify JWT" (Enforce JWT Verification) - the trigger's HTTP call
// carries no Supabase auth token. The TRIGGER_SECRET header check below
// is what stops anyone else from calling it.
//
// Needs these secrets (already set for the other email functions):
//   RESEND_API_KEY
//   TRIGGER_SECRET
// Optional:
//   EMAIL_FROM - defaults to "ARMUS <onboarding@resend.dev>"
//   SITE_URL - defaults to "https://armus.com.tr"

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const TRIGGER_SECRET = Deno.env.get("TRIGGER_SECRET") ?? "";
const FROM_EMAIL = Deno.env.get("EMAIL_FROM") ?? "ARMUS <onboarding@resend.dev>";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://armus.com.tr").replace(/\/$/, "");

const DAY_NAMES = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const MONTH_NAMES = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];
const EN_WEEKDAY_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function escapeHtml(str: string) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// a teacher's full name is never shown to a student anywhere - same
// policy as cancel-booking's own emails (see armusShortDisplayName)
function shortDisplayName(fullName: string) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "Öğretmen";
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// mirrors cancel-booking/index.ts's armusZonedTimeToUtc
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

// mirrors cancel-booking/index.ts's formatDateTimeLabel - the lesson time
// in the STUDENT's own timezone, not the teacher's
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

function noteFor(reason: string, refunded: boolean) {
  if (reason === "teacher_banned") {
    // the credit is tied to this teacher, and they can't be booked
    // anymore - so in practice it covers a trial lesson with someone
    // else (create-payment's own credit rules). Saying so plainly beats
    // a generic "you got a credit" the student then can't use the way
    // they'd expect.
    return refunded
      ? "Öğretmenin hesabı kapatıldığı için bu ders iptal edildi. Bu ders için bir ders hakkı kazandın - başka bir öğretmenle deneme dersi almak için kullanabilirsin."
      : "Öğretmenin hesabı kapatıldığı için bu ders iptal edildi.";
  }
  if (reason === "teacher_no_show") {
    return refunded
      ? "Öğretmenin bu derse gelmediği doğrulandı. Ders, ders hakkı olarak bakiyene geri eklendi - aynı öğretmenle ya da başka bir öğretmenle deneme dersi için kullanabilirsin."
      : "Öğretmenin bu derse gelmediği doğrulandı.";
  }
  return refunded
    ? "Bu ders iptal edildi. Bu ders için bir ders hakkı kazandın."
    : "Bu ders iptal edildi.";
}

function subjectFor(reason: string) {
  return reason === "teacher_no_show"
    ? "Dersin iade edildi - ARMUS"
    : "Bir dersin iptal edildi - ARMUS";
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
  try {
    if (!TRIGGER_SECRET || req.headers.get("x-armus-trigger-secret") !== TRIGGER_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const bookingIds = Array.isArray(body.booking_ids) ? body.booking_ids.filter(isUuid).slice(0, 500) : [];
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!bookingIds.length) {
      return new Response("missing booking_ids", { status: 400 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: bookings } = await supabaseAdmin
      .from("bookings")
      .select("id, student_id, teacher_name, lesson_date, lesson_time, teacher_timezone, status, refunded")
      .in("id", bookingIds);

    // only ever email about a booking that really is cancelled - a stale or
    // replayed call can never tell a student their still-live lesson is off
    const cancelled = (bookings || []).filter((b) => b.status === "cancelled");
    if (!cancelled.length) return new Response("skip", { status: 200 });

    const studentIds = [...new Set(cancelled.map((b) => b.student_id))];
    const { data: students } = await supabaseAdmin
      .from("profiles")
      .select("id, email, name, timezone")
      .in("id", studentIds);
    const studentById = new Map((students || []).map((s) => [s.id, s]));

    for (const b of cancelled) {
      const student = studentById.get(b.student_id);
      if (!student?.email) continue;
      const lessonStart = armusZonedTimeToUtc(b.lesson_date, b.lesson_time, b.teacher_timezone);
      await sendEmail(
        student.email,
        subjectFor(reason),
        cancelledEmailHtml(
          student.name,
          shortDisplayName(b.teacher_name),
          formatDateTimeLabel(lessonStart, student.timezone),
          noteFor(reason, !!b.refunded),
        ),
      );
    }

    return new Response("sent", { status: 200 });

  } catch (err) {
    console.error(err);
    return new Response("error", { status: 500 });
  }
});
