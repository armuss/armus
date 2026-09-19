// ARMUS - permanently deletes the caller's own account (Apple Guideline
// 5.1.1(v): an app that supports account creation must let the user
// delete it from inside the app, not just deactivate it).
//
// Deleting the auth.users row cascades through every Postgres table on
// its own: profiles.id references auth.users(id) on delete cascade, and
// every other table (bookings, pending_payments, reviews, lesson_credits,
// conversations/messages, disputes, teacher_notes, vocab_entries,
// confidence_checkins, ...) references profiles(id) on delete cascade
// too - see schema.sql. But Storage objects (teacher-uploads,
// chat-attachments - both public buckets: any URL into them is servable
// to anyone, forever, with no ownership check on reads) live in a
// separate schema Postgres's cascade never reaches, and storage.objects.owner
// gets set to null once the user is gone rather than cascading - so those
// files have to be listed and removed explicitly, BEFORE the user is
// deleted (while `owner` can still be matched against their id), or a
// deleted user's photo, certificate, intro video, or chat attachments
// stay world-readable forever with no owner left to ever take them down.
//
// Note: this is a hard delete, on purpose - a teacher's past bookings
// with a student who deletes their account disappear along with them,
// same as the student's own history does. That's the expected shape of
// "delete my account", not a bug to work around here.
//
// No secrets needed beyond the auto-injected SUPABASE_* ones.

const OWNED_STORAGE_BUCKETS = ["teacher-uploads", "chat-attachments"];

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

    // best-effort, and BEFORE deleting the user - storage.objects.owner
    // is only matchable against user.id while the user still exists.
    // A failure here is logged but never blocks the actual account
    // deletion (a storage hiccup shouldn't be why someone can't delete
    // their account).
    for (const bucket of OWNED_STORAGE_BUCKETS) {
      const { data: objects, error: listError } = await supabaseAdmin
        .schema("storage")
        .from("objects")
        .select("name")
        .eq("bucket_id", bucket)
        .eq("owner", user.id);

      if (listError) {
        console.error(`listing ${bucket} objects for deleted account failed`, listError);
        continue;
      }

      const paths = (objects || []).map((o: { name: string }) => o.name).filter(Boolean);
      if (paths.length === 0) continue;

      const { error: removeError } = await supabaseAdmin.storage.from(bucket).remove(paths);
      if (removeError) {
        console.error(`removing ${bucket} objects for deleted account failed`, removeError);
      }
    }

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
