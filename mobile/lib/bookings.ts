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
