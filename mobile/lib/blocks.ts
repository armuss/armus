import { cancelBooking, lessonWindow } from './bookings';
import { supabase } from './supabase';

// Students a teacher has blocked - the website's teacher-blocks.js
// (migration_96.sql enforce_teacher_block on bookings; migration_101.sql:
// a required reason, the pair's future lessons auto-cancelled, messaging
// blocked too). The student never sees blocked_students itself (RLS);
// amIBlockedBy is their one legal way to learn it.

export type BlockReason = 'harassment' | 'payment_bypass' | 'scam' | 'dont_want_to_teach' | 'other';

// the reasons and their wording, as on the website's block dialog
export const BLOCK_REASONS: { value: BlockReason; label: string }[] = [
  { value: 'harassment', label: 'Taciz / uygunsuz davranış' },
  { value: 'payment_bypass', label: 'Platform dışında ödeme teklif etti' },
  { value: 'scam', label: 'Dolandırıcılık şüphesi' },
  { value: 'dont_want_to_teach', label: 'Bu öğrenciye ders vermek istemiyorum' },
  { value: 'other', label: 'Diğer' },
];

export async function getBlockedStudents(teacherId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('blocked_students').select('student_id').eq('teacher_id', teacherId);
  if (error || !data) return new Set();
  return new Set(data.map((r: any) => r.student_id));
}

// Every still-confirmed lesson of this pair that hasn't started yet goes
// through cancel-booking one by one (the same credit-back as a teacher's
// own cancel). Returns how many were cancelled.
async function cancelFutureLessonsForBlock(teacherId: string, studentId: string): Promise<number> {
  const { data, error } = await supabase
    .from('bookings')
    .select('id, lesson_date, lesson_time, teacher_timezone')
    .eq('teacher_id', teacherId)
    .eq('student_id', studentId)
    .eq('status', 'confirmed');
  if (error || !data) return 0;
  const now = new Date();
  const futureIds = data
    .filter((b: any) => lessonWindow({ date: b.lesson_date, time: b.lesson_time, teacherTimezone: b.teacher_timezone }).start > now)
    .map((b: any) => b.id);
  let cancelled = 0;
  for (const id of futureIds) {
    const result = await cancelBooking(id);
    if (result.ok) cancelled++;
  }
  return cancelled;
}

export async function blockStudent(
  teacherId: string,
  studentId: string,
  reason: BlockReason,
  note?: string
): Promise<{ ok: boolean; cancelledCount: number }> {
  const row: Record<string, unknown> = { teacher_id: teacherId, student_id: studentId, reason };
  if (reason === 'other' && note) row.reason_note = note;
  const { error } = await supabase.from('blocked_students').insert(row);
  if (error) return { ok: false, cancelledCount: 0 };
  return { ok: true, cancelledCount: await cancelFutureLessonsForBlock(teacherId, studentId) };
}

export async function unblockStudent(teacherId: string, studentId: string): Promise<boolean> {
  const { error } = await supabase.from('blocked_students').delete().eq('teacher_id', teacherId).eq('student_id', studentId);
  return !error;
}

// the student's side (am_i_blocked_by RPC)
export async function amIBlockedBy(teacherId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('am_i_blocked_by', { p_teacher_id: teacherId });
  if (error) return false;
  return data === true;
}
