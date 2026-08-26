/*
 * ARMUS - dispute / issue reports (a student or teacher flags a problem
 * with a booking; an admin triages and resolves it).
 * Requires supabase-config.js (Supabase SDK + armusSupabase client) to be
 * loaded before this file.
 */

async function armusCreateDispute({ bookingId, reporterId, reporterName, reporterRole, otherPartyName, subject, description }) {
  const { data, error } = await armusSupabase
    .from("disputes")
    .insert({
      booking_id: bookingId,
      reporter_id: reporterId,
      reporter_name: reporterName,
      reporter_role: reporterRole,
      other_party_name: otherPartyName,
      subject,
      description,
    })
    .select()
    .single();

  if (error) return false;
  return data;
}

// The reporting user's own disputes (my-lessons.html "your reports so far").
async function armusGetOwnDisputes(reporterId) {
  const { data, error } = await armusSupabase
    .from("disputes")
    .select("*")
    .eq("reporter_id", reporterId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data;
}

// Admin-only: every dispute. The disputes_select_own_or_admin RLS policy
// is what actually enforces this - a non-admin caller only gets their own.
async function armusAdminGetAllDisputes() {
  const { data, error } = await armusSupabase
    .from("disputes")
    .select("*")
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data;
}

async function armusAdminUpdateDispute(id, updates) {
  const { data, error } = await armusSupabase
    .from("disputes")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return false;
  return data;
}
