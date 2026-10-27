import { invokeEdge } from './edge';
import { supabase } from './supabase';

export type LessonCredit = {
  id: string;
  teacher_id: string;
  teacher_name: string;
  status: string;
  value: number | string | null;
  source: string | null;
  transferred_at: string | null;
  created_at: string | null;
};

// The student's lesson credits still on their balance. Purely for the UI -
// create-payment re-checks everything itself before waiving a charge.
export async function getAvailableCredits(studentId: string): Promise<LessonCredit[] | null> {
  const { data, error } = await supabase
    .from('lesson_credits')
    .select('*')
    .eq('student_id', studentId)
    .eq('status', 'available');
  if (error || !data) return null;
  return data as LessonCredit[];
}

// migration_110.sql: what one lesson credit covers. Mirrors create-payment's
// creditCoverage/pickCreditForBooking and bookings.js's
// armusCreditCoverage/armusPickCreditForBooking exactly - keep them in sync.
//   - its own teacher: any lesson, at the price paid for it (value)
//   - another teacher: a trial only, worth `value` - a dearer trial needs
//     the difference by card (topUp), a cheaper one leaves the rest unused
//   - moved over from a stranded package (transferred_at): worth `value`
//     with its new teacher, for any lesson
//   - value null (older credits that couldn't be matched to a payment):
//     covers the lesson in full
export const MIN_TOPUP = 1;

export type CreditCoverage = { credit: LessonCredit; bookingPrice: number; topUp: number; leftover: number };

export function creditCoverage(credit: LessonCredit, teacherId: string, type: string, price: number): CreditCoverage | null {
  const sameTeacher = credit.teacher_id === teacherId;
  if (!sameTeacher && type !== 'trial') return null;
  if (credit.value === null || credit.value === undefined) {
    return { credit, bookingPrice: price, topUp: 0, leftover: 0 };
  }
  const value = Number(credit.value);
  if (sameTeacher && !credit.transferred_at) {
    return { credit, bookingPrice: value, topUp: 0, leftover: 0 };
  }
  const topUp = Math.round((price - value) * 100) / 100;
  if (topUp >= MIN_TOPUP) return { credit, bookingPrice: price, topUp, leftover: 0 };
  return { credit, bookingPrice: price, topUp: 0, leftover: Math.max(0, Math.round((value - price) * 100) / 100) };
}

// one that needs nothing by card first, then the teacher's own, then the
// closest fit, then the oldest
export function pickCreditForBooking(credits: LessonCredit[], teacherId: string, type: string, price: number) {
  const rank = (o: CreditCoverage) => [
    o.topUp > 0 ? 1 : 0,
    o.credit.teacher_id === teacherId ? 0 : 1,
    o.topUp > 0 ? o.topUp : o.leftover,
    new Date(o.credit.created_at || 0).getTime(),
  ];
  const options = (credits || [])
    .map((c) => creditCoverage(c, teacherId, type, price))
    .filter((o): o is CreditCoverage => o !== null)
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
      return 0;
    });
  return options[0] || null;
}

// migration_110.sql: one trial per teacher. A trial counts as taken unless
// it was cancelled with nothing lost - a late cancellation still counts.
// The bookings_enforce_one_trial trigger is the real gate.
export async function hasTakenTrialWith(studentId: string, teacherId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('bookings')
    .select('status, late_cancel')
    .eq('student_id', studentId)
    .eq('teacher_id', teacherId)
    .eq('type', 'trial');
  if (error || !data) return false;
  return data.some((b: any) => (b.status || 'confirmed') !== 'cancelled' || b.late_cancel === true);
}

// ---- package lessons whose teacher can't teach this student anymore ------
// (banned, blocking them, account closed - migration_110.sql)

export type StrandedPackage = {
  teacherId: string;
  teacherName: string;
  lessons: number;
  totalValue: number;
  refundable: boolean;
};

export async function getStrandedPackages(): Promise<StrandedPackage[]> {
  const { data, error } = await supabase.rpc('my_stranded_package_credits');
  if (error || !Array.isArray(data)) return [];
  return data.map((r: any) => ({
    teacherId: r.teacher_id,
    teacherName: r.teacher_name,
    lessons: Number(r.lessons) || 0,
    totalValue: Number(r.total_value) || 0,
    refundable: r.refundable === true,
  }));
}

export async function refundStrandedPackage(teacherId: string) {
  const result = await invokeEdge('package-credits', { action: 'refund', teacher_id: teacherId });
  if (!result.ok) return { ok: false as const, error: result.error || 'İşlem yapılamadı. Lütfen tekrar dene.' };
  return { ok: true as const, refundedLessons: Number(result.data.refundedLessons) || 0, refundedAmount: Number(result.data.refundedAmount) || 0 };
}

export async function transferStrandedPackage(teacherId: string, newTeacherId: string) {
  const result = await invokeEdge('package-credits', { action: 'transfer', teacher_id: teacherId, new_teacher_id: newTeacherId });
  if (!result.ok) return { ok: false as const, error: result.error || 'İşlem yapılamadı. Lütfen tekrar dene.' };
  return { ok: true as const, transferred: Number(result.data.transferred) || 0, teacherName: String(result.data.teacherName || '') };
}

export function formatMoney(amount: number | string) {
  return `₺${Number(amount).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`;
}
