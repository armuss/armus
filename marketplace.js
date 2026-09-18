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
function armusBuildTeacherFromParts(profile, rawReviews, stats) {

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
    date: r.createdAt,
  }));
  const rating = rawReviews.length
    ? Math.round((rawReviews.reduce((sum, r) => sum + r.stars, 0) / rawReviews.length) * 10) / 10
    : null;

  const completedCount = stats ? stats.completed_count : 0;
  const studentCount = stats ? stats.student_count : 0;

  return {
    id: profile.id,
    initials: initials || "?",
    photo: profile.photo_url || null,
    video: profile.video_url || null,
    name: profile.name,
    role: profile.title || armusT("marketplace.englishTeacher", "İngilizce Öğretmeni"),
    price: profile.price ?? 500,
    rating,
    reviewCount: reviews.length,
    tags: [
      profile.subject_taught || armusT("marketplace.generalEnglish", "Genel İngilizce"),
      armusT("marketplace.newTeacherTag", "Yeni Öğretmen"),
    ],
    level: "",
    availability: profile.availability || "Şu anda ders almaya uygun",
    about: profile.bio
      ? [profile.bio]
      : [armusT("marketplace.noBioYet", "Bu öğretmen henüz bir tanıtım yazısı eklemedi.")],
    experience: armusT("marketplace.newExperience", "Yeni"),
    completedLessons: String(completedCount),
    students: studentCount,
    languages: profile.languages && profile.languages.length
      ? profile.languages.map(l => `${l.language} (${l.level})`).join(", ")
      : "English / Türkçe",
    levelRange: "A1 – C2",
    specialties: [profile.subject_taught || armusT("marketplace.generalEnglish", "Genel İngilizce")],
    reviews,
    weeklyAvailability: Array.isArray(profile.weekly_availability)
      ? profile.weekly_availability
      : null,
    availabilityDates: profile.availability_dates && typeof profile.availability_dates === "object"
      ? profile.availability_dates
      : {},
    isOnline: Boolean(profile.is_online),
    // migration_37.sql - which IANA zone this teacher's own calendar grid
    // (weeklyAvailability/availabilityDates) is wall-clock time in.
    timezone: profile.timezone || "Europe/Istanbul",
    // migration_41.sql - attendance-report hide/ban state, see
    // armusFilterVisibleTeachers below.
    isBanned: Boolean(profile.is_banned),
    hiddenFromNewStudents: Boolean(profile.hidden_from_new_students),
    hiddenUntil: profile.hidden_until || null,
  };
}

// Whether teacherOrProfile is hidden from EVERYONE right now, with no
// exception - either permanently (banned) or temporarily (the harsher,
// repeated-violation tier - migration_41.sql). Accepts either a built
// marketplace teacher object (camelCase) or a raw profiles row
// (snake_case), since callers reach for this at different points.
function armusIsTeacherHiddenFromEveryone(t) {
  if (t.isBanned || t.is_banned) return true;
  const hiddenUntil = t.hiddenUntil || t.hidden_until;
  return Boolean(hiddenUntil && new Date(hiddenUntil).getTime() > Date.now());
}

// Filters `teachers` down to what `viewerId` (a signed-in student's id,
// or null/undefined for an anonymous visitor, a teacher, or anyone else
// with no booking history to check) is allowed to see right now. A
// no-show/late report immediately hides a teacher from anyone who
// hasn't booked them before - existing students keep seeing them - a
// banned or repeatedly-confirmed-violation teacher is hidden from
// EVERYONE, no exception. Demo teachers (teachers-data.js) are never
// hidden - they have no profile row for any of this to apply to.
async function armusFilterVisibleTeachers(teachers, viewerId) {

  const hiddenFromNewOnly = teachers.filter(t =>
    !armusIsTeacherHiddenFromEveryone(t) && t.hiddenFromNewStudents
  );

  let bookedTeacherIds = new Set();
  if (viewerId && hiddenFromNewOnly.length) {
    const { data } = await armusSupabase
      .from("bookings")
      .select("teacher_id")
      .eq("student_id", viewerId);
    bookedTeacherIds = new Set((data || []).map(b => b.teacher_id));
  }

  return teachers.filter(t => {
    if (armusIsTeacherHiddenFromEveryone(t)) return false;
    if (t.hiddenFromNewStudents) return bookedTeacherIds.has(t.id);
    return true;
  });
}

// Demo teachers (teachers-data.js) have a fixed, hand-written reviews
// list for marketing purposes - it was never a real reflection of
// reviewCount/rating (those are decorative). Real students can still
// book and review them though, so real reviews get added on top of the
// hand-written ones rather than replacing them.
async function armusEnrichDemoTeacherReviews(teacher) {

  const rawReviews = await armusGetReviewsForTeacher(teacher.id).catch(() => []);
  if (!rawReviews.length) return teacher;

  const liveReviews = rawReviews.map(r => ({
    name: armusFormatReviewerName(r.studentName),
    stars: r.stars,
    text: r.text,
    date: r.createdAt,
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
// viewerId: the signed-in STUDENT's id, or omit/null for anyone else
// (not signed in, or a teacher account) - passed through to
// armusFilterVisibleTeachers so a teacher a student has already booked
// stays visible to them even while hidden from new students (migration_41.sql).
async function armusGetRegisteredTeachers(viewerId) {

  // teacher_marketplace_stats (migration_48.sql) is a security-definer RPC
  // that returns real per-teacher completed-lesson/student COUNTS only -
  // a plain bookings.select("*") here would be silently filtered by
  // bookings_select_participant down to just the viewer's own bookings
  // (or nothing at all for a logged-out visitor), making these stats
  // wrong for almost everyone browsing the marketplace.
  const [profilesRes, reviewsRes, statsRes] = await Promise.all([
    // masked_profiles (migration_59.sql), not the raw profiles table -
    // it returns every column this file needs, with a teacher's `name`
    // already short-formed server-side, so the real full name is never
    // sent to the browser for a student/anonymous viewer in the first
    // place (a plain profiles.select("*") used to send it regardless of
    // how the UI rendered it, visible to anyone via devtools).
    armusSupabase
      .from("masked_profiles")
      .select("*")
      .eq("role", "teacher")
      .eq("status", "approved"),
    // masked_reviews (migration_67.sql), not the raw reviews table - see
    // its comment above the masked_profiles call: same reasoning, for a
    // reviewing student's real name instead of a teacher's.
    armusSupabase.from("masked_reviews").select("*"),
    armusSupabase.rpc("teacher_marketplace_stats"),
  ]);

  if (profilesRes.error || !profilesRes.data) return [];

  const allReviews = (reviewsRes.data || []).map(armusMapReviewRow);
  const statsByTeacherId = new Map((statsRes.data || []).map(s => [s.teacher_id, s]));

  const teachers = profilesRes.data.map(profile => armusBuildTeacherFromParts(
    profile,
    allReviews.filter(r => r.teacherId === profile.id),
    statsByTeacherId.get(profile.id) || null
  ));

  return armusFilterVisibleTeachers(teachers, viewerId);
}

async function armusGetMarketplaceTeachers(viewerId) {
  return TEACHERS.concat(await armusGetRegisteredTeachers(viewerId));
}

// viewerId: the signed-in STUDENT's id, or omit/null for anyone else -
// see armusGetRegisteredTeachers. A caller fetching a teacher the
// viewer already has a real booking with (my-lessons.html) naturally
// still gets it back, since that's exactly the relationship this checks
// for; a NEW visitor reaching a hidden teacher's page directly (a stale
// link, a guessed URL) is turned away the same as everyone else would be
// in search - hiding a teacher would otherwise be trivial to bypass.
async function armusFindMarketplaceTeacher(id, viewerId) {

  const demoTeacher = TEACHERS.find(t => t.id === id);
  if (demoTeacher) return armusEnrichDemoTeacherReviews(demoTeacher);

  // profile, reviews and stats only depend on id, not on each other, so
  // fetch all three at once instead of waiting for the profile before
  // starting the other two - cuts a full round trip off the teacher
  // profile page's load time. teacher_marketplace_stats (migration_48.sql)
  // returns real counts bypassing RLS - see armusGetRegisteredTeachers
  // for why a plain bookings query here would be wrong for nearly every
  // viewer.
  const [profileRes, rawReviews, statsRes] = await Promise.all([
    // masked_profiles - see armusGetRegisteredTeachers above for why
    armusSupabase
      .from("masked_profiles")
      .select("*")
      .eq("id", id)
      .eq("status", "approved")
      .maybeSingle(),
    armusGetReviewsForTeacher(id),
    armusSupabase.rpc("teacher_marketplace_stats"),
  ]);

  if (profileRes.error || !profileRes.data) return null;

  const stats = (statsRes.data || []).find(s => s.teacher_id === id) || null;
  const teacher = armusBuildTeacherFromParts(profileRes.data, rawReviews, stats);
  const [visible] = await armusFilterVisibleTeachers([teacher], viewerId);
  return visible || null;
}
