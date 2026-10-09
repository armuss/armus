// ARMUS - emails a teacher "you've got a new review" via Resend. Fired by
// the reviews_notify_teacher trigger (migration_94.sql) right after every
// review insert - never called directly by the site itself.
//
// IMPORTANT: after deploying this function, go to its Settings and turn
// OFF "Verify JWT" (Enforce JWT Verification) - the trigger's HTTP call
// carries no Supabase auth token, same as send-message-notification.
//
// Since Verify JWT is off, anyone who guessed a real review_id could
// otherwise call this function directly and force a re-send - the
// TRIGGER_SECRET header check below closes that, same shared secret as
// the other trigger-fired email functions.
//
// Needs these secrets set (Edge Functions -> Manage secrets) - already
// configured for the other email-sending functions, reused here as-is:
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

function escapeHtml(str: string) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function starsHtml(stars: number) {
  const full = Math.max(0, Math.min(5, Math.round(stars)));
  return "★".repeat(full) + "☆".repeat(5 - full);
}

function newReviewEmailHtml(teacherName: string, studentName: string, stars: number, comment: string) {
  return `
  <div style="background:#0d0d0f;padding:40px 20px;font-family:Arial,sans-serif;">
    <div style="max-width:440px;margin:0 auto;background:#1a1712;border:1px solid #2e2a22;border-radius:16px;padding:32px;text-align:center;">
      <div style="font-size:22px;font-weight:800;letter-spacing:-1px;background:linear-gradient(90deg,#e8c777,#b8860b);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:24px;">ARMUS</div>
      <p style="color:#f4f4f2;font-size:14px;margin:0 0 6px;">Merhaba ${escapeHtml(teacherName)},</p>
      <p style="color:#a3a3a6;font-size:13px;line-height:1.6;margin:0 0 18px;">
        <strong style="color:#f4f4f2;">${escapeHtml(studentName)}</strong> sana bir değerlendirme bıraktı:
      </p>
      <div style="background:#0d0d0f;border:1px solid #2e2a22;border-radius:12px;padding:14px 18px;color:#d4d4d6;font-size:13px;text-align:left;margin:0 0 22px;">
        <div style="color:#e8c777;font-size:16px;letter-spacing:2px;margin-bottom:${comment ? "8px" : "0"};">${starsHtml(stars)}</div>
        ${comment ? escapeHtml(comment) : ""}
      </div>
      <a href="${SITE_URL}/dashboard.html" style="display:inline-block;background:linear-gradient(90deg,#e8c777,#b8860b);color:#1c1c1e;font-size:14px;font-weight:700;padding:13px 26px;border-radius:12px;text-decoration:none;">Panelimde Gör</a>
    </div>
  </div>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!resp.ok) console.error("resend send failed", to, await resp.text());
}

Deno.serve(async (req) => {
  try {
    if (!TRIGGER_SECRET || req.headers.get("x-armus-trigger-secret") !== TRIGGER_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const reviewId = body.review_id;
    if (!reviewId) return new Response("missing review_id", { status: 400 });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: review } = await supabaseAdmin
      .from("reviews")
      .select("*")
      .eq("id", reviewId)
      .maybeSingle();

    if (!review) return new Response("skip", { status: 200 });

    const { data: teacher } = await supabaseAdmin
      .from("profiles")
      .select("email, name")
      .eq("id", review.teacher_id)
      .maybeSingle();

    if (!teacher?.email) return new Response("skip", { status: 200 });

    await sendEmail(
      teacher.email,
      "Yeni bir değerlendirme aldın - ARMUS",
      newReviewEmailHtml(teacher.name, review.student_name, review.stars, review.comment || ""),
    );

    return new Response("sent", { status: 200 });

  } catch (err) {
    console.error(err);
    return new Response("error", { status: 500 });
  }
});
