/*
 * ARMUS - merges the fixed demo teachers (teachers-data.js) with real
 * registered teacher accounts (Supabase profiles) into one bookable
 * list, so a teacher who signs up, completes their application and gets
 * approved by ARMUS actually shows up in the marketplace instead of only
 * existing in isolation. Only status === "approved" teachers are
 * bookable - "pending" and "rejected" applicants stay hidden.
 *
 * Requires teachers-data.js (TEACHERS), supabase-config.js
 * (armusSupabase), bookings.js and reviews.js to be loaded first.
 */

async function armusTeacherFromProfile(profile) {

  const initials = profile.name
    .split(" ")
    .map(part => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const [rawReviews, bookings] = await Promise.all([
    armusGetReviewsForTeacher(profile.id),
    armusGetBookingsForTeacher(profile.id),
  ]);

  const reviews = rawReviews.map(r => ({
    name: armusFormatReviewerName(r.studentName),
    stars: r.stars,
    text: r.text,
  }));
  const rating = rawReviews.length
    ? Math.round((rawReviews.reduce((sum, r) => sum + r.stars, 0) / rawReviews.length) * 10) / 10
    : null;

  const completedCount = bookings.filter(armusIsBookingPast).length;

  return {
    id: profile.id,
    initials: initials || "?",
    photo: profile.photo_url || null,
    video: profile.video_url || null,
    name: profile.name,
    role: profile.title || "İngilizce Öğretmeni",
    price: profile.price ?? 500,
    rating,
    reviewCount: reviews.length,
    tags: [profile.subject_taught || "Genel İngilizce", "Yeni Öğretmen"],
    level: "",
    availability: profile.availability || "Şu anda ders almaya uygun",
    about: profile.bio
      ? [profile.bio]
      : ["Bu öğretmen henüz bir tanıtım yazısı eklemedi."],
    experience: "Yeni",
    completedLessons: String(completedCount),
    languages: profile.languages && profile.languages.length
      ? profile.languages.map(l => `${l.language} (${l.level})`).join(", ")
      : "English / Türkçe",
    levelRange: "A1 – C2",
    specialties: [profile.subject_taught || "Genel İngilizce"],
    reviews,
    weeklyAvailability: Array.isArray(profile.weekly_availability)
      ? profile.weekly_availability
      : null,
  };
}

// Demo teachers (teachers-data.js) have a fixed, hand-written reviews
// list for marketing purposes - it was never a real reflection of
// reviewCount/rating (those are decorative). Real students can still
// book and review them though, so real reviews get added on top of the
// hand-written ones rather than replacing them.
async function armusEnrichDemoTeacherReviews(teacher) {

  const rawReviews = await armusGetReviewsForTeacher(teacher.id);
  if (!rawReviews.length) return teacher;

  const liveReviews = rawReviews.map(r => ({
    name: armusFormatReviewerName(r.studentName),
    stars: r.stars,
    text: r.text,
  }));

  return { ...teacher, reviews: liveReviews.concat(teacher.reviews) };
}

async function armusGetMarketplaceTeachers() {

  const { data, error } = await armusSupabase
    .from("profiles")
    .select("*")
    .eq("role", "teacher")
    .eq("status", "approved");

  const registeredTeachers = (!error && data) ? await Promise.all(data.map(armusTeacherFromProfile)) : [];
  return TEACHERS.concat(registeredTeachers);
}

async function armusFindMarketplaceTeacher(id) {

  const demoTeacher = TEACHERS.find(t => t.id === id);
  if (demoTeacher) return armusEnrichDemoTeacherReviews(demoTeacher);

  const { data, error } = await armusSupabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .eq("status", "approved")
    .maybeSingle();

  if (error || !data) return null;
  return armusTeacherFromProfile(data);
}
