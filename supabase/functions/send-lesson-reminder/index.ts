// ARMUS - emails a "your lesson starts soon" reminder for one booking,
// via Resend. Called by the armus-lesson-reminders cron job (see the
// bottom of schema.sql / migration_23.sql) roughly 50-70 minutes before
// each lesson - never called directly by the site itself.
//
// IMPORTANT: after deploying this function, go to its Settings and turn
// OFF "Verify JWT" (Enforce JWT Verification) - the cron job's HTTP call
// carries no Supabase auth token, same as payment-callback.
//
// Needs these secrets set (Edge Functions -> Manage secrets):
//   RESEND_API_KEY
// Optional:
//   EMAIL_FROM - defaults to "ARMUS <onboarding@resend.dev>"
//   SITE_URL - defaults to "https://armus.vercel.app"

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("EMAIL_FROM") ?? "ARMUS <onboarding@resend.dev>";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://armus.vercel.app").replace(/\/$/, "");

const DAY_NAMES = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const MONTH_NAMES = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];
const EN_WEEKDAY_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// lesson_date/lesson_time are plain wall-clock strings with no zone of
// their own - teacherTimezone (bookings.teacher_timezone, migration_37.sql)
// says which IANA zone they're wall-clock time IN. This turns them into
// the real UTC instant, correctly handling DST for any zone - the
// standard "double conversion" trick: format a UTC guess back in the
// target zone, see how far off the wall-clock reading is, and shift by
// that difference.
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

// The lesson's real UTC instant, formatted back out in ONE SPECIFIC
// recipient's own timezone (profiles.timezone) - a student in Istanbul
// and a teacher travelling abroad can each get a correct "starts soon"
// email in their own local time from the same booking.
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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// recipientName/otherName ultimately come from profiles.name, which a
// student or teacher sets themselves at signup - without this, either
// side of a booking could put arbitrary markup in their own display name
// and have it injected straight into an email sent to the OTHER
// participant (e.g. a fake link overlaid on the real "Derse Katıl" button).
function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function reminderEmailHtml(recipientName: string, otherName: string, whenLabel: string, joinUrl: string) {
  return `
  <div style="background:#0d0d0f;padding:40px 20px;font-family:Arial,sans-serif;">
    <div style="max-width:440px;margin:0 auto;background:#1a1712;border:1px solid #2e2a22;border-radius:16px;padding:32px;text-align:center;">
      <div style="font-size:22px;font-weight:800;letter-spacing:-1px;background:linear-gradient(90deg,#e8c777,#b8860b);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:24px;">ARMUS</div>
      <p style="color:#f4f4f2;font-size:14px;margin:0 0 6px;">Merhaba ${escapeHtml(recipientName || "")},</p>
      <p style="color:#a3a3a6;font-size:13px;line-height:1.6;margin:0 0 22px;">
        <strong style="color:#f4f4f2;">${escapeHtml(otherName || "")}</strong> ile dersin yaklaşıyor:<br>
        <strong style="color:#e8c777;">${whenLabel}</strong>
      </p>
      <a href="${joinUrl}" style="display:inline-block;background:linear-gradient(90deg,#e8c777,#b8860b);color:#1c1c1e;font-size:14px;font-weight:700;padding:13px 26px;border-radius:12px;text-decoration:none;">Derse Katıl</a>
      <p style="color:#66666a;font-size:11px;margin:26px 0 0;">Ders saatine kadar hazır olman gerekmez, bu bağlantı ders başladığında açılacak.</p>
    </div>
  </div>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!resp.ok) console.error("resend send failed", to, await resp.text());
  return resp.ok;
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const bookingId = body.booking_id;
    if (!bookingId) return new Response("missing booking_id", { status: 400 });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: booking } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .eq("reminder_sent", false)
      .maybeSingle();

    // already reminded (or doesn't exist any more) - nothing to do,
    // this isn't an error
    if (!booking) return new Response("skip", { status: 200 });

    const lessonInstant = zonedTimeToUtc(booking.lesson_date, booking.lesson_time, booking.teacher_timezone);
    const joinUrl = `${SITE_URL}/class.html?booking=${booking.id}`;
    const subject = "Dersin yaklaşıyor - ARMUS";

    const { data: studentProfile } = await supabaseAdmin
      .from("profiles")
      .select("email, name, timezone")
      .eq("id", booking.student_id)
      .maybeSingle();

    if (studentProfile?.email) {
      const studentWhenLabel = formatDateTimeLabel(lessonInstant, studentProfile.timezone);
      await sendEmail(studentProfile.email, subject, reminderEmailHtml(studentProfile.name, booking.teacher_name, studentWhenLabel, joinUrl));
    }

    // teacher_id can be a demo teacher (teachers-data.js, not a real
    // Supabase user/profile) - only look one up when it's a real UUID
    if (isUuid(booking.teacher_id)) {
      const { data: teacherProfile } = await supabaseAdmin
        .from("profiles")
        .select("email, name, timezone")
        .eq("id", booking.teacher_id)
        .maybeSingle();

      if (teacherProfile?.email) {
        const teacherWhenLabel = formatDateTimeLabel(lessonInstant, teacherProfile.timezone);
        await sendEmail(teacherProfile.email, subject, reminderEmailHtml(teacherProfile.name, booking.student_name, teacherWhenLabel, joinUrl));
      }
    }

    await supabaseAdmin.from("bookings").update({ reminder_sent: true }).eq("id", bookingId);

    return new Response("sent", { status: 200 });

  } catch (err) {
    console.error(err);
    return new Response("error", { status: 500 });
  }
});
