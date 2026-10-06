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

    // Claim this attempt with a conditional update (attempts must still
    // match what was just read) before checking the code, instead of
    // trusting the "attempts >= 5" check above and incrementing
    // unconditionally afterward. Two guesses racing (a double-submit, a
    // retried request) could otherwise both read attempts < 5 and both
    // proceed to check a code, letting more than 5 guesses actually
    // happen. This affects no one today (nothing else in the app reads
    // email_verified yet), but the cap should hold regardless.
    const { data: claimed } = await supabaseAdmin
      .from("email_verifications")
      .update({ attempts: verification.attempts + 1 })
      .eq("id", verification.id)
      .eq("attempts", verification.attempts)
      .select()
      .maybeSingle();

    if (!claimed) {
      return jsonResponse({ error: "Bir sorun oluştu, lütfen tekrar dene." }, 409);
    }

    if (verification.code !== submittedCode) {
      return jsonResponse({ error: "Kod yanlış. Tekrar dene." }, 400);
    }

    // goes through mark_email_verified() (migration_77.sql) rather than a
    // raw table update - enforce_teacher_profile_lock now rejects any
    // write to email_verified that doesn't come through it, since a raw
    // client update to this column used to let anyone mark themselves
    // verified without ever receiving or entering a code.
    //
    // The RPC's result used to be ignored here: any failure (stale deploy
    // still doing the raw update the lock trigger now rejects, a missing
    // function on a fresh install, a permission problem) still reached
    // the ok:true below. The client then redirected to the dashboard,
    // armusEnforceEmailVerification bounced the still-unverified session
    // straight back to register?resume=1, and that page's resume flow
    // auto-sent a brand-new code - an endless verify-bounce loop the
    // user could never escape, with the real error never shown anywhere.
    const { error: verifyError } = await supabaseAdmin.rpc("mark_email_verified", { p_user_id: user.id });
    if (verifyError) {
      console.error("mark_email_verified failed", verifyError);
      return jsonResponse({ error: "Kodun doğru ama doğrulama kaydedilemedi. Lütfen tekrar dene." }, 500);
    }

    // Belt and braces: only report success (and burn the code row) once
    // email_verified is really on. The profile row could be missing
    // entirely (handle_new_user failed at signup), in which case the RPC
    // above "succeeds" while updating zero rows.
    const { data: verifiedProfile } = await supabaseAdmin
      .from("profiles")
      .select("email_verified")
      .eq("id", user.id)
      .maybeSingle();

    if (!verifiedProfile?.email_verified) {
      console.error("email_verified still false after mark_email_verified", { user_id: user.id });
      return jsonResponse({ error: "Kodun doğru ama doğrulama kaydedilemedi. Lütfen tekrar dene." }, 500);
    }

    // Deleting the code row only now, after verification is confirmed -
    // deleting it before meant a failed write still consumed the one
    // valid code, leaving the account unverified and forcing a resend.
    await supabaseAdmin.from("email_verifications").delete().eq("id", verification.id);

    return jsonResponse({ ok: true });

  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
