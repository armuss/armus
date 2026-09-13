/*
 * ARMUS - bookings backed by Supabase.
 * Both demo teachers (teachers-data.js, no real account) and approved
 * self-registered teachers (see marketplace.js) can be booked - demo
 * teacher ids are plain strings, real teacher ids are profile UUIDs,
 * so teacher_id is stored as plain text rather than a strict FK.
 */

async function armusGetBookingsForStudent(studentId) {

  const { data, error } = await armusSupabase
    .from("bookings")
    .select("*")
    .eq("student_id", studentId)
    .order("lesson_date", { ascending: true })
    .order("lesson_time", { ascending: true });

  if (error) return [];
  return data.map(armusMapBookingRow);
}

async function armusGetBookingsForTeacher(teacherId) {

  const { data, error } = await armusSupabase
    .from("bookings")
    .select("*")
    .eq("teacher_id", teacherId)
    .order("lesson_date", { ascending: true })
    .order("lesson_time", { ascending: true });

  if (error) return [];
  return data.map(armusMapBookingRow);
}

// Every non-cancelled booking's date+time for a teacher, with no student
// identity attached - bookings_select_participant (schema.sql) only lets
// a signed-in student see their *own* bookings, so a prospective student
// browsing a teacher's calendar can never see that someone else already
// took a slot via a plain client query. Goes through the
// get-teacher-busy-times Edge Function (service role) instead, which
// deliberately returns only { date, time } pairs - used by
// armusSlotsForDate to grey out already-taken slots.
async function armusGetTeacherBusyTimes(teacherId) {

  const { data, error } = await armusSupabase.functions.invoke("get-teacher-busy-times", {
    body: { teacherId },
  });

  if (error || !data || !data.busy) return [];
  return data.busy;
}

// A single booking by id - RLS (bookings_select_participant) already
// makes sure only the student, the teacher, or an admin can ever get a
// row back, so a non-participant querying someone else's booking id
// just gets null, same as a booking that doesn't exist.
async function armusGetBookingById(bookingId) {

  const { data, error } = await armusSupabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle();

  if (error || !data) return null;
  return armusMapBookingRow(data);
}

const ARMUS_DAY_NAMES = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const ARMUS_MONTH_NAMES = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"
];

// "2026-08-10" -> "10 Ağustos, Pzt"
function armusFormatDateLabel(dateKey) {
  const date = new Date(dateKey + "T00:00:00");
  return `${date.getDate()} ${ARMUS_MONTH_NAMES[date.getMonth()]}, ${ARMUS_DAY_NAMES[date.getDay()]}`;
}

// booking rows come back with snake_case columns; expose the same
// camelCase shape the rest of the app already expects.
function armusMapBookingRow(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
    type: row.type,
    date: row.lesson_date,
    dateLabel: armusFormatDateLabel(row.lesson_date),
    time: row.lesson_time,
    price: row.price,
    status: row.status || "confirmed",
    cancelledBy: row.cancelled_by,
    refunded: row.refunded,
    createdAt: row.created_at,
  };
}

// A trial only counts as real earnings for the teacher once the student
// has "converted" - either a real (non-trial) lesson booking with this
// same teacher, or a package purchase with them (a lesson_credits row -
// migration_28.sql - with no source_booking_id, meaning it came from
// buying a package - migration_29.sql - rather than a cancellation
// refund, which always sets source_booking_id). Until then the trial fee
// stays with ARMUS (see PROJECT_SUMMARY.md's trial-lesson design) - this
// only affects how much of the booking's price counts as the teacher's
// earnings, never the booking itself.
//
// allBookings: every booking for this teacher (mapped rows, camelCase).
// credits: this teacher's own lesson_credits rows (raw, snake_case) -
// requires the lesson_credits_select_teacher policy (migration_30.sql).
function armusTrialCountsAsEarned(booking, allBookings, credits) {

  if (booking.type !== "trial") return true;

  const hasRealLesson = (allBookings || []).some(b =>
    b.id !== booking.id &&
    b.studentId === booking.studentId &&
    b.teacherId === booking.teacherId &&
    b.type === "lesson" &&
    b.status !== "cancelled"
  );
  if (hasRealLesson) return true;

  return (credits || []).some(c =>
    c.student_id === booking.studentId &&
    c.teacher_id === booking.teacherId &&
    !c.source_booking_id
  );
}

// Cancels a booking via the cancel-booking Edge Function (which also
// issues an iyzico refund when the canceller is eligible for one - see
// that function's file header for the exact policy). Returns
// { ok: true, refunded, refundEligible } on success, or
// { ok: false, error } on failure.
async function armusCancelBooking(bookingId) {

  const { data, error } = await armusSupabase.functions.invoke("cancel-booking", {
    body: { booking_id: bookingId },
  });

  if (error || !data || !data.ok) {
    return { ok: false, error: (data && data.error) || "Rezervasyon iptal edilemedi." };
  }

  return { ok: true, refunded: data.refunded, refundEligible: data.refundEligible };
}

const ARMUS_LESSON_MINUTES = 50;

// "10:00" -> "10:00 – 10:50"
function armusFormatTimeRange(startTime, durationMinutes = ARMUS_LESSON_MINUTES) {

  const [hours, minutes] = startTime.split(":").map(Number);
  const totalMinutes = hours * 60 + minutes + durationMinutes;

  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMinutes = totalMinutes % 60;

  const endTime =
    String(endHours).padStart(2, "0") + ":" + String(endMinutes).padStart(2, "0");

  return `${startTime} – ${endTime}`;
}

// A stable, hard-to-guess Jitsi Meet room name derived from the booking
// id - both participants compute the same name independently from the
// booking they can already (per RLS) see, no extra column needed.
function armusRoomNameForBooking(bookingId) {
  return "armus-lesson-" + String(bookingId).replace(/-/g, "");
}

// The lesson's start/end as real Date objects, and the ARMUS_JOIN_WINDOW
// join window around it - shared by class.html (does it show the call or
// a "too early/too late" screen) and my-lessons.html/dashboard.html (does
// the "Derse Katıl" button link out or show as disabled).
const ARMUS_JOIN_EARLY_MINUTES = 15;
const ARMUS_JOIN_LATE_GRACE_MINUTES = 15;

function armusLessonWindow(booking) {
  const start = new Date(`${booking.date}T${booking.time}:00`);
  const end = new Date(start.getTime() + ARMUS_LESSON_MINUTES * 60000);
  const joinsFrom = new Date(start.getTime() - ARMUS_JOIN_EARLY_MINUTES * 60000);
  const joinsUntil = new Date(end.getTime() + ARMUS_JOIN_LATE_GRACE_MINUTES * 60000);
  return { start, end, joinsFrom, joinsUntil };
}

function armusCanJoinLessonNow(booking) {
  const { joinsFrom, joinsUntil } = armusLessonWindow(booking);
  const now = new Date();
  return now >= joinsFrom && now <= joinsUntil;
}

// Every half-hour lesson start time in a day: "00:00", "00:30", ... "23:30".
// Shared by the availability grids (apply-teacher.html, dashboard.html)
// and the booking slot picker (booking.html) so they always agree on
// which start times exist.
function armusAllTimeSlots() {
  const slots = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return slots;
}

function armusHashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Every half-hour slot for one calendar date, each marked available or
// not for this teacher - shared by booking.html's picker and the
// calendar preview on teacher.html so they never disagree about which
// times are actually open.
//
// dayOfWeek: 0 (Sunday) - 6 (Saturday), i.e. Date.prototype.getDay().
// busyTimes: { date, time }[] - this teacher's already-taken slots (see
// armusGetTeacherBusyTimes) - a time already booked by anyone is never
// offered again, regardless of what the teacher's own weekly/per-date
// availability says about it. A plain armusMapBookingRow[] also works
// here (it carries the same date/time fields, plus a status this
// function skips cancelled rows on if present).
function armusSlotsForDate(teacher, dateKey, dayOfWeek, busyTimes) {

  const ALL_SLOTS = armusAllTimeSlots();

  const takenTimes = new Set(
    (busyTimes || [])
      .filter(b => b.date === dateKey && b.status !== "cancelled")
      .map(b => b.time)
  );

  // the dashboard.html weekly timeline (a recurring day-of-week pattern,
  // not tied to a specific date) wins when the teacher has set anything
  // at all; otherwise fall back to their older weekly_availability
  // pattern (set once during the apply-teacher.html signup wizard), and
  // finally to a deterministic mock for demo teachers with neither.
  if (teacher.availabilityDates && Object.keys(teacher.availabilityDates).length) {
    const daySlots = teacher.availabilityDates[String(dayOfWeek)] || [];
    return ALL_SLOTS.map(time => ({ time, available: daySlots.includes(time) && !takenTimes.has(time) }));
  }

  if (teacher.weeklyAvailability) {
    const daySlots = teacher.weeklyAvailability[dayOfWeek] || [];
    return ALL_SLOTS.map(time => ({ time, available: daySlots.includes(time) && !takenTimes.has(time) }));
  }

  return ALL_SLOTS.map(time => {
    const n = armusHashCode(teacher.id + dateKey + time);
    return { time, available: n % 3 !== 0 && !takenTimes.has(time) };
  });
}
