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

const DAY_NAMES = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const MONTH_NAMES = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

function formatDateLabel(dateKey: string) {
  const date = new Date(dateKey + 'T00:00:00');
  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]}, ${DAY_NAMES[date.getDay()]}`;
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
