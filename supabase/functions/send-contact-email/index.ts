// ARMUS - handles the contact form on iletisim.html. Stores the message
// in contact_messages (durable record, visible to admins even if the
// email below fails) and emails it straight to armus.support@gmail.com
// via Resend, with the visitor's own address set as reply-to so
// replying from Gmail goes directly back to them.
//
// Needs these secrets set (Edge Functions -> Manage secrets) - already
// configured for send-verification-email, reused here as-is:
//   RESEND_API_KEY
// Optional:
//   EMAIL_FROM - defaults to "ARMUS <onboarding@resend.dev>".
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are already injected
// automatically into every Edge Function.

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("EMAIL_FROM") ?? "ARMUS <onboarding@resend.dev>";
const SUPPORT_EMAIL = "armus.support@gmail.com";

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

function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function contactEmailHtml(name: string, email: string, message: string) {
  return `
  <div style="background:#0d0d0f;padding:40px 20px;font-family:Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#1a1712;border:1px solid #2e2a22;border-radius:16px;padding:32px;">
      <div style="font-size:22px;font-weight:800;letter-spacing:-1px;background:linear-gradient(90deg,#e8c777,#b8860b);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:20px;">ARMUS - Yeni İletişim Mesajı</div>
      <p style="color:#f4f4f2;font-size:13px;margin:0 0 4px;"><strong>Ad Soyad:</strong> ${escapeHtml(name)}</p>
      <p style="color:#f4f4f2;font-size:13px;margin:0 0 16px;"><strong>E-posta:</strong> ${escapeHtml(email)}</p>
      <div style="background:#0d0d0f;border:1px solid #2e2a22;border-radius:10px;padding:16px;color:#d4d4d6;font-size:13px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(message)}</div>
    </div>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const { name, email, message } = await req.json();

    if (!name || !email || !message || typeof name !== "string" || typeof email !== "string" || typeof message !== "string") {
      return jsonResponse({ error: "Tüm alanları doldurmalısın." }, 400);
    }

    // strip embedded CR/LF before these ever reach an email header
    // (subject, reply_to below) - without this, a name/email containing
    // a newline could inject extra headers into the outgoing message
    const stripNewlines = (value: string) => value.replace(/[\r\n]+/g, " ");
    const trimmedName = stripNewlines(name.trim()).slice(0, 200);
    const trimmedEmail = stripNewlines(email.trim()).slice(0, 200);
    const trimmedMessage = message.trim().slice(0, 5000);

    if (!trimmedName || !trimmedEmail || !trimmedMessage) {
      return jsonResponse({ error: "Tüm alanları doldurmalısın." }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // This form needs no login, so a per-email limit alone is worthless -
    // the caller supplies `email` freely and can just vary it. Capping by
    // IP instead stops a script from exhausting the shared Resend send
    // quota that send-verification-email also depends on (a saturated
    // quota there would block real account verification sitewide).
    // x-forwarded-for is "client, proxy1, proxy2, ..." as a request
    // passes through hops - the FIRST entry is client-supplied and
    // trivially spoofable (any caller can send an arbitrary value), but
    // the LAST entry is the one appended by our own edge network's
    // trusted final hop, so it's the one this per-IP limiter can
    // actually trust.
    const forwardedFor = req.headers.get("x-forwarded-for");
    const ip = forwardedFor ? forwardedFor.split(",").pop()?.trim() || null : null;

    if (ip) {
      const { count: recentFromIp } = await supabaseAdmin
        .from("contact_messages")
        .select("id", { count: "exact", head: true })
        .eq("ip_address", ip)
        .gte("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

      if ((recentFromIp ?? 0) >= 5) {
        return jsonResponse({ error: "Çok fazla mesaj gönderdin. Lütfen bir süre sonra tekrar dene." }, 429);
      }
    }

    const { error: insertError } = await supabaseAdmin.from("contact_messages").insert({
      name: trimmedName,
      email: trimmedEmail,
      message: trimmedMessage,
      ip_address: ip,
    });

    if (insertError) {
      console.error("contact_messages insert failed", insertError);
    }

    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: SUPPORT_EMAIL,
        reply_to: trimmedEmail,
        subject: `ARMUS iletişim formu: ${trimmedName}`,
        html: contactEmailHtml(trimmedName, trimmedEmail, trimmedMessage),
      }),
    });

    if (!resendResp.ok) {
      console.error("resend send failed", await resendResp.text());
      // The message is already saved in contact_messages above, so it's
      // not lost - but tell the caller the live email didn't go out.
      return jsonResponse({ error: "Mesajın kaydedildi ama e-posta gönderilemedi." }, 500);
    }

    return jsonResponse({ ok: true });

  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
