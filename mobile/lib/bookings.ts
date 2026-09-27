import { supabase } from './supabase';

export type Booking = {
  id: string;
  studentId: string;
  studentName: string;
  teacherId: string;
  teacherName: string;
  type: string;
  date: string;
  dateLabel: string;
  time: string;
  teacherTimezone: string;
  price: number;
  status: string;
};

export const DAY_NAMES = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
export const MONTH_NAMES = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

export function formatDateLabel(dateKey: string) {
  const date = new Date(dateKey + 'T00:00:00');
  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]}, ${DAY_NAMES[date.getDay()]}`;
}

const LESSON_MINUTES = 50;

// "10:00" -> "10:00 – 10:50"
export function formatTimeRange(startTime: string, durationMinutes = LESSON_MINUTES) {
  const [hours, minutes] = startTime.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes + durationMinutes;

  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMinutes = totalMinutes % 60;

  const endTime = String(endHours).padStart(2, '0') + ':' + String(endMinutes).padStart(2, '0');
  return `${startTime} – ${endTime}`;
}

// Every half-hour lesson start time in a day: "00:00", "00:30", ... "23:30".
export function allTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return slots;
}

function hashCode(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export type Slot = { time: string; available: boolean };
export type BusyTime = { date: string; time: string };

// The web app used to key this same precedence check off
// Object.keys(availabilityDates).length - which can't tell "teacher never
// touched the date-specific editor" apart from "teacher intentionally
// cleared every slot and saved" (availability_dates defaults to '{}' for
// every profile). Fixed there to check the explicit `_set` sentinel the
// save handler now always writes instead (see bookings.js); this mirrors
// that fix so mobile reads the exact same convention rather than relying
// on the incidental fact that a saved-but-empty calendar still carries at
// least the `_set` key itself.
type AvailabilityDates = Record<string, string[] | boolean>;

// The weekly timeline (a recurring day-of-week pattern) wins when the
// teacher has saved through the date-specific editor at least once;
// otherwise the older weekly_availability pattern; otherwise a
// deterministic mock for demo teachers with neither. busyTimes (see
// getTeacherBusyTimes) - a time already booked by anyone is never offered
// again regardless of what the teacher's own availability says, mirroring
// armusSlotsForDate (bookings.js) exactly so the mobile picker can't offer
// a slot the web picker already knows is taken.
export function slotsForDate(
  teacher: { id: string; weeklyAvailability?: string[][] | null; availabilityDates?: AvailabilityDates | null },
  dateKey: string,
  dayOfWeek: number,
  busyTimes?: BusyTime[]
): Slot[] {
  const allSlots = allTimeSlots();
  const takenTimes = new Set((busyTimes || []).filter((b) => b.date === dateKey).map((b) => b.time));

  if (teacher.availabilityDates && teacher.availabilityDates._set === true) {
    const daySlots = (teacher.availabilityDates[String(dayOfWeek)] as string[] | undefined) || [];
    return allSlots.map((time) => ({ time, available: daySlots.includes(time) && !takenTimes.has(time) }));
  }

  if (teacher.weeklyAvailability) {
    const daySlots = teacher.weeklyAvailability[dayOfWeek] || [];
    return allSlots.map((time) => ({ time, available: daySlots.includes(time) && !takenTimes.has(time) }));
  }

  return allSlots.map((time) => {
    const n = hashCode(teacher.id + dateKey + time);
    return { time, available: n % 3 !== 0 && !takenTimes.has(time) };
  });
}

// Every non-cancelled booking's date+time for a teacher, with no student
// identity attached (see get-teacher-busy-times's own header comment for
// why this has to go through a service-role Edge Function rather than a
// plain client query). Mirrors armusGetTeacherBusyTimes (bookings.js).
export async function getTeacherBusyTimes(teacherId: string): Promise<BusyTime[]> {
  const { data, error } = await supabase.functions.invoke('get-teacher-busy-times', { body: { teacherId } });
  if (error || !data || !data.busy) return [];
  return data.busy;
}

function mapBookingRow(row: any): Booking {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
    type: row.type,
    date: row.lesson_date,
    dateLabel: formatDateLabel(row.lesson_date),
    time: row.lesson_time,
    teacherTimezone: row.teacher_timezone || 'Europe/Istanbul',
    price: row.price,
    status: row.status || 'confirmed',
  };
}

export async function getBookingsForStudent(studentId: string): Promise<Booking[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('student_id', studentId)
    .order('lesson_date', { ascending: true })
    .order('lesson_time', { ascending: true });

  if (error || !data) return [];
  return data.map(mapBookingRow);
}

export async function getBookingsForTeacher(teacherId: string): Promise<Booking[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('teacher_id', teacherId)
    .order('lesson_date', { ascending: true })
    .order('lesson_time', { ascending: true });

  if (error || !data) return [];
  return data.map(mapBookingRow);
}

// A single booking by id - RLS already restricts this to the student, the
// teacher, or an admin, so a non-participant just gets null back, same as
// a booking that doesn't exist at all.
export async function getBookingById(bookingId: string): Promise<Booking | null> {
  const { data, error } = await supabase.from('bookings').select('*').eq('id', bookingId).maybeSingle();

  if (error || !data) return null;
  return mapBookingRow(data);
}

// A stable, hard-to-guess Jitsi Meet room name derived from the booking id
// - both participants compute the same name independently.
export function roomNameForBooking(bookingId: string) {
  return 'armus-lesson-' + String(bookingId).replace(/-/g, '');
}

// lesson_date/lesson_time are plain wall-clock strings with no zone of
// their own - they mean whatever the TEACHER's calendar grid meant when
// they set their availability, in the teacher's own local time
// (booking.teacherTimezone, migration_37.sql). This turns them into the
// real UTC instant, correctly handling DST for any zone - mirrors the
// web app's armusZonedTimeToUtc (bookings.js) exactly: format a UTC
// guess back in the target zone, see how far off the wall-clock reading
// is, and shift by that difference. Without this, a device whose OS
// timezone isn't Europe/Istanbul (a user currently abroad, or simply a
// phone set to UTC) computed the join window against the wrong instant,
// off by exactly the timezone difference - shown "too early" for a
// lesson already in progress, or let into/locked out of the room hours
// off from the real scheduled time.
function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const guess = new Date(`${dateStr}T${timeStr}:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'Europe/Istanbul',
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(guess).map((p) => [p.type, p.value])
  );
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    hour, Number(parts.minute), Number(parts.second)
  );
  return new Date(guess.getTime() + (guess.getTime() - asIfUtc));
}

const JOIN_EARLY_MINUTES = 15;
const JOIN_LATE_GRACE_MINUTES = 15;

export function lessonWindow(booking: Booking) {
  const start = zonedTimeToUtc(booking.date, booking.time, booking.teacherTimezone);
  const end = new Date(start.getTime() + LESSON_MINUTES * 60000);
  const joinsFrom = new Date(start.getTime() - JOIN_EARLY_MINUTES * 60000);
  const joinsUntil = new Date(end.getTime() + JOIN_LATE_GRACE_MINUTES * 60000);
  return { start, end, joinsFrom, joinsUntil };
}

export function canJoinLessonNow(booking: Booking) {
  const { joinsFrom, joinsUntil } = lessonWindow(booking);
  const now = new Date();
  return now >= joinsFrom && now <= joinsUntil;
}
