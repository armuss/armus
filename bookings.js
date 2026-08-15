/*
 * ARMUS - mock bookings (frontend prototype only)
 * Bookings are stored in localStorage alongside the mock accounts in
 * auth.js. Real teachers (registered via register.html) aren't wired
 * into the bookable marketplace yet - only the demo teachers from
 * teachers-data.js can actually be booked - so a self-registered
 * teacher's "incoming bookings" list will legitimately stay empty
 * until that gap is closed with a real backend.
 */

const ARMUS_BOOKINGS_KEY = "armus_bookings";

function armusGetBookings() {
  try {
    return JSON.parse(localStorage.getItem(ARMUS_BOOKINGS_KEY)) || [];
  } catch {
    return [];
  }
}

function armusSaveBookings(list) {
  localStorage.setItem(ARMUS_BOOKINGS_KEY, JSON.stringify(list));
}

function armusAddBooking(booking) {

  const list = armusGetBookings();

  const record = {
    id: "bk_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    ...booking,
  };

  list.push(record);
  armusSaveBookings(list);

  return record;
}

function armusGetBookingsForStudent(email) {
  return armusGetBookings()
    .filter(b => b.studentEmail === email)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

function armusGetBookingsForTeacherEmail(email) {
  return armusGetBookings()
    .filter(b => b.teacherEmail === email)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
