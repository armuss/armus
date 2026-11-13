/**
 * ARMUS — merges the fixed demo teachers (teachers-data.ts) with real
 * registered teacher accounts (Supabase profiles) into one bookable list,
 * mirroring marketplace.js on the web so the app's marketplace matches the
 * site exactly. Only status === "approved" teachers are shown — "pending"
 * and "rejected" applicants stay hidden.
 */
import { capitalizeName } from './displayName';
import { supabase } from './supabase';
import { TEACHERS, type Teacher } from './teachers-data';
import { tr } from './i18n';

// "Mehmet Kaya" -> "Mehmet K."
function formatReviewerName(fullName: string) {
  const parts = capitalizeName(fullName).split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || tr("Öğrenci", 1);
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// stats: a teacher_marketplace_stats row (migration_48.sql) - real counts
// computed server-side. Counting a plain bookings query here was wrong for
// almost every viewer: bookings_select_participant only returns the
// viewer's OWN bookings, so a teacher's "tamamlanan ders" / "öğrenci"
// showed just the viewer's share of them. Same source as marketplace.js.
function buildTeacherFromParts(profile: any, rawReviews: any[], stats: { completed_count?: number; student_count?: number } | null): Teacher {
  const initials = String(profile.name || '')
    .split(' ')
    .map((part: string) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const reviews = rawReviews.map((r) => ({
    name: formatReviewerName(r.student_name),
    stars: r.stars,
    text: r.comment || '',
  }));
  const rating = rawReviews.length
    ? Math.round((rawReviews.reduce((sum, r) => sum + r.stars, 0) / rawReviews.length) * 10) / 10
    : null;

  const completedCount = stats?.completed_count ?? 0;
  const studentCount = stats?.student_count ?? 0;

  return {
    id: profile.id,
    initials: initials || '?',
    photo: profile.photo_url || null,
    video: profile.video_url || null,
    name: profile.name,
    role: profile.title || tr("İngilizce Öğretmeni"),
    price: profile.price ?? 500,
    timezone: profile.timezone || 'Europe/Istanbul',
    rating,
    reviewCount: reviews.length,
    tags: [profile.subject_taught || tr("Genel İngilizce"), tr("Yeni Öğretmen")],
    level: '',
    availability: profile.availability || tr("Şu anda ders almaya uygun"),
    about: profile.bio ? [profile.bio] : [tr("Bu öğretmen henüz bir tanıtım yazısı eklemedi.")],
    experience: tr("Yeni"),
    completedLessons: String(completedCount),
    students: studentCount,
    languages:
      Array.isArray(profile.languages) && profile.languages.length
        ? profile.languages.map((l: any) => `${l.language} (${l.level})`).join(', ')
        : 'English / Türkçe',
    levelRange: 'A1 – C2',
    specialties: [profile.subject_taught || tr("Genel İngilizce")],
    reviews,
    isRegistered: true,
    weeklyAvailability: Array.isArray(profile.weekly_availability) ? profile.weekly_availability : null,
    availabilityDates:
      profile.availability_dates && typeof profile.availability_dates === 'object' ? profile.availability_dates : null,
    // migration_41.sql - the attendance-report hide/ban state (filterVisibleTeachers)
    isBanned: Boolean(profile.is_banned),
    hiddenFromNewStudents: Boolean(profile.hidden_from_new_students),
    hiddenUntil: profile.hidden_until || null,
  };
}

// Whether a teacher is hidden from EVERYONE right now: banned, or the
// temporary hide of a repeated confirmed violation (migration_41.sql).
function isHiddenFromEveryone(t: Teacher) {
  if (t.isBanned) return true;
  return !!(t.hiddenUntil && new Date(t.hiddenUntil).getTime() > Date.now());
}

// The website's armusFilterVisibleTeachers (marketplace.js), rule for rule:
// a banned or temporarily hidden teacher is hidden from everyone; a teacher
// hidden "from new students" (an open no-show / late report) stays visible
// only to students who have booked them before. Demo teachers are never
// hidden - they have no profile row for any of this to apply to.
async function filterVisibleTeachers(teachers: Teacher[]): Promise<Teacher[]> {
  const hiddenFromNewOnly = teachers.filter((t) => !isHiddenFromEveryone(t) && t.hiddenFromNewStudents);
  let booked = new Set<string>();
  if (hiddenFromNewOnly.length) {
    const { data: auth } = await supabase.auth.getSession();
    const viewerId = auth.session?.user.id;
    if (viewerId) {
      const { data } = await supabase.from('bookings').select('teacher_id').eq('student_id', viewerId);
      booked = new Set((data || []).map((b: any) => b.teacher_id));
    }
  }
  return teachers.filter((t) => {
    if (isHiddenFromEveryone(t)) return false;
    if (t.hiddenFromNewStudents) return booked.has(t.id);
    return true;
  });
}

// Demo teachers have a fixed, hand-written reviews list for marketing
// purposes. Real students can still book and review them, so real reviews
// get added on top of the hand-written ones rather than replacing them.
async function enrichDemoTeacherReviews(teacher: Teacher): Promise<Teacher> {
  const { data, error } = await supabase
    .from('masked_reviews')
    .select('*')
    .eq('teacher_id', teacher.id)
    .order('created_at', { ascending: false });

  if (error || !data || !data.length) return teacher;

  const liveReviews = data.map((r: any) => ({
    name: formatReviewerName(r.student_name),
    stars: r.stars,
    text: r.comment || '',
  }));

  return { ...teacher, reviews: liveReviews.concat(teacher.reviews) };
}

// Only the real, self-registered teachers (a Supabase round trip), the same
// three sources as marketplace.js: masked_profiles (a teacher's name already
// short-formed server-side), teacher_review_stats (rating and count without
// downloading every review) and teacher_marketplace_stats (real lesson /
// student counts) - then the same visibility filter.
async function getRegisteredTeachers(): Promise<Teacher[]> {
  const [profilesRes, reviewStatsRes, statsRes] = await Promise.all([
    supabase.from('masked_profiles').select('*').eq('role', 'teacher').eq('status', 'approved'),
    supabase.rpc('teacher_review_stats'),
    supabase.rpc('teacher_marketplace_stats'),
  ]);

  if (profilesRes.error || !profilesRes.data) return [];

  const reviewStats = new Map<string, any>((reviewStatsRes.data || []).map((r: any) => [r.teacher_id, r]));
  const stats = new Map<string, any>((statsRes.data || []).map((r: any) => [r.teacher_id, r]));

  const teachers = profilesRes.data.map((profile: any) => {
    const teacher = buildTeacherFromParts(profile, [], stats.get(profile.id) || null);
    const rs = reviewStats.get(profile.id);
    teacher.rating = rs ? Number(rs.avg_rating) : null;
    teacher.reviewCount = rs ? Number(rs.review_count) : 0;
    return teacher;
  });
  return filterVisibleTeachers(teachers);
}

export async function getMarketplaceTeachers(): Promise<Teacher[]> {
  try {
    return TEACHERS.concat(await getRegisteredTeachers());
  } catch {
    return TEACHERS;
  }
}

export async function findMarketplaceTeacher(id: string): Promise<Teacher | null> {
  const demoTeacher = TEACHERS.find((t) => t.id === id);
  if (demoTeacher) return enrichDemoTeacherReviews(demoTeacher);

  const [profileRes, reviewsRes, statsRes] = await Promise.all([
    supabase.from('masked_profiles').select('*').eq('id', id).eq('status', 'approved').maybeSingle(),
    supabase.from('masked_reviews').select('*').eq('teacher_id', id).order('created_at', { ascending: false }),
    supabase.rpc('teacher_marketplace_stats'),
  ]);

  if (profileRes.error || !profileRes.data) return null;
  const stats = (statsRes.data || []).find((r: any) => r.teacher_id === id) || null;
  const teacher = buildTeacherFromParts(profileRes.data, reviewsRes.data || [], stats);
  // a hidden teacher's page is closed to anyone who couldn't find them in
  // the list either (a stale link, a notification) - like the website
  const [visible] = await filterVisibleTeachers([teacher]);
  return visible || null;
}
