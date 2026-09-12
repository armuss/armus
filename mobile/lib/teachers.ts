/**
 * ARMUS — merges the fixed demo teachers (teachers-data.ts) with real
 * registered teacher accounts (Supabase profiles) into one bookable list,
 * mirroring marketplace.js on the web so the app's marketplace matches the
 * site exactly. Only status === "approved" teachers are shown — "pending"
 * and "rejected" applicants stay hidden.
 */
import { supabase } from './supabase';
import { TEACHERS, type Teacher } from './teachers-data';

// "Mehmet Kaya" -> "Mehmet K."
function formatReviewerName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || 'Öğrenci';
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// A booking counts once its scheduled date has passed.
function isBookingPast(booking: any) {
  const todayKey = new Date().toISOString().slice(0, 10);
  return booking.lesson_date < todayKey;
}

function buildTeacherFromParts(profile: any, rawReviews: any[], bookings: any[]): Teacher {
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

  const completedCount = bookings.filter(isBookingPast).length;
  const studentCount = new Set(bookings.map((b) => b.student_id)).size;

  return {
    id: profile.id,
    initials: initials || '?',
    photo: profile.photo_url || null,
    name: profile.name,
    role: profile.title || 'İngilizce Öğretmeni',
    price: profile.price ?? 500,
    rating,
    reviewCount: reviews.length,
    tags: [profile.subject_taught || 'Genel İngilizce', 'Yeni Öğretmen'],
    level: '',
    availability: profile.availability || 'Şu anda ders almaya uygun',
    about: profile.bio ? [profile.bio] : ['Bu öğretmen henüz bir tanıtım yazısı eklemedi.'],
    experience: 'Yeni',
    completedLessons: String(completedCount),
    students: studentCount,
    languages:
      Array.isArray(profile.languages) && profile.languages.length
        ? profile.languages.map((l: any) => `${l.language} (${l.level})`).join(', ')
        : 'English / Türkçe',
    levelRange: 'A1 – C2',
    specialties: [profile.subject_taught || 'Genel İngilizce'],
    reviews,
    isRegistered: true,
    weeklyAvailability: Array.isArray(profile.weekly_availability) ? profile.weekly_availability : null,
    availabilityDates:
      profile.availability_dates && typeof profile.availability_dates === 'object' ? profile.availability_dates : null,
  };
}

// Demo teachers have a fixed, hand-written reviews list for marketing
// purposes. Real students can still book and review them, so real reviews
// get added on top of the hand-written ones rather than replacing them.
async function enrichDemoTeacherReviews(teacher: Teacher): Promise<Teacher> {
  const { data, error } = await supabase
    .from('reviews')
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

// Only the real, self-registered teachers (a Supabase round trip).
async function getRegisteredTeachers(): Promise<Teacher[]> {
  const [profilesRes, reviewsRes, bookingsRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('role', 'teacher').eq('status', 'approved'),
    supabase.from('reviews').select('*'),
    supabase.from('bookings').select('*'),
  ]);

  if (profilesRes.error || !profilesRes.data) return [];

  const allReviews = reviewsRes.data || [];
  const allBookings = bookingsRes.data || [];

  return profilesRes.data.map((profile: any) =>
    buildTeacherFromParts(
      profile,
      allReviews.filter((r: any) => r.teacher_id === profile.id),
      allBookings.filter((b: any) => b.teacher_id === profile.id)
    )
  );
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

  const [profileRes, reviewsRes, bookingsRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', id).eq('status', 'approved').maybeSingle(),
    supabase.from('reviews').select('*').eq('teacher_id', id).order('created_at', { ascending: false }),
    supabase.from('bookings').select('*').eq('teacher_id', id),
  ]);

  if (profileRes.error || !profileRes.data) return null;
  return buildTeacherFromParts(profileRes.data, reviewsRes.data || [], bookingsRes.data || []);
}
