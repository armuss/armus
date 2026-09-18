// ARMUS - emails "you've got a new message" to whichever participant did
// NOT send it, via Resend. Fired by the messages_notify_new_message
// trigger (migration_62.sql) right after every message insert - never
// called directly by the site itself.
//
// IMPORTANT: after deploying this function, go to its Settings and turn
// OFF "Verify JWT" (Enforce JWT Verification) - the trigger's HTTP call
// carries no Supabase auth token, same as payment-callback.
//
// Since Verify JWT is off, anyone who guessed a real message_id could
// otherwise call this function directly and force a re-send - the
// TRIGGER_SECRET header check below closes that: the trigger (migration_62.sql)
// sends this same secret in a header, and requests without it are rejected.
//
// Needs these secrets set (Edge Functions -> Manage secrets) - already
// configured for the other email-sending functions, reused here as-is:
//   RESEND_API_KEY
//   TRIGGER_SECRET - shared with migration_62.sql's trigger function, see
//     migration_65.sql for how it's set on the database side
// Optional:
//   EMAIL_FROM - defaults to "ARMUS <onboarding@resend.dev>"
//   SITE_URL - defaults to "https://armus.com.tr"
//
// This sends one email per message with no debounce - a fast back-and-
// forth conversation means one email per reply. Fine for now; if that
// turns out to be too noisy in practice, the fix is a short delay/batch
// window in this function (e.g. skip sending if this recipient already
// got one for this conversation in the last few minutes), not a schema
// change.

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

// mirrors mesajlar.html's attachmentPreviewLabel
function attachmentPreviewLabel(type: string | null) {
  if (type === "image") return "📷 Fotoğraf";
  if (type === "video") return "🎥 Video";
  if (type === "audio") return "🎤 Sesli mesaj";
  return "Mesaj";
}

function newMessageEmailHtml(recipientName: string, senderName: string, preview: string) {
  return `
  <div style="background:#0d0d0f;padding:40px 20px;font-family:Arial,sans-serif;">
    <div style="max-width:440px;margin:0 auto;background:#1a1712;border:1px solid #2e2a22;border-radius:16px;padding:32px;text-align:center;">
      <div style="font-size:22px;font-weight:800;letter-spacing:-1px;background:linear-gradient(90deg,#e8c777,#b8860b);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:24px;">ARMUS</div>
      <p style="color:#f4f4f2;font-size:14px;margin:0 0 6px;">Merhaba ${escapeHtml(recipientName)},</p>
      <p style="color:#a3a3a6;font-size:13px;line-height:1.6;margin:0 0 18px;">
        <strong style="color:#f4f4f2;">${escapeHtml(senderName)}</strong> sana bir mesaj gönderdi:
      </p>
      <div style="background:#0d0d0f;border:1px solid #2e2a22;border-radius:12px;padding:14px 18px;color:#d4d4d6;font-size:13px;text-align:left;margin:0 0 22px;">
        ${escapeHtml(preview)}
      </div>
      <a href="${SITE_URL}/mesajlar.html" style="display:inline-block;background:linear-gradient(90deg,#e8c777,#b8860b);color:#1c1c1e;font-size:14px;font-weight:700;padding:13px 26px;border-radius:12px;text-decoration:none;">Mesajı Gör</a>
      <p style="color:#66666a;font-size:11px;margin:26px 0 0;">Bu mesaja bu e-postadan cevap veremezsin, ARMUS üzerinden yazışmaya devam et.</p>
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
    const messageId = body.message_id;
    if (!messageId) return new Response("missing message_id", { status: 400 });

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: message } = await supabaseAdmin
      .from("messages")
      .select("*")
      .eq("id", messageId)
      .maybeSingle();

    if (!message) return new Response("skip", { status: 200 });

    const { data: conversation } = await supabaseAdmin
      .from("conversations")
      .select("student_id, teacher_id")
      .eq("id", message.conversation_id)
      .maybeSingle();

    if (!conversation) return new Response("skip", { status: 200 });

    const recipientId = conversation.student_id === message.sender_id
      ? conversation.teacher_id
      : conversation.student_id;

    const [{ data: recipient }, { data: sender }] = await Promise.all([
      supabaseAdmin.from("profiles").select("email, name").eq("id", recipientId).maybeSingle(),
      supabaseAdmin.from("profiles").select("name").eq("id", message.sender_id).maybeSingle(),
    ]);

    if (!recipient?.email) return new Response("skip", { status: 200 });

    const preview = message.body ? message.body.slice(0, 200) : attachmentPreviewLabel(message.attachment_type);

    await sendEmail(
      recipient.email,
      "Yeni bir mesajın var - ARMUS",
      newMessageEmailHtml(recipient.name, sender?.name || "Bir kullanıcı", preview),
    );

    return new Response("sent", { status: 200 });

  } catch (err) {
    console.error(err);
    return new Response("error", { status: 500 });
  }
});
