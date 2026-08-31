// ARMUS - emails a 6-digit verification code to the just-registered user,
// via Resend. Called from register.html right after signup succeeds, and
// again whenever the user hits "Kodu tekrar gönder" (resend).
//
// Needs these secrets set (Edge Functions -> Manage secrets):
//   RESEND_API_KEY
// Optional:
//   EMAIL_FROM - defaults to "ARMUS <onboarding@resend.dev>". Resend's
//     onboarding@resend.dev address works with zero setup and can send to
//     any recipient, but switch this to your own verified domain once you
//     have one (Resend Dashboard -> Domains) for a real "from" address.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are
// already injected automatically into every Edge Function.

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("EMAIL_FROM") ?? "ARMUS <onboarding@resend.dev>";

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

function verificationEmailHtml(name: string, code: string) {
  return `
  <div style="background:#0d0d0f;padding:40px 20px;font-family:Arial,sans-serif;">
    <div style="max-width:420px;margin:0 auto;background:#1a1712;border:1px solid #2e2a22;border-radius:16px;padding:32px;text-align:center;">
      <div style="font-size:22px;font-weight:800;letter-spacing:-1px;background:linear-gradient(90deg,#e8c777,#b8860b);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:24px;">ARMUS</div>
      <p style="color:#f4f4f2;font-size:14px;margin:0 0 6px;">Merhaba ${name || ""},</p>
      <p style="color:#a3a3a6;font-size:13px;line-height:1.6;margin:0 0 22px;">Hesabını doğrulamak için aşağıdaki kodu gir. Kod 10 dakika geçerli.</p>
      <div style="display:inline-block;background:linear-gradient(90deg,#e8c777,#b8860b);color:#1c1c1e;font-size:28px;font-weight:800;letter-spacing:8px;padding:14px 26px;border-radius:12px;">${code}</div>
      <p style="color:#66666a;font-size:11px;margin:26px 0 0;">Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.</p>
    </div>
  </div>`;
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

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // simple resend cooldown - don't let the same user trigger a flood of
    // emails by mashing "kodu tekrar gönder"
    const { data: recent } = await supabaseAdmin
      .from("email_verifications")
      .select("created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recent && Date.now() - new Date(recent.created_at).getTime() < 45_000) {
      return jsonResponse({ error: "Çok sık istek gönderdin, biraz sonra tekrar dene." }, 429);
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("name, email")
      .eq("id", user.id)
      .single();

    if (!profile?.email) return jsonResponse({ error: "Profil bulunamadı." }, 400);

    const code = String(Math.floor(100000 + Math.random() * 900000));

    const { error: insertError } = await supabaseAdmin.from("email_verifications").insert({
      user_id: user.id,
      code,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });

    if (insertError) {
      console.error("email_verifications insert failed", insertError);
      return jsonResponse({ error: "Kod oluşturulamadı." }, 500);
    }

    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: profile.email,
        subject: "ARMUS doğrulama kodun",
        html: verificationEmailHtml(profile.name, code),
      }),
    });

    if (!resendResp.ok) {
      console.error("resend send failed", await resendResp.text());
      return jsonResponse({ error: "E-posta gönderilemedi." }, 500);
    }

    return jsonResponse({ ok: true });

  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
