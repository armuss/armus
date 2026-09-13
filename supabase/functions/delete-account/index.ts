// ARMUS - permanently deletes the caller's own account (Apple Guideline
// 5.1.1(v): an app that supports account creation must let the user
// delete it from inside the app, not just deactivate it).
//
// Deleting the auth.users row is enough on its own: profiles.id
// references auth.users(id) on delete cascade, and every other table
// (bookings, pending_payments, reviews, wallet_transactions,
// lesson_credits, conversations/messages, disputes, teacher_notes,
// vocab_entries, confidence_checkins, ...) references profiles(id) on
// delete cascade too - see schema.sql. So this one admin call is the
// whole feature; no manual table-by-table cleanup needed.
//
// Note: this is a hard delete, on purpose - a teacher's past bookings
// with a student who deletes their account disappear along with them,
// same as the student's own history does. That's the expected shape of
// "delete my account", not a bug to work around here.
//
// No secrets needed beyond the auto-injected SUPABASE_* ones.

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

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error("account delete failed", deleteError);
      return jsonResponse({ error: "Hesap silinemedi. Lütfen tekrar dene." }, 500);
    }

    return jsonResponse({ ok: true });

  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
