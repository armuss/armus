import { supabase } from './supabase';

// Mirrors attendance.js's two participant-facing functions (the web app
// also has admin-only ones there, not needed on mobile's own screens).
// See migration_41.sql for the full policy behind this: a report
// immediately hides the teacher from new students until an admin
// resolves it, and repeated admin-confirmed reports escalate to a
// temporary or permanent hide.

export type AttendanceReport = {
  id: string;
  bookingId: string;
  teacherId: string;
  studentId: string;
  type: 'no_show' | 'late';
  lateMinutes: number | null;
  studentNote: string | null;
  status: string;
};

function mapRow(row: any): AttendanceReport {
  return {
    id: row.id,
    bookingId: row.booking_id,
    teacherId: row.teacher_id,
    studentId: row.student_id,
    type: row.type,
    lateMinutes: row.late_minutes,
    studentNote: row.student_note,
    status: row.status,
  };
}

// Returns the new report row on success, or false if it failed (already
// reported, not the student's own booking, etc).
export async function reportAttendanceIssue(params: {
  bookingId: string;
  teacherId: string;
  studentId: string;
  type: 'no_show' | 'late';
  lateMinutes?: number;
  note?: string;
}): Promise<AttendanceReport | false> {
  const row: Record<string, unknown> = {
    booking_id: params.bookingId,
    teacher_id: params.teacherId,
    student_id: params.studentId,
    type: params.type,
  };
  if (params.type === 'late' && params.lateMinutes) row.late_minutes = params.lateMinutes;
  if (params.note) row.student_note = params.note;

  const { data, error } = await supabase.from('attendance_reports').insert(row).select().single();
  if (error) return false;
  return mapRow(data);
}

// Whether this booking already has an attendance report - used to skip
// asking again if the student already reported from inside the room.
export async function getAttendanceReportForBooking(bookingId: string): Promise<AttendanceReport | null> {
  const { data, error } = await supabase.from('attendance_reports').select('*').eq('booking_id', bookingId).maybeSingle();
  if (error || !data) return null;
  return mapRow(data);
}
