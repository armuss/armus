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

// The weekly timeline (a recurring day-of-week pattern) wins when the
// teacher has set anything at all; otherwise the older weekly_availability
// pattern; otherwise a deterministic mock for demo teachers with neither.
export function slotsForDate(
  teacher: { id: string; weeklyAvailability?: string[][] | null; availabilityDates?: Record<string, string[]> | null },
  dateKey: string,
  dayOfWeek: number
): Slot[] {
  const allSlots = allTimeSlots();

  if (teacher.availabilityDates && Object.keys(teacher.availabilityDates).length) {
    const daySlots = teacher.availabilityDates[String(dayOfWeek)] || [];
    return allSlots.map((time) => ({ time, available: daySlots.includes(time) }));
  }

  if (teacher.weeklyAvailability) {
    const daySlots = teacher.weeklyAvailability[dayOfWeek] || [];
    return allSlots.map((time) => ({ time, available: daySlots.includes(time) }));
  }

  return allSlots.map((time) => {
    const n = hashCode(teacher.id + dateKey + time);
    return { time, available: n % 3 !== 0 };
  });
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

const JOIN_EARLY_MINUTES = 15;
const JOIN_LATE_GRACE_MINUTES = 15;

export function lessonWindow(booking: Booking) {
  const start = new Date(`${booking.date}T${booking.time}:00`);
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
