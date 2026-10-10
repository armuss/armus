// ARMUS - sign-in, routed through a temporary per-email throttle
// (login_attempts / reserve_login_attempt / resolve_login_attempt,
// migration_99.sql) instead of calling Supabase Auth's
// signInWithPassword directly from the client, which had no limit at
// all on how many passwords could be tried against one email.
//
// Called by armusSignIn (auth.js) on every login attempt, authenticated
// or not - this IS the pre-auth entry point, so it needs no user JWT.
//
// IMPORTANT: after deploying this function, go to its Settings and turn
// OFF "Verify JWT" (Enforce JWT Verification) - same reasoning as
// send-verification-email/verify-email-code, both also called before
// any session exists.
//
// Needs no secrets beyond what's already injected into every Edge
// Function (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
//
// Does NOT rely on this Edge Function's own Deno.env.get("SUPABASE_ANON_KEY")
// for the GoTrue call below - that broke login outright in production
// (every attempt failed, even with a correct password) even with
// "Verify JWT" off, most likely because this project has since rotated
// to Supabase's newer publishable/secret API key format and the
// auto-injected SUPABASE_ANON_KEY no longer resolves to a key GoTrue's
// token endpoint accepts. The client instead sends its own anon key
// (anon_key below) - ARMUS_SUPABASE_ANON_KEY is already fully public
// (embedded in every page's supabase-config.js), so this costs nothing,
// and it's guaranteed to be the exact same key every other Supabase call
// on the site already authenticates successfully with.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

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
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const anonKey = typeof body.anon_key === "string" && body.anon_key ? body.anon_key : "";

    if (!email || !password) {
      return jsonResponse({ error: "E-posta ve şifre gerekli." }, 400);
    }
    if (!anonKey) {
      return jsonResponse({ error: "Giriş yapılamadı. Lütfen tekrar dene." }, 400);
    }

    const supabaseAdmin = createClient(
      SUPABASE_URL,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: attemptId, error: reserveError } = await supabaseAdmin
      .rpc("reserve_login_attempt", { p_email: email });

    // fail OPEN: if the attempt-throttling mechanism itself is broken
    // for any infra reason (a migration not yet applied, a transient
    // PostgREST schema-cache lag right after it was, ...), that must
    // never be the reason a legitimate login fails outright - skip the
    // attempt-counting for this one request rather than block someone
    // over a problem unrelated to their password.
    const throttleWorking = !reserveError;
    if (reserveError) console.error("reserve_login_attempt failed, skipping throttle for this request", reserveError);

    if (throttleWorking && !attemptId) {
      return jsonResponse({ error: "Çok fazla başarısız deneme yaptın. Lütfen 15 dakika sonra tekrar dene." }, 429);
    }

    // the actual password check - GoTrue's own token endpoint, the same
    // one the client's signInWithPassword would otherwise call directly
    const tokenResp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    const succeeded = tokenResp.ok;
    const tokenData = await tokenResp.json().catch(() => ({}));

    if (!succeeded) console.error("GoTrue token request failed", tokenResp.status, tokenData);

    if (throttleWorking && attemptId) {
      await supabaseAdmin.rpc("resolve_login_attempt", { p_id: attemptId, p_succeeded: succeeded });
    }

    if (!succeeded) {
      return jsonResponse({ error: "E-posta veya şifre hatalı." }, 400);
    }

    return jsonResponse({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
    });

  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
