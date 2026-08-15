/*
 * ARMUS - bookings backed by Supabase.
 * Both demo teachers (teachers-data.js, no real account) and approved
 * self-registered teachers (see marketplace.js) can be booked - demo
 * teacher ids are plain strings, real teacher ids are profile UUIDs,
 * so teacher_id is stored as plain text rather than a strict FK.
 */

// Returns the new booking record on success, or false if saving failed.
async function armusAddBooking(booking) {

  const { data, error } = await armusSupabase
    .from("bookings")
    .insert({
      student_id: booking.studentId,
      student_name: booking.studentName,
      teacher_id: booking.teacherId,
      teacher_name: booking.teacherName,
      type: booking.type,
      lesson_date: booking.date,
      lesson_time: booking.time,
      price: booking.price,
    })
    .select()
    .single();

  if (error) return false;
  return armusMapBookingRow(data);
}

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
    createdAt: row.created_at,
  };
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
