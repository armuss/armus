/*
 * ARMUS - mock bookings (frontend prototype only)
 * Bookings are stored in localStorage alongside the mock accounts in
 * auth.js. Both demo teachers (teachers-data.js) and approved
 * self-registered teachers (see marketplace.js) can be booked.
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
  try {
    localStorage.setItem(ARMUS_BOOKINGS_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

// Returns the new booking record on success, or false if saving failed.
function armusAddBooking(booking) {

  const list = armusGetBookings();

  const record = {
    id: "bk_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    ...booking,
  };

  list.push(record);

  if (!armusSaveBookings(list)) {
    return false;
  }

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
