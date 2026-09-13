// ARMUS - returns just the date+time of every non-cancelled booking for
// one teacher, nothing else (no student identity, no price). Needed so
// the booking picker (booking.html) and the calendar preview on
// teacher.html can grey out a slot someone already booked.
//
// This has to go through a service-role Edge Function rather than a
// plain client query: bookings_select_participant (see schema.sql) only
// lets a signed-in student see their *own* bookings, so a prospective
// student's browser can never see that a *different* student already
// took a given slot. This function deliberately narrows the response to
// the two harmless fields needed for that - never student_name, price,
// or anything else from the row.
//
// Public on purpose (no Authorization check) - teacher.html has no
// login gate, and "is this slot free" isn't sensitive information.
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
    const body = await req.json().catch(() => ({}));
    const teacherId = body.teacherId;
    if (!teacherId) return jsonResponse({ error: "teacherId gerekli." }, 400);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabaseAdmin
      .from("bookings")
      .select("lesson_date, lesson_time")
      .eq("teacher_id", teacherId)
      .neq("status", "cancelled");

    if (error) {
      console.error(error);
      return jsonResponse({ error: "Müsaitlik alınamadı." }, 500);
    }

    return jsonResponse({
      busy: (data || []).map(row => ({ date: row.lesson_date, time: row.lesson_time })),
    });

  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
