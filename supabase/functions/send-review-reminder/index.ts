// ARMUS - emails the student a "leave a review" prompt a bit after their
// lesson ends, via Resend. Called by the armus-review-reminders cron job
// (migration_64.sql) roughly 10-40 minutes after each lesson ends -
// never called directly by the site itself.
//
// IMPORTANT: after deploying this function, go to its Settings and turn
// OFF "Verify JWT" (Enforce JWT Verification) - the cron job's HTTP call
// carries no Supabase auth token, same as payment-callback.
//
// Since Verify JWT is off, anyone who guessed a real booking_id could
// otherwise call this function directly and force an early/duplicate
// review-request email - the TRIGGER_SECRET header check below closes
// that: the cron job (migration_65.sql) sends this same secret in a
// header, and requests without it are rejected.
//
// Needs these secrets set (Edge Functions -> Manage secrets) - already
// configured for the other email-sending functions, reused here as-is:
//   RESEND_API_KEY
//   TRIGGER_SECRET - shared with the armus-review-reminders cron job, see
//     migration_65.sql for how it's set on the database side
// Optional:
//   EMAIL_FROM - defaults to "ARMUS <onboarding@resend.dev>"
//   SITE_URL - defaults to "https://armus.com.tr"

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const TRIGGER_SECRET = Deno.env.get("TRIGGER_SECRET") ?? "";
const FROM_EMAIL = Deno.env.get("EMAIL_FROM") ?? "ARMUS <onboarding@resend.dev>";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://armus.com.tr").replace(/\/$/, "");

function escapeHtml(str: string) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// A teacher's full real name is never shown to a student anywhere -
// only "Ahmet Y." (see auth.js armusShortDisplayName) - so a student
// can't take that name off ARMUS and look the teacher up elsewhere,
// bypassing the platform. This email always goes to the student, so
// every teacherName it's given goes through this.
function shortDisplayName(fullName: string) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "Öğretmen";
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function reviewEmailHtml(recipientName: string, teacherName: string) {
  return `
  <div style="background:#0d0d0f;padding:40px 20px;font-family:Arial,sans-serif;">
    <div style="max-width:440px;margin:0 auto;background:#1a1712;border:1px solid #2e2a22;border-radius:16px;padding:32px;text-align:center;">
      <div style="font-size:22px;font-weight:800;letter-spacing:-1px;background:linear-gradient(90deg,#e8c777,#b8860b);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:24px;">ARMUS</div>
      <p style="color:#f4f4f2;font-size:14px;margin:0 0 6px;">Merhaba ${escapeHtml(recipientName)},</p>
      <p style="color:#a3a3a6;font-size:13px;line-height:1.6;margin:0 0 22px;">
        <strong style="color:#f4f4f2;">${escapeHtml(teacherName)}</strong> ile dersin nasıldı?
        Birkaç saniyeni ayırıp değerlendirirsen hem diğer öğrencilere yardımcı olursun hem de öğretmenine geri bildirim vermiş olursun.
      </p>
      <a href="${SITE_URL}/my-lessons.html" style="display:inline-block;background:linear-gradient(90deg,#e8c777,#b8860b);color:#1c1c1e;font-size:14px;font-weight:700;padding:13px 26px;border-radius:12px;text-decoration:none;">★ Dersi Değerlendir</a>
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
    if (!resp.ok) {
      console.error("resend send failed", to, await resp.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("resend send threw", to, err);
    return false;
  }
}

Deno.serve(async (req) => {
  try {
    if (!TRIGGER_SECRET || req.headers.get("x-armus-trigger-secret") !== TRIGGER_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const bookingId = body.booking_id;
    if (!bookingId) return new Response("missing booking_id", { status: 400 });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Atomically claim this booking before doing any work - same reason
    // as send-lesson-reminder: the cron's 10-40 minute matching window is
    // deliberately wider than its 10-minute schedule (a retry safety
    // net), so two runs can overlap while the first is still in flight.
    const { data: booking } = await supabaseAdmin
      .from("bookings")
      .update({ review_email_sent: true })
      .eq("id", bookingId)
      .eq("review_email_sent", false)
      .select()
      .maybeSingle();

    // already claimed by another run (or doesn't exist any more) -
    // nothing to do, this isn't an error
    if (!booking) return new Response("skip", { status: 200 });

    const { data: studentProfile } = await supabaseAdmin
      .from("profiles")
      .select("email, name")
      .eq("id", booking.student_id)
      .maybeSingle();

    if (!studentProfile?.email) return new Response("skip", { status: 200 });

    const ok = await sendEmail(
      studentProfile.email,
      "Dersin nasıldı? - ARMUS",
      reviewEmailHtml(studentProfile.name, shortDisplayName(booking.teacher_name)),
    );

    // a genuine send failure (Resend down, rate limited) shouldn't
    // silently lose this forever - un-claim it so the next run retries,
    // same fix as send-lesson-reminder's own version of this bug
    if (!ok) {
      await supabaseAdmin.from("bookings").update({ review_email_sent: false }).eq("id", bookingId);
      return new Response("send failed, will retry", { status: 200 });
    }

    return new Response("sent", { status: 200 });

  } catch (err) {
    console.error(err);
    return new Response("error", { status: 500 });
  }
});
