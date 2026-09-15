/*
 * ARMUS - teacher attendance reports (a student flags that a teacher
 * didn't show up, or started late, for one of their own bookings).
 * Requires supabase-config.js (Supabase SDK + armusSupabase client) to be
 * loaded first. See migration_41.sql for the full policy behind this:
 * a report immediately hides the teacher from new students until an
 * admin resolves it, and repeated admin-confirmed reports escalate to a
 * temporary or permanent hide.
 */

// type: "no_show" or "late". lateMinutes only matters for "late" (how
// many minutes past the scheduled start the teacher joined, optional).
// Returns the new report row on success, or false if it failed (already
// reported, not the student's own booking, etc).
async function armusReportAttendanceIssue({ bookingId, teacherId, studentId, type, lateMinutes, note }) {

  const row = {
    booking_id: bookingId,
    teacher_id: teacherId,
    student_id: studentId,
    type,
  };
  if (type === "late" && lateMinutes) row.late_minutes = lateMinutes;
  if (note) row.student_note = note;

  const { data, error } = await armusSupabase
    .from("attendance_reports")
    .insert(row)
    .select()
    .single();

  if (error) return false;
  return armusMapAttendanceReportRow(data);
}

// Whether this booking already has an attendance report - used to skip
// asking again (the post-class check-in) and to show the student their
// own report's status.
async function armusGetAttendanceReportForBooking(bookingId) {

  const { data, error } = await armusSupabase
    .from("attendance_reports")
    .select("*")
    .eq("booking_id", bookingId)
    .maybeSingle();

  if (error || !data) return null;
  return armusMapAttendanceReportRow(data);
}

// The teacher's own open (not yet reviewed) report, if any - dashboard.html
// shows the warning banner and explanation form from this. A teacher only
// ever has at most one truly "open" one at a time in practice (each new
// report is tied to a different booking), but this returns the most
// recent if somehow more than one is open.
async function armusGetOwnOpenAttendanceReport(teacherId) {

  const { data, error } = await armusSupabase
    .from("attendance_reports")
    .select("*")
    .eq("teacher_id", teacherId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return armusMapAttendanceReportRow(data);
}

// The teacher's own report that most needs their attention right now:
// any still-open one first (so it can actually be explained - a teacher
// can end up with more than one open report at once, from different
// bookings, before an admin gets to either of them, and without this
// preference dashboard.html would only ever surface whichever one
// happens to be more recent, silently stranding an older open report
// nobody could ever explain through the UI), otherwise the single most
// recent report regardless of status, so an "awaiting review"
// (explained) or a resolved one still has something to show.
async function armusGetLatestOwnAttendanceReport(teacherId) {

  const openReport = await armusGetOwnOpenAttendanceReport(teacherId);
  if (openReport) return openReport;

  const { data, error } = await armusSupabase
    .from("attendance_reports")
    .select("*")
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return armusMapAttendanceReportRow(data);
}

// The teacher submits their one explanation - only works while the
// report is still "open" (enforced server-side, see migration_41.sql).
// Returns the updated row, or false on failure.
async function armusSubmitAttendanceExplanation(reportId, explanation) {

  const { data, error } = await armusSupabase
    .from("attendance_reports")
    .update({ status: "explained", teacher_explanation: explanation })
    .eq("id", reportId)
    .select()
    .single();

  if (error) return false;
  return armusMapAttendanceReportRow(data);
}

// Admin-only: every attendance report. The
// attendance_reports_select_participant_or_admin RLS policy is what
// actually enforces this - a non-admin caller only gets their own.
async function armusAdminGetAllAttendanceReports() {

  const { data, error } = await armusSupabase
    .from("attendance_reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data.map(armusMapAttendanceReportRow);
}

// Admin-only: resolve a report. status is "upheld" or "dismissed" - the
// hide/unhide and the repeated-violation escalation (ban / temporary
// full hide) all happen server-side (see migration_41.sql), nothing
// further to do here once this succeeds.
async function armusAdminResolveAttendanceReport(reportId, status) {

  const { data, error } = await armusSupabase
    .from("attendance_reports")
    .update({ status })
    .eq("id", reportId)
    .select()
    .single();

  if (error) return false;
  return armusMapAttendanceReportRow(data);
}

function armusMapAttendanceReportRow(row) {
  return {
    id: row.id,
    bookingId: row.booking_id,
    teacherId: row.teacher_id,
    studentId: row.student_id,
    type: row.type,
    lateMinutes: row.late_minutes,
    studentNote: row.student_note,
    status: row.status,
    teacherExplanation: row.teacher_explanation,
    createdAt: row.created_at,
    explainedAt: row.explained_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}
