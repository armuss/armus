import { supabase } from './supabase';

export type CreatePaymentParams =
  | {
      teacherId: string;
      teacherName: string;
      type: 'trial' | 'lesson';
      date: string;
      time: string;
      price: number;
      phone: string;
      identityNumber: string;
    }
  | {
      teacherId: string;
      teacherName: string;
      type: 'package';
      quantity: number;
      price: number;
      phone: string;
      identityNumber: string;
    };

export type CreatePaymentResult =
  | { ok: true; bookedDirectly: true; creditApplied: boolean }
  | { ok: true; bookedDirectly: false; paymentPageUrl: string }
  | { ok: false; error: string };

// Calls the create-payment Edge Function - the only place a card charge
// (or a lesson-credit redemption) is ever started from. Mirrors
// booking.html's confirmBtn handler.
export async function createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
  const { data, error } = await supabase.functions.invoke('create-payment', { body: params });

  if (error || !data || (!data.paymentPageUrl && !data.bookedDirectly)) {
    return { ok: false, error: (data && data.error) || 'İşlem başlatılamadı. Lütfen tekrar dene.' };
  }

  if (data.bookedDirectly) {
    return { ok: true, bookedDirectly: true, creditApplied: Boolean(data.creditApplied) };
  }

  return { ok: true, bookedDirectly: false, paymentPageUrl: data.paymentPageUrl };
}

// Whether the student has an available lesson credit (from a past
// cancellation) that would cover this booking for free - same teacher, or
// any teacher for a trial lesson. Purely informational for the UI; the
// Edge Function re-checks this itself before ever waiving a charge.
export async function hasCoveringCredit(studentId: string, teacherId: string, isTrial: boolean): Promise<boolean> {
  const { data, error } = await supabase
    .from('lesson_credits')
    .select('*')
    .eq('student_id', studentId)
    .eq('status', 'available');

  if (error || !data || !data.length) return false;
  return data.some((c: any) => c.teacher_id === teacherId) || isTrial;
}
