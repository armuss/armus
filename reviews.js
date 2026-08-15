/*
 * ARMUS - mock reviews (frontend prototype only)
 * A student can review a teacher once their booking's date has passed.
 * Stored in localStorage alongside accounts/bookings. Self-contained -
 * no other ARMUS script needs to load before this one.
 */

const ARMUS_REVIEWS_KEY = "armus_reviews";

function armusGetReviews() {
  try {
    return JSON.parse(localStorage.getItem(ARMUS_REVIEWS_KEY)) || [];
  } catch {
    return [];
  }
}

function armusSaveReviews(list) {
  try {
    localStorage.setItem(ARMUS_REVIEWS_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

// Returns the new review record on success, or false if saving failed.
function armusAddReview(review) {

  const list = armusGetReviews();

  const record = {
    id: "rv_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    ...review,
  };

  list.push(record);

  if (!armusSaveReviews(list)) {
    return false;
  }

  return record;
}

function armusGetReviewsForTeacher(teacherId) {
  return armusGetReviews()
    .filter(r => r.teacherId === teacherId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function armusHasReviewed(bookingId) {
  return armusGetReviews().some(r => r.bookingId === bookingId);
}

// "Mehmet Kaya" -> "Mehmet K."
function armusFormatReviewerName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || "Öğrenci";
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// A booking counts once its scheduled date has passed - there's no
// live classroom yet to confirm attendance, so "the date passed" is
// the closest thing to "completed" this prototype can offer.
function armusIsBookingPast(booking) {
  const todayKey = new Date().toISOString().slice(0, 10);
  return booking.date < todayKey;
}
