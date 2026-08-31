// ARMUS - checks the 6-digit code the user typed in on register.html
// against the most recent one sent by send-verification-email, and
// flips profiles.email_verified on a match.
//
// No secrets needed beyond the ones Supabase injects automatically
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY).

import { createClient } from "npm:@supabase/supabase-js@2";

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
    const submittedCode = String(body.code || "").trim();

    if (!submittedCode) return jsonResponse({ error: "Kod gerekli." }, 400);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: verification } = await supabaseAdmin
      .from("email_verifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!verification) return jsonResponse({ error: "Önce bir doğrulama kodu iste." }, 400);

    if (new Date(verification.expires_at) < new Date()) {
      return jsonResponse({ error: "Kodun süresi doldu. Yeni bir kod iste." }, 400);
    }

    if (verification.attempts >= 5) {
      return jsonResponse({ error: "Çok fazla yanlış deneme. Yeni bir kod iste." }, 400);
    }

    if (verification.code !== submittedCode) {
      await supabaseAdmin
        .from("email_verifications")
        .update({ attempts: verification.attempts + 1 })
        .eq("id", verification.id);
      return jsonResponse({ error: "Kod yanlış. Tekrar dene." }, 400);
    }

    await supabaseAdmin.from("profiles").update({ email_verified: true }).eq("id", user.id);
    await supabaseAdmin.from("email_verifications").delete().eq("id", verification.id);

    return jsonResponse({ ok: true });

  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
