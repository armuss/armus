/*
 * ARMUS - students a teacher has blocked from booking them again
 * (migration_96.sql: enforce_teacher_block trigger on bookings). Never
 * shown to the student; RLS restricts rows to auth.uid() = teacher_id.
 * Requires supabase-config.js (Supabase SDK + armusSupabase client) to be
 * loaded before this file.
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

async function armusBlockStudent(teacherId, studentId) {
  const { error } = await armusSupabase
    .from("blocked_students")
    .insert({ teacher_id: teacherId, student_id: studentId });

  return !error;
}

async function armusUnblockStudent(teacherId, studentId) {
  const { error } = await armusSupabase
    .from("blocked_students")
    .delete()
    .eq("teacher_id", teacherId)
    .eq("student_id", studentId);

  return !error;
}
