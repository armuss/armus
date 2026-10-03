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

    // Without an explicit order+limit, PostgREST silently caps the
    // response at its own default row limit - for a teacher with a long
    // booking history (1000+ past lessons) that cap could be reached
    // entirely by old bookings, pushing a real future one out of the
    // result and showing an actually-taken slot as free to the picker
    // (booking.html, teacher.html), risking a double-booking.
    //
    // Past bookings are irrelevant to "is this slot free" anyway - the
    // picker only ever offers today-or-later dates - so exclude anything
    // clearly in the past first; that alone keeps the result small for
    // any real teacher. lesson_date is the TEACHER's own wall-clock date
    // (migration_37.sql), so a 36-hour buffer (instead of exactly
    // "today" in UTC) comfortably covers any timezone offset without
    // risking clipping a lesson that's still today for the teacher.
    const cutoffDateKey = new Date(Date.now() - 36 * 60 * 60_000).toISOString().slice(0, 10);

    const { data, error } = await supabaseAdmin
      .from("bookings")
      .select("lesson_date, lesson_time")
      .eq("teacher_id", teacherId)
      .neq("status", "cancelled")
      .gte("lesson_date", cutoffDateKey)
      .order("lesson_date", { ascending: true })
      .limit(5000);

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
