/*
 * ARMUS - a teacher's private notes about individual students. Never
 * shown to the student or anyone else (RLS restricts rows to
 * auth.uid() = teacher_id).
 * Requires supabase-config.js (Supabase SDK + armusSupabase client) to be
 * loaded before this file.
 */

// All of the current teacher's notes, keyed by student_id for easy lookup.
async function armusGetTeacherNotes(teacherId) {
  const { data, error } = await armusSupabase
    .from("teacher_notes")
    .select("*")
    .eq("teacher_id", teacherId);

  if (error || !data) return {};
  return Object.fromEntries(data.map(row => [row.student_id, row]));
}

async function armusSaveTeacherNote(teacherId, studentId, note) {
  const { data, error } = await armusSupabase
    .from("teacher_notes")
    .upsert(
      { teacher_id: teacherId, student_id: studentId, note, updated_at: new Date().toISOString() },
      { onConflict: "teacher_id,student_id" }
    )
    .select()
    .single();

  if (error) return false;
  return data;
}
