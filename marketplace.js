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

// Turns an already-fetched profile row plus its already-fetched
// reviews/bookings into the marketplace teacher shape. Kept separate
// from the fetching so callers can fetch a profile's reviews/bookings
// however suits them best (in parallel with the profile itself, or
// pulled out of an already-fetched full table) instead of always
// re-querying per teacher.
function armusBuildTeacherFromParts(profile, rawReviews, bookings) {

  const initials = profile.name
    .split(" ")
    .map(part => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const reviews = rawReviews.map(r => ({
    name: armusFormatReviewerName(r.studentName),
    stars: r.stars,
    text: r.text,
  }));
  const rating = rawReviews.length
    ? Math.round((rawReviews.reduce((sum, r) => sum + r.stars, 0) / rawReviews.length) * 10) / 10
    : null;

  const completedCount = bookings.filter(armusIsBookingPast).length;
  const studentCount = new Set(bookings.map(b => b.studentId)).size;

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
    students: studentCount,
    languages: profile.languages && profile.languages.length
      ? profile.languages.map(l => `${l.language} (${l.level})`).join(", ")
      : "English / Türkçe",
    levelRange: "A1 – C2",
    specialties: [profile.subject_taught || "Genel İngilizce"],
    reviews,
    weeklyAvailability: Array.isArray(profile.weekly_availability)
      ? profile.weekly_availability
      : null,
    isOnline: Boolean(profile.is_online),
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

// Only the real, self-registered teachers (a Supabase round trip). Kept
// separate from armusGetMarketplaceTeachers so a page can render the
// zero-network demo teachers immediately and merge these in once they
// arrive, instead of making the whole list wait on the network.
//
// Fetches every teacher's profile alongside the *entire* reviews and
// bookings tables in one parallel round trip, then groups them
// client-side per teacher - fetching each teacher's reviews/bookings
// individually (once their ids are known from the profiles query)
// would mean waiting for the profiles query to finish before even
// starting the reviews/bookings ones, doubling the wait.
async function armusGetRegisteredTeachers() {

  const [profilesRes, reviewsRes, bookingsRes] = await Promise.all([
    armusSupabase
      .from("profiles")
      .select("*")
      .eq("role", "teacher")
      .eq("status", "approved"),
    armusSupabase.from("reviews").select("*"),
    armusSupabase.from("bookings").select("*"),
  ]);

  if (profilesRes.error || !profilesRes.data) return [];

  const allReviews = (reviewsRes.data || []).map(armusMapReviewRow);
  const allBookings = (bookingsRes.data || []).map(armusMapBookingRow);

  return profilesRes.data.map(profile => armusBuildTeacherFromParts(
    profile,
    allReviews.filter(r => r.teacherId === profile.id),
    allBookings.filter(b => b.teacherId === profile.id)
  ));
}

async function armusGetMarketplaceTeachers() {
  return TEACHERS.concat(await armusGetRegisteredTeachers());
}

async function armusFindMarketplaceTeacher(id) {

  const demoTeacher = TEACHERS.find(t => t.id === id);
  if (demoTeacher) return armusEnrichDemoTeacherReviews(demoTeacher);

  // profile, reviews and bookings only depend on id, not on each other,
  // so fetch all three at once instead of waiting for the profile before
  // starting the other two - cuts a full round trip off the teacher
  // profile page's load time
  const [profileRes, rawReviews, bookings] = await Promise.all([
    armusSupabase
      .from("profiles")
      .select("*")
      .eq("id", id)
      .eq("status", "approved")
      .maybeSingle(),
    armusGetReviewsForTeacher(id),
    armusGetBookingsForTeacher(id),
  ]);

  if (profileRes.error || !profileRes.data) return null;
  return armusBuildTeacherFromParts(profileRes.data, rawReviews, bookings);
}
