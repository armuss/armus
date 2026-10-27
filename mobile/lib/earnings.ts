import { isBookingPast, isPaidLateCancel, lessonWindow, type Booking } from './bookings';
import { supabase } from './supabase';

// The commission tier a teacher is paid at, by total completed hours.
// Mirrors bookings.js's armusCommissionForHours exactly - keep in sync.
export function commissionForHours(hours: number) {
  if (hours < 100) return { rate: 30, range: '0–100 saat' };
  if (hours < 200) return { rate: 28, range: '100–200 saat' };
  if (hours < 300) return { rate: 25, range: '200–300 saat' };
  if (hours < 500) return { rate: 20, range: '300–500 saat' };
  return { rate: 15, range: '500+ saat' };
}

type TeacherCredit = { student_id: string; teacher_id: string; source: string | null; source_booking_id: string | null; status: string };

// A trial is only the teacher's earnings once the student carried on with
// them (a regular lesson, or a package bought) - and only the earliest
// such trial per student. Mirrors armusTrialCountsAsEarned (bookings.js).
export function trialCountsAsEarned(booking: Booking, allBookings: Booking[], credits: TeacherCredit[]) {
  if (booking.type !== 'trial') return true;
  const hasRealLesson = allBookings.some(
    (b) =>
      b.id !== booking.id &&
      b.studentId === booking.studentId &&
      b.teacherId === booking.teacherId &&
      b.type === 'lesson' &&
      b.status !== 'cancelled'
  );
  const hasConversionCredit = credits.some(
    (c) =>
      c.student_id === booking.studentId &&
      c.teacher_id === booking.teacherId &&
      (c.source === 'package' || (!c.source && !c.source_booking_id)) &&
      c.status !== 'refunded'
  );
  if (!hasRealLesson && !hasConversionCredit) return false;
  const earliestTrialId = allBookings
    .filter((b) => b.type === 'trial' && b.studentId === booking.studentId && b.teacherId === booking.teacherId && b.status !== 'cancelled')
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())[0]?.id;
  return booking.id === earliestTrialId;
}

// A lesson's earnings become withdrawable this many days after it ends,
// so a no-show report or a complaint can be settled first. Mirrors
// bookings.js's ARMUS_PAYOUT_HOLD_DAYS.
export const PAYOUT_HOLD_DAYS = 7;

export function payoutReleaseAt(booking: Booking) {
  return new Date(lessonWindow(booking).end.getTime() + PAYOUT_HOLD_DAYS * 86_400_000);
}

export type EarningsSummary = {
  rate: number;
  range: string;
  completedLessons: number;
  hours: number;
  netThisMonth: number;
  withdrawableBalance: number;
  heldNet: number;
  nextReleaseAt: Date | null;
  months: { key: string; count: number; gross: number; net: number }[];
};

export type WithdrawalRequest = { id: string; amount: number; status: 'pending' | 'paid' | 'rejected'; requested_at: string };

// Same numbers dashboard.html shows: earnings are an estimate at the
// current commission tier; the admin checks the real amount when paying.
export function summarizeEarnings(
  bookings: Booking[],
  credits: TeacherCredit[],
  withdrawals: WithdrawalRequest[],
  teacherTimezone: string
): EarningsSummary {
  const active = bookings.filter((b) => b.status !== 'cancelled');
  const completed = active.filter(isBookingPast);
  const hours = Math.round(((completed.length * 50) / 60) * 10) / 10;
  const tier = commissionForHours(hours);
  // a regular lesson the student cancelled late is paid once its time passes
  const earned = completed.concat(bookings.filter((b) => isPaidLateCancel(b) && isBookingPast(b)));
  const earnable = (b: Booking) => (trialCountsAsEarned(b, active, credits) ? Number(b.price) || 0 : 0);
  const net = (gross: number) => Math.round(gross * (1 - tier.rate / 100));

  const monthKeyOf = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: teacherTimezone || 'Europe/Istanbul', year: 'numeric', month: '2-digit' }).format(d);
  const byMonth = new Map<string, { count: number; gross: number }>();
  earned.forEach((b) => {
    const key = monthKeyOf(lessonWindow(b).start);
    const entry = byMonth.get(key) || { count: 0, gross: 0 };
    if (!isPaidLateCancel(b)) entry.count += 1;
    entry.gross += earnable(b);
    byMonth.set(key, entry);
  });
  const thisMonth = byMonth.get(monthKeyOf(new Date()));

  const now = new Date();
  const released = earned.filter((b) => payoutReleaseAt(b) <= now);
  const held = earned.filter((b) => payoutReleaseAt(b) > now);
  const claimed = withdrawals.filter((w) => w.status !== 'rejected').reduce((sum, w) => sum + Number(w.amount), 0);
  const nextReleaseAt =
    held
      .filter((b) => earnable(b) > 0)
      .map(payoutReleaseAt)
      .sort((a, b) => a.getTime() - b.getTime())[0] || null;

  return {
    rate: tier.rate,
    range: tier.range,
    completedLessons: completed.length,
    hours,
    netThisMonth: net(thisMonth?.gross || 0),
    withdrawableBalance: Math.max(0, net(released.reduce((sum, b) => sum + earnable(b), 0)) - claimed),
    heldNet: net(held.reduce((sum, b) => sum + earnable(b), 0)),
    nextReleaseAt,
    months: Array.from(byMonth.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, e]) => ({ key, count: e.count, gross: e.gross, net: net(e.gross) })),
  };
}

// the teacher's own credits (lesson_credits_select_teacher policy) - a
// package bought with them turns a trial into earnings
export async function getTeacherCredits(teacherId: string): Promise<TeacherCredit[]> {
  const { data, error } = await supabase.from('lesson_credits').select('*').eq('teacher_id', teacherId);
  if (error || !data) return [];
  return data as TeacherCredit[];
}

export async function getWithdrawalRequests(teacherId: string): Promise<WithdrawalRequest[]> {
  const { data, error } = await supabase
    .from('withdrawal_requests')
    .select('*')
    .eq('teacher_id', teacherId)
    .order('requested_at', { ascending: false });
  if (error || !data) return [];
  return data as WithdrawalRequest[];
}

// a request queue, not a payment rail (migration_93.sql) - the ARMUS team
// checks it and sends the transfer by hand
export async function createWithdrawalRequest(params: {
  teacherId: string;
  amount: number;
  iban: string;
  ibanName: string;
  note: string;
}): Promise<WithdrawalRequest | null> {
  const { data, error } = await supabase
    .from('withdrawal_requests')
    .insert({
      teacher_id: params.teacherId,
      amount: params.amount,
      iban: params.iban,
      iban_name: params.ibanName,
      note: params.note || null,
    })
    .select()
    .single();
  if (error || !data) return null;
  return data as WithdrawalRequest;
}

export function normalizeIban(raw: string) {
  return raw.replace(/\s+/g, '').toUpperCase();
}

export function isValidTurkishIban(iban: string) {
  return /^TR\d{24}$/.test(iban);
}
