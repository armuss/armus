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
async function armusAddVocabEntry(studentId, term, meaning) {

  const { data, error } = await armusSupabase
    .from("vocab_entries")
    .insert({ student_id: studentId, term, meaning })
    .select()
    .single();

  if (error) return false;
  return data;
}

async function armusDeleteVocabEntry(id) {
  const { error } = await armusSupabase.from("vocab_entries").delete().eq("id", id);
  return !error;
}

// remembered=true pushes the entry further out on the review schedule
// (needs the *current* review_count, hence the fetch-then-write);
// remembered=false keeps it due again right away (review_count resets
// to 0, no fetch needed).
async function armusReviewVocabEntry(id, remembered) {

  if (!remembered) {
    const { data, error } = await armusSupabase
      .from("vocab_entries")
      .update({ review_count: 0, last_reviewed_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) return false;
    return data;
  }

  const { data: current, error: fetchError } = await armusSupabase
    .from("vocab_entries")
    .select("review_count")
    .eq("id", id)
    .single();

  if (fetchError) return false;

  const { data, error } = await armusSupabase
    .from("vocab_entries")
    .update({ review_count: current.review_count + 1, last_reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) return false;
  return data;
}

// A leveled schedule, not true spaced repetition: review_count 0 is due
// immediately, and each successful review pushes the next due date
// further out (0 -> 2 -> 5 -> 10 -> 20 -> 40 days, then holds at 40).
const ARMUS_VOCAB_REVIEW_INTERVALS_DAYS = [0, 2, 5, 10, 20, 40];

function armusIsVocabDue(entry) {

  if (!entry.last_reviewed_at) return true;

  const idx = Math.min(entry.review_count, ARMUS_VOCAB_REVIEW_INTERVALS_DAYS.length - 1);
  const intervalDays = ARMUS_VOCAB_REVIEW_INTERVALS_DAYS[idx];
  const dueAt = new Date(entry.last_reviewed_at).getTime() + intervalDays * 86400000;

  return Date.now() >= dueAt;
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
