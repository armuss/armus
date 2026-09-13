/*
 * ARMUS - student panel extras: personal vocabulary vault and
 * post-lesson speaking confidence check-ins. Both tables are entirely
 * student-owned (see migration_17.sql's RLS policies), so every
 * function here operates on the current user's own rows.
 * Requires supabase-config.js (armusSupabase) and auth.js
 * (armusGetSession) to be loaded first.
 */

// ---- vocabulary vault ------------------------------------------------

async function armusGetVocabEntries(studentId) {

  const { data, error } = await armusSupabase
    .from("vocab_entries")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false });

  if (error) return [];
  return data;
}

// Returns the new entry on success, or false if saving failed.
async function armusAddVocabEntry(studentId, term, meaning, category) {

  const { data, error } = await armusSupabase
    .from("vocab_entries")
    .insert({ student_id: studentId, term, meaning, category: category || "Genel" })
    .select()
    .single();

  if (error) return false;
  return data;
}

async function armusDeleteVocabEntry(id) {
  const { error } = await armusSupabase.from("vocab_entries").delete().eq("id", id);
  return !error;
}

// Student-controlled "I know this one" toggle - no schedule, no due
// dates, just a flag they can flip either way to declutter their deck.
async function armusSetVocabMastered(id, mastered) {

  const { data, error } = await armusSupabase
    .from("vocab_entries")
    .update({ mastered })
    .eq("id", id)
    .select()
    .single();

  if (error) return false;
  return data;
}

// ---- speaking confidence check-ins -----------------------------------

async function armusGetConfidenceCheckins(studentId) {

  const { data, error } = await armusSupabase
    .from("confidence_checkins")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: true });

  if (error) return [];
  return data;
}

// One check-in per booking (unique constraint) - returns the new row on
// success, or false if it failed (including a duplicate for a booking
// that already has one).
async function armusAddConfidenceCheckin(studentId, bookingId, score) {

  const { data, error } = await armusSupabase
    .from("confidence_checkins")
    .insert({ student_id: studentId, booking_id: bookingId, score })
    .select()
    .single();

  if (error) return false;
  return data;
}
