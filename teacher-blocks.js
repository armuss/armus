/*
 * ARMUS - students a teacher has blocked (migration_96.sql:
 * enforce_teacher_block trigger on bookings; migration_101.sql: a
 * required reason, auto-cancelling the pair's own future lessons, and
 * blocking messaging between them too). The raw blocked_students table
 * is never shown to the student directly (RLS restricts rows to
 * auth.uid() = teacher_id) - armusAmIBlockedBy below is their one
 * RLS-legal way to learn they've been blocked. Requires
 * supabase-config.js (Supabase SDK + armusSupabase client) and
 * bookings.js (armusLessonWindow/armusCancelBooking) to be loaded first.
 */

// A Set of student_ids the current teacher has blocked, for easy lookup.
async function armusGetBlockedStudents(teacherId) {
  const { data, error } = await armusSupabase
    .from("blocked_students")
    .select("student_id")
    .eq("teacher_id", teacherId);

  if (error || !data) return new Set();
  return new Set(data.map(row => row.student_id));
}

// reason: "harassment" | "payment_bypass" | "scam" | "dont_want_to_teach" | "other"
// note: free text, only meaningful (and only ever shown back to the
// teacher themselves) when reason is "other".
// Returns { ok, cancelledCount } - cancelledCount is how many of the
// pair's own future, still-confirmed lessons got auto-cancelled as a
// side effect (each one is a full lesson credit back to the student,
// same as a teacher cancelling one by hand - see cancel-booking's own
// policy on that).
async function armusBlockStudent(teacherId, studentId, reason, note) {

  const row = { teacher_id: teacherId, student_id: studentId, reason };
  if (reason === "other" && note) row.reason_note = note;

  const { error } = await armusSupabase.from("blocked_students").insert(row);
  if (error) return { ok: false, cancelledCount: 0 };

  const cancelledCount = await armusCancelFutureLessonsForBlock(teacherId, studentId);
  return { ok: true, cancelledCount };
}

async function armusUnblockStudent(teacherId, studentId) {
  const { error } = await armusSupabase
    .from("blocked_students")
    .delete()
    .eq("teacher_id", teacherId)
    .eq("student_id", studentId);

  return !error;
}

// Every still-confirmed lesson between this exact teacher/student pair
// that hasn't started yet, cancelled one at a time through the EXISTING
// cancel-booking Edge Function (armusCancelBooking, bookings.js) - the
// same claim/credit/email logic a manual teacher cancellation already
// goes through, rather than a second copy of it here. A lesson that
// already started/finished is left alone (cancel-booking itself refuses
// to touch those, so there's no need to filter it out twice - this
// filters by lessonWindow mainly to avoid a doomed network round trip
// per past booking).
async function armusCancelFutureLessonsForBlock(teacherId, studentId) {

  const { data, error } = await armusSupabase
    .from("bookings")
    .select("id, lesson_date, lesson_time, teacher_timezone")
    .eq("teacher_id", teacherId)
    .eq("student_id", studentId)
    .eq("status", "confirmed");

  if (error || !data) return 0;

  const now = new Date();
  const futureIds = data
    .filter(b => armusLessonWindow({ date: b.lesson_date, time: b.lesson_time, teacherTimezone: b.teacher_timezone }).start > now)
    .map(b => b.id);

  let cancelledCount = 0;
  for (const id of futureIds) {
    const result = await armusCancelBooking(id);
    if (result.ok) cancelledCount++;
  }
  return cancelledCount;
}

// The blocked student's own side (migration_101.sql am_i_blocked_by RPC) -
// whether teacherId has blocked the current signed-in user. mesajlar.html
// uses this to show a clear notice instead of letting a blocked student's
// message just fail against the messages_insert_own RLS check with no
// explanation.
async function armusAmIBlockedBy(teacherId) {
  const { data, error } = await armusSupabase.rpc("am_i_blocked_by", { p_teacher_id: teacherId });
  if (error) return false;
  return !!data;
}
