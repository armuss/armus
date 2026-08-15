/*
 * ARMUS - merges the fixed demo teachers (teachers-data.js) with real
 * registered teacher accounts (auth.js) into one bookable list, so a
 * teacher who signs up, completes their application and gets approved
 * by ARMUS actually shows up in the marketplace instead of only
 * existing in isolation. Only status === "approved" teachers are
 * bookable - "pending" and "rejected" applicants stay hidden.
 *
 * Requires teachers-data.js (TEACHERS), auth.js (armusGetUsers),
 * bookings.js (armusGetBookingsForTeacherEmail) and reviews.js
 * (armusGetReviewsForTeacher) to be loaded first.
 */

function armusTeacherFromUser(user) {

  const initials = user.name
    .split(" ")
    .map(part => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const rawReviews = armusGetReviewsForTeacher(user.email);
  const reviews = rawReviews.map(r => ({
    name: armusFormatReviewerName(r.studentName),
    stars: r.stars,
    text: r.text,
  }));
  const rating = rawReviews.length
    ? Math.round((rawReviews.reduce((sum, r) => sum + r.stars, 0) / rawReviews.length) * 10) / 10
    : null;

  const completedCount = armusGetBookingsForTeacherEmail(user.email)
    .filter(armusIsBookingPast).length;

  return {
    id: user.email,
    initials: initials || "?",
    photo: user.photo ? user.photo.dataUrl : null,
    video: user.video ? user.video.dataUrl : null,
    name: user.name,
    role: user.title || "İngilizce Öğretmeni",
    price: user.price ?? 500,
    rating,
    reviewCount: reviews.length,
    tags: [user.subjectTaught || "Genel İngilizce", "Yeni Öğretmen"],
    level: "",
    availability: user.availability || "Şu anda ders almaya uygun",
    about: user.bio
      ? [user.bio]
      : ["Bu öğretmen henüz bir tanıtım yazısı eklemedi."],
    experience: "Yeni",
    completedLessons: String(completedCount),
    languages: user.languages && user.languages.length
      ? user.languages.map(l => `${l.language} (${l.level})`).join(", ")
      : "English / Türkçe",
    levelRange: "A1 – C2",
    specialties: [user.subjectTaught || "Genel İngilizce"],
    reviews,
    weeklyAvailability: Array.isArray(user.weeklyAvailability)
      ? user.weeklyAvailability
      : null,
  };
}

function armusGetMarketplaceTeachers() {

  const registeredTeachers = armusGetUsers()
    .filter(user => user.role === "teacher" && user.status === "approved")
    .map(armusTeacherFromUser);

  return TEACHERS.concat(registeredTeachers);
}

function armusFindMarketplaceTeacher(id) {
  return armusGetMarketplaceTeachers().find(t => t.id === id) || null;
}
