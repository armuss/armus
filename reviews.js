/*
 * ARMUS - reviews backed by Supabase.
 * A student can review a teacher once their booking's date has passed.
 * Self-contained - no other ARMUS script needs to load before this one,
 * other than supabase-config.js for the armusSupabase client.
 */

// Returns the new review record on success, or false if saving failed.
async function armusAddReview(review) {

  const { data, error } = await armusSupabase
    .from("reviews")
    .insert({
      booking_id: review.bookingId,
      teacher_id: review.teacherId,
      student_id: review.studentId,
      student_name: review.studentName,
      stars: review.stars,
      comment: review.text || null,
    })
    .select()
    .single();

  if (error) return false;
  return armusMapReviewRow(data);
}

async function armusGetReviewsForTeacher(teacherId) {

  const { data, error } = await armusSupabase
    .from("reviews")
    .select("*")
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false });

  if (error) return [];
  return data.map(armusMapReviewRow);
}

async function armusGetReviewForBooking(bookingId) {

  const { data, error } = await armusSupabase
    .from("reviews")
    .select("*")
    .eq("booking_id", bookingId)
    .maybeSingle();

  if (error || !data) return null;
  return armusMapReviewRow(data);
}

function armusMapReviewRow(row) {
  return {
    id: row.id,
    bookingId: row.booking_id,
    teacherId: row.teacher_id,
    studentId: row.student_id,
    studentName: row.student_name,
    stars: row.stars,
    text: row.comment || "",
    createdAt: row.created_at,
  };
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
