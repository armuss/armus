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

// a masked_reviews row as the profile shows it - with its date, which
// teacher.html prints under the reviewer's name
function toReview(r: any): Teacher['reviews'][number] {
  return { name: formatReviewerName(r.student_name), stars: r.stars, text: r.comment || '', date: r.created_at || undefined };
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

  const reviews = rawReviews.map(toReview);
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
    // migration_85.sql - activity-derived presence, like marketplace.js;
    // the card re-derives "online" from the timestamp (isTeacherOnline)
    lastActiveAt: profile.last_active_at || null,
    // migration_41.sql - the attendance-report hide/ban state (filterVisibleTeachers)
    isBanned: Boolean(profile.is_banned),
    hiddenFromNewStudents: Boolean(profile.hidden_from_new_students),
    hiddenUntil: profile.hidden_until || null,
  };
}

// A teacher reads as online for 5 minutes after profiles.last_active_at -
// the website's armusIsTeacherOnline / ARMUS_PRESENCE_WINDOW_MS (auth.js).
// A teacher's app refreshes it every 2 minutes ((tabs)/_layout.tsx).
const PRESENCE_WINDOW_MS = 5 * 60 * 1000;

export function isTeacherOnline(t: Pick<Teacher, 'lastActiveAt'>): boolean {
  if (!t.lastActiveAt) return false;
  return Date.now() - new Date(t.lastActiveAt).getTime() < PRESENCE_WINDOW_MS;
}

// PostgREST returns at most 1000 rows per request (Supabase's max_rows),
// for a view and for a set-returning RPC alike - so once there are more
// approved teachers than that (or more teachers with reviews / lessons),
// the rest silently never reached the list. The first page is asked for
// unordered, exactly as before, so the usual short list keeps its order;
// only a full page goes on to read everything in a stable order, page by
// page.
const PAGE_ROWS = 1000;

async function selectAllRows(
  query: (ordered: boolean) => any
): Promise<{ data: any[] | null; error: any }> {
  const first = await query(false).range(0, PAGE_ROWS - 1);
  if (first.error || !first.data || first.data.length < PAGE_ROWS) return first;
  const rows: any[] = [];
  for (let from = 0; from < PAGE_ROWS * 100; from += PAGE_ROWS) {
    const { data, error } = await query(true).range(from, from + PAGE_ROWS - 1);
    if (error || !data) return { data: null, error: error || new Error('no data') };
    rows.push(...data);
    if (data.length < PAGE_ROWS) break;
  }
  return { data: rows, error: null };
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
      // only these teachers' bookings: all of a student's own bookings
      // could pass the 1000-row cap and drop the one that matters
      const { data } = await supabase
        .from('bookings')
        .select('teacher_id')
        .eq('student_id', viewerId)
        .in('teacher_id', hiddenFromNewOnly.map((t) => t.id));
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

  return { ...teacher, reviews: data.map(toReview).concat(teacher.reviews) };
}

// Only the real, self-registered teachers (a Supabase round trip), the same
// three sources as marketplace.js: masked_profiles (a teacher's name already
// short-formed server-side), teacher_review_stats (rating and count without
// downloading every review) and teacher_marketplace_stats (real lesson /
// student counts) - then the same visibility filter.
// Throws when the teacher list itself can't be read (no connection), so a
// caller can tell "no real teachers" from "couldn't load them".
async function getRegisteredTeachers(): Promise<Teacher[]> {
  const [profilesRes, reviewStatsRes, statsRes] = await Promise.all([
    selectAllRows((ordered) => {
      const q = supabase.from('masked_profiles').select('*').eq('role', 'teacher').eq('status', 'approved');
      return ordered ? q.order('id') : q;
    }),
    selectAllRows((ordered) => {
      const q = supabase.rpc('teacher_review_stats');
      return ordered ? q.order('teacher_id') : q;
    }),
    selectAllRows((ordered) => {
      const q = supabase.rpc('teacher_marketplace_stats');
      return ordered ? q.order('teacher_id') : q;
    }),
  ]);

  if (profilesRes.error || !profilesRes.data) throw profilesRes.error || new Error('masked_profiles');

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
  return (await loadMarketplaceTeachers()).teachers;
}

// The same list, plus whether the real teachers could be read at all -
// without a connection only the demo teachers came back, and Keşfet showed
// them as if they were everyone, with no word that the rest were missing.
export async function loadMarketplaceTeachers(): Promise<{ teachers: Teacher[]; complete: boolean }> {
  try {
    return { teachers: TEACHERS.concat(await getRegisteredTeachers()), complete: true };
  } catch {
    return { teachers: TEACHERS, complete: false };
  }
}

export async function findMarketplaceTeacher(id: string): Promise<Teacher | null> {
  const result = await loadMarketplaceTeacher(id);
  return result === 'error' ? null : result;
}

// The same, telling "no such teacher" (null: a wrong or stale id, a pending,
// banned or hidden teacher) apart from "couldn't load it" ('error': no
// connection) - the profile page offers a retry for the second, where it
// used to say "not found" for both.
export async function loadMarketplaceTeacher(id: string): Promise<Teacher | null | 'error'> {
  try {
    const demoTeacher = TEACHERS.find((t) => t.id === id);
    if (demoTeacher) return await enrichDemoTeacherReviews(demoTeacher);

    const [profileRes, reviewsRes, statsRes, reviewStatsRes] = await Promise.all([
      supabase.from('masked_profiles').select('*').eq('id', id).eq('status', 'approved').maybeSingle(),
      supabase.from('masked_reviews').select('*').eq('teacher_id', id).order('created_at', { ascending: false }),
      // just this teacher's row: the whole table stops at 1000 rows, and a
      // teacher past that showed 0 lessons and 0 students
      supabase.rpc('teacher_marketplace_stats').eq('teacher_id', id),
      // the same for the rating and review count
      supabase.rpc('teacher_review_stats').eq('teacher_id', id),
    ]);

    // 22P02: not a uuid at all (a mistyped link) - simply no such teacher
    if (profileRes.error) return profileRes.error.code === '22P02' ? null : 'error';
    if (!profileRes.data) return null;
    const stats = (statsRes.data || []).find((r: any) => r.teacher_id === id) || null;
    const teacher = buildTeacherFromParts(profileRes.data, reviewsRes.data || [], stats);
    // the rating and count the Keşfet card shows (teacher_review_stats):
    // averaged here instead, the two could differ (4.35 rounds to 4.4 in
    // the database, 4.3 in JavaScript), and a list cut at 1000 reviews
    // undercounted
    const rs = (reviewStatsRes.data || []).find((r: any) => r.teacher_id === id);
    if (rs) {
      teacher.rating = Number(rs.avg_rating);
      teacher.reviewCount = Number(rs.review_count);
    }
    // a hidden teacher's page is closed to anyone who couldn't find them in
    // the list either (a stale link, a notification) - like the website
    const [visible] = await filterVisibleTeachers([teacher]);
    return visible || null;
  } catch {
    return 'error';
  }
}
