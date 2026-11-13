import { supabase } from './supabase';

// Mirrors attendance.js (the website): a student's attendance report on
// one of their own lessons, the teacher's one explanation, the teacher's
// self-service "make visible" after a trial no-show, and a student's
// complaint about a teacher to the admin. See migration_41.sql /
// migration_112.sql for the policy behind it (the database is the real
// gate; these numbers only drive the screens).

// A report can be filed until 24 hours after the lesson; up to 15 minutes
// late is a warning, more and the student picks between "held with the
// time left" and "count it as not held"; a technical problem on the
// teacher's side with under 25 minutes held gives the lesson back.
export const REPORT_WINDOW_HOURS = 24;
export const LATE_WARNING_MINUTES = 15;
export const TECH_REFUND_MINUTES = 25;

// how long after the lesson's real start a "the teacher never showed up"
// report can be filed (class.html's ARMUS_NO_SHOW_GRACE_MINUTES)
export const NO_SHOW_GRACE_MINUTES = 10;

export type AttendanceType = 'no_show' | 'late' | 'technical';

export type AttendanceReport = {
  id: string;
  bookingId: string;
  teacherId: string;
  studentId: string;
  type: AttendanceType;
  lateMinutes: number | null;
  techSide: 'teacher' | 'student' | null;
  minutesHeld: number | null;
  studentNote: string | null;
  status: 'open' | 'explained' | 'upheld' | 'dismissed' | string;
  teacherExplanation: string | null;
  createdAt: string;
};

function mapRow(row: any): AttendanceReport {
  return {
    id: row.id,
    bookingId: row.booking_id,
    teacherId: row.teacher_id,
    studentId: row.student_id,
    type: row.type,
    lateMinutes: row.late_minutes ?? null,
    techSide: row.tech_side || null,
    minutesHeld: row.minutes_held ?? null,
    studentNote: row.student_note ?? null,
    status: row.status,
    teacherExplanation: row.teacher_explanation ?? null,
    createdAt: row.created_at,
  };
}

// Returns the new report row on success, or false if it failed (already
// reported, not the student's own booking, too late, etc).
export async function reportAttendanceIssue(params: {
  bookingId: string;
  teacherId: string;
  studentId: string;
  type: AttendanceType;
  lateMinutes?: number;
  note?: string;
  techSide?: 'teacher' | 'student';
  minutesHeld?: number;
}): Promise<AttendanceReport | false> {
  const row: Record<string, unknown> = {
    booking_id: params.bookingId,
    teacher_id: params.teacherId,
    student_id: params.studentId,
    type: params.type,
  };
  if ((params.type === 'late' || params.type === 'no_show') && params.lateMinutes) row.late_minutes = params.lateMinutes;
  if (params.type === 'technical') {
    row.tech_side = params.techSide;
    if (Number.isFinite(params.minutesHeld)) row.minutes_held = params.minutesHeld;
  }
  if (params.note) row.student_note = params.note;

  const { data, error } = await supabase.from('attendance_reports').insert(row).select().single();
  if (error) return false;
  return mapRow(data);
}

// Whether this booking already has an attendance report.
export async function getAttendanceReportForBooking(bookingId: string): Promise<AttendanceReport | null> {
  const { data, error } = await supabase.from('attendance_reports').select('*').eq('booking_id', bookingId).maybeSingle();
  if (error || !data) return null;
  return mapRow(data);
}

// A student's reports for many lessons at once (Derslerim), keyed by booking.
export async function getAttendanceReportsForBookings(bookingIds: string[]): Promise<Record<string, AttendanceReport>> {
  const ids = bookingIds.filter(Boolean);
  if (!ids.length) return {};
  const { data, error } = await supabase.from('attendance_reports').select('*').in('booking_id', ids);
  if (error || !data) return {};
  const out: Record<string, AttendanceReport> = {};
  data.forEach((row) => {
    out[row.booking_id] = mapRow(row);
  });
  return out;
}

// The teacher's own report that most needs their attention: an open one
// first (so it can be explained), otherwise the most recent of any status.
export async function getLatestOwnAttendanceReport(teacherId: string): Promise<AttendanceReport | null> {
  const open = await supabase
    .from('attendance_reports')
    .select('*')
    .eq('teacher_id', teacherId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!open.error && open.data) return mapRow(open.data);

  const { data, error } = await supabase
    .from('attendance_reports')
    .select('*')
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return mapRow(data);
}

// The teacher's one explanation - only while the report is still open.
export async function submitAttendanceExplanation(reportId: string, explanation: string): Promise<AttendanceReport | false> {
  const { data, error } = await supabase
    .from('attendance_reports')
    .update({ status: 'explained', teacher_explanation: explanation })
    .eq('id', reportId)
    .select()
    .single();
  if (error) return false;
  return mapRow(data);
}

// The trial-no-show ladder's "make visible" (migration_100.sql):
// "ok" | "not_eligible" | "ack_required" | "no_action".
export async function selfUnhideFromNewStudents(ack: boolean): Promise<string> {
  const { data, error } = await supabase.rpc('self_unhide_from_new_students', { p_ack: !!ack });
  if (error) return 'no_action';
  return data as string;
}

// What the teacher reads next to a report (dashboard.html's ATTENDANCE_RULES_TEXT)
export const ATTENDANCE_RULES_TEXT =
  "ARMUS kuralları: bir öğrenci dersine gelmediğini bildirdiğinde, incelenene kadar profilin yeni öğrencilerin aramasından gizlenir. Ekibimiz ders kayıtlarına (kimin derse ne zaman girdiğine) bakarak değerlendirir. Gelmediğin doğrulanan bir dersin ücreti sana ödenmez, ders öğrenciye iade edilir; derse hiç girmediysen öğrenci de girmemiş olsa bile ders gelmedi sayılır. 15 dakikaya kadar geç kalmak uyarıdır; daha fazla geç kalırsan öğrenci dersi yapılmamış saydırabilir. Senin tarafındaki teknik bir sorun yüzünden ders 25 dakikadan az yapılabildiyse ders öğrenciye iade edilir (ceza değildir). Tekrarlanan, doğrulanmış ihlaller daha ağır sonuçlar doğurur - 30 günde 3 gelmeme profilinin 14 gün herkesten gizlenmesine ve hesabının incelenmesine, toplamda 10 gelmeme profilinin tamamen kapatılmasına, bir ayda derslerinin %5'inden fazlasında geç kalman ise profilinin bir ay boyunca herkesten gizlenmesine yol açar.";

// ---- a student reports a teacher to the admin (teacher_reports) ----

export const TEACHER_REPORT_REASONS: { value: string; label: string }[] = [
  { value: 'harassment', label: 'Taciz ya da hakaret' },
  { value: 'inappropriate', label: 'Uygunsuz davranış ya da içerik' },
  { value: 'payment_bypass', label: 'Site dışında ödeme ya da iletişim istedi' },
  { value: 'scam', label: 'Dolandırıcılık şüphesi' },
  { value: 'unprofessional', label: 'Profesyonel olmayan davranış' },
  { value: 'other', label: 'Diğer' },
];

// true, "duplicate" (an open report on this teacher already), or false
export async function reportTeacher(params: {
  teacherId: string;
  reporterId: string;
  bookingId?: string;
  reason: string;
  note?: string;
}): Promise<true | 'duplicate' | false> {
  const row: Record<string, unknown> = { teacher_id: params.teacherId, reporter_id: params.reporterId, reason: params.reason };
  if (params.bookingId) row.booking_id = params.bookingId;
  if (params.note) row.note = params.note.slice(0, 2000);
  const { error } = await supabase.from('teacher_reports').insert(row);
  if (error) return error.code === '23505' ? 'duplicate' : false;
  return true;
}
