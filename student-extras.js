/*
 * ARMUS - student panel extras: personal vocabulary vault and
 * post-lesson speaking confidence check-ins. Both tables are entirely
 * student-owned (see migration_17.sql's RLS policies), so every
 * function here operates on the current user's own rows.
 * Requires supabase-config.js (armusSupabase) and auth.js
 * (armusGetSession) to be loaded first.
 */

// ---- vocabulary vault ------------------------------------------------

// 1000 is far above any real student's vocab deck (student-dashboard.html's
// flashcard study/filter/mastery-count UI genuinely needs the whole
// deck, unlike confidence check-ins below, so this isn't a page-size
// limit for the UI - it's a sanity cap against this query growing
// completely unbounded for an account that's been adding words for
// years, same reasoning as every other "add order/limit" fix in this
// codebase).
async function armusGetVocabEntries(studentId) {

  const { data, error } = await armusSupabase
    .from("vocab_entries")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(1000);

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

// student-dashboard.html's trend widget only ever shows the most recent
// 10 (confidenceCheckins.slice(-10)) - this used to download every
// check-in a student has ever made, unbounded, growing forever the
// longer they use ARMUS, just to use the last 10 of it. Ordered
// descending + capped at 100 (comfortably above what renderConfidenceTrend
// needs, with headroom for the "does this past booking still need a
// check-in" lookback too) then reversed back to the ascending order
// every existing caller here already expects.
async function armusGetConfidenceCheckins(studentId) {

  const { data, error } = await armusSupabase
    .from("confidence_checkins")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return [];
  return data.reverse();
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
