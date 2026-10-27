import { invokeEdge } from './edge';

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
  | { ok: false; error: string; trialAlreadyTaken?: boolean };

// Calls the create-payment Edge Function - the only place a card charge
// (or a lesson-credit redemption) is ever started from. Mirrors
// booking.html's confirmBtn handler. trialAlreadyTaken: one trial per
// teacher (migration_110.sql) - book a regular lesson instead.
export async function createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
  const result = await invokeEdge('create-payment', params as unknown as Record<string, unknown>);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error || 'İşlem başlatılamadı. Lütfen tekrar dene.',
      trialAlreadyTaken: !!result.body?.trialAlreadyTaken,
    };
  }
  const data = result.data;
  if (!data.paymentPageUrl && !data.bookedDirectly) {
    return { ok: false, error: 'İşlem başlatılamadı. Lütfen tekrar dene.' };
  }

  if (data.bookedDirectly) {
    return { ok: true, bookedDirectly: true, creditApplied: Boolean(data.creditApplied) };
  }

  return { ok: true, bookedDirectly: false, paymentPageUrl: data.paymentPageUrl };
}

// payment-callback (supabase/functions/payment-callback) only ever
// redirects here - to ARMUS's own real site - after it has already
// re-verified the charge with iyzico itself server-side; it never trusts
// the checkout redirect alone. The WebView showing the checkout form
// passes through iyzico's pages and the buyer's bank's 3-D Secure pages
// on the way there, though, so `navState.url.includes('payment=success')`
// on EVERY navigation (what this used to be) would fire on any URL that
// merely contains that substring anywhere - not necessarily one iyzico
// or ARMUS ever produced. Matching the exact origin and query param
// instead means only the one specific, server-verified redirect counts.
const SITE_URL = 'https://armus.com.tr';

export function parsePaymentRedirect(
  url: string
): 'success' | 'failed' | 'error' | 'slot_taken' | 'time_passed' | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== SITE_URL) return null;
  const status = parsed.searchParams.get('payment');
  if (
    status === 'success' ||
    status === 'failed' ||
    status === 'error' ||
    status === 'slot_taken' ||
    status === 'time_passed'
  )
    return status;
  return null;
}
