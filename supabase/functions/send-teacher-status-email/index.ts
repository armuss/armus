// ARMUS - emails a teacher applicant when their profile's status changes
// to "approved" or "rejected". Fired by the
// profiles_notify_teacher_status_change trigger (migration_63.sql) right
// after admin.html approves/rejects an application (single button or the
// bulk action - both go through the same DB write) - never called
// directly by the site itself.
//
// IMPORTANT: after deploying this function, go to its Settings and turn
// OFF "Verify JWT" (Enforce JWT Verification) - the trigger's HTTP call
// carries no Supabase auth token, same as payment-callback.
//
// Since Verify JWT is off, anyone who guessed a real profile_id could
// otherwise call this function directly and get a spoofed "approved"/
// "rejected" email sent - the TRIGGER_SECRET header check below closes
// that: the trigger (migration_63.sql) sends this same secret in a
// header, and requests without it are rejected.
//
// Needs these secrets set (Edge Functions -> Manage secrets) - already
// configured for the other email-sending functions, reused here as-is:
//   RESEND_API_KEY
//   TRIGGER_SECRET - shared with migration_63.sql's trigger function, see
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

function shell(inner: string) {
  return `
  <div style="background:#0d0d0f;padding:40px 20px;font-family:Arial,sans-serif;">
    <div style="max-width:440px;margin:0 auto;background:#1a1712;border:1px solid #2e2a22;border-radius:16px;padding:32px;text-align:center;">
      <div style="font-size:22px;font-weight:800;letter-spacing:-1px;background:linear-gradient(90deg,#e8c777,#b8860b);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:24px;">ARMUS</div>
      ${inner}
    </div>
  </div>`;
}

function approvedEmailHtml(name: string) {
  return shell(`
    <p style="color:#f4f4f2;font-size:14px;margin:0 0 6px;">Tebrikler ${escapeHtml(name)},</p>
    <p style="color:#a3a3a6;font-size:13px;line-height:1.6;margin:0 0 22px;">
      Öğretmen başvurun <strong style="color:#e8c777;">onaylandı</strong>! Profilin artık öğrenciler tarafından görülebilir ve ders rezervasyonu alabilirsin.
    </p>
    <a href="${SITE_URL}/dashboard.html" style="display:inline-block;background:linear-gradient(90deg,#e8c777,#b8860b);color:#1c1c1e;font-size:14px;font-weight:700;padding:13px 26px;border-radius:12px;text-decoration:none;">Panelime Git</a>
    <p style="color:#66666a;font-size:11px;margin:26px 0 0;">Uygunluk saatlerini panelinden ayarlamayı unutma - saat belirlemeden öğrenciler seni rezerve edemez.</p>
  `);
}

function rejectedEmailHtml(name: string) {
  return shell(`
    <p style="color:#f4f4f2;font-size:14px;margin:0 0 6px;">Merhaba ${escapeHtml(name)},</p>
    <p style="color:#a3a3a6;font-size:13px;line-height:1.6;margin:0 0 22px;">
      Öğretmen başvurunu inceledik, bu sefer onaylayamadık. Bilgilerini güncelleyip tekrar başvurabilirsin.
    </p>
    <a href="${SITE_URL}/iletisim.html" style="display:inline-block;background:linear-gradient(90deg,#e8c777,#b8860b);color:#1c1c1e;font-size:14px;font-weight:700;padding:13px 26px;border-radius:12px;text-decoration:none;">Bize Ulaş</a>
    <p style="color:#66666a;font-size:11px;margin:26px 0 0;">Kararla ilgili bir sorun varsa bize yazabilirsin.</p>
  `);
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
    const profileId = body.profile_id;
    const status = body.status;
    if (!profileId || (status !== "approved" && status !== "rejected")) {
      return new Response("missing/invalid fields", { status: 400 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email, name")
      .eq("id", profileId)
      .maybeSingle();

    if (!profile?.email) return new Response("skip", { status: 200 });

    if (status === "approved") {
      await sendEmail(profile.email, "Öğretmen başvurun onaylandı! - ARMUS", approvedEmailHtml(profile.name));
    } else {
      await sendEmail(profile.email, "Öğretmen başvurun hakkında - ARMUS", rejectedEmailHtml(profile.name));
    }

    return new Response("sent", { status: 200 });

  } catch (err) {
    console.error(err);
    return new Response("error", { status: 500 });
  }
});
