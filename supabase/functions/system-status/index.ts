// ARMUS - a tiny, public, read-only health signal for status.html.
// Returns only AGGREGATE numbers (counts, timestamps) - never any
// booking/user identity - so it's safe to call with no auth at all,
// from any visitor.
//
// IMPORTANT: after deploying this function, go to its Settings and turn
// OFF "Verify JWT" - status.html calls this anonymously.
//
// Needs no secrets beyond what's already injected into every Edge
// Function (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).

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
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const since1h = new Date(Date.now() - 3600 * 1000).toISOString();

    // bookings only ever get created after a real successful charge
    // (payment-callback) or a real credit redemption (create-payment) -
    // a nonzero recent count is a reasonable, PII-free proxy signal
    // that checkout is actually working end to end, not just that the
    // database responds.
    const bookingsRes = await supabaseAdmin
      .from("bookings").select("id", { count: "exact", head: true }).gte("created_at", since24h);

    // client_errors (migration_72.sql) is a general site-wide JS error
    // log, not specific to any one provider (email/payment) - this
    // reads as "overall error rate", not a per-service check. Queried
    // defensively (own try-style null fallback) same as admin.html
    // already treats this table as best-effort.
    const errorsRes = await supabaseAdmin
      .from("client_errors").select("id", { count: "exact", head: true }).gte("created_at", since1h);

    return jsonResponse({
      db_ok: !bookingsRes.error,
      bookings_last_24h: bookingsRes.error ? null : (bookingsRes.count ?? 0),
      errors_last_hour: errorsRes.error ? null : (errorsRes.count ?? 0),
      checked_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error(err);
    return jsonResponse({ db_ok: false, error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
