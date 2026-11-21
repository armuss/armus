import { invokeEdge } from './edge';
import { tr } from './i18n';

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
      withdrawalConsent: boolean;
    }
  | {
      teacherId: string;
      teacherName: string;
      type: 'package';
      quantity: number;
      price: number;
      phone: string;
      identityNumber: string;
      withdrawalConsent: boolean;
    };

export type CreatePaymentResult =
  | { ok: true; bookedDirectly: true; creditApplied: boolean }
  | { ok: true; bookedDirectly: false; paymentPageUrl: string }
  | { ok: false; error: string; trialAlreadyTaken?: boolean };

// Calls the create-payment Edge Function - the only place a card charge
// (or a lesson-credit redemption) is ever started from. Mirrors
// booking.html's confirmBtn handler. trialAlreadyTaken: one trial per
// teacher (migration_110.sql) - book a regular lesson instead.
// withdrawalConsent (migration_112.sql): a card payment needs the
// student's consent that the right of withdrawal ends once a lesson starts.
export async function createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
  const result = await invokeEdge('create-payment', params as unknown as Record<string, unknown>);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error || tr("İşlem başlatılamadı. Lütfen tekrar dene."),
      trialAlreadyTaken: !!result.body?.trialAlreadyTaken,
    };
  }
  const data = result.data;
  if (!data.paymentPageUrl && !data.bookedDirectly) {
    return { ok: false, error: tr("İşlem başlatılamadı. Lütfen tekrar dene.") };
  }

  if (data.bookedDirectly) {
    return { ok: true, bookedDirectly: true, creditApplied: Boolean(data.creditApplied) };
  }

  return { ok: true, bookedDirectly: false, paymentPageUrl: data.paymentPageUrl };
}

// A checkout page the student stepped back out of ("← Vazgeç") stays open
// on iyzico's side for a while, and create-payment refuses a second
// payment for the same lesson or package until that one resolves (20
// minutes: "Bu işlem için zaten bir ödemen devam ediyor") - on the website
// the student can go forward to the page again, but the app dropped it, so
// the same time (or package) couldn't be paid for at all for 20 minutes.
// The page is kept here and opened again for the same lesson / package.
// iyzico's checkout token lives 30 minutes, so a page is reused only
// within the server's own 20-minute window.
const REOPEN_CHECKOUT_MS = 20 * 60_000;
const openCheckouts = new Map<string, { url: string; at: number }>();

function checkoutKey(studentId: string, params: CreatePaymentParams) {
  return params.type === 'package'
    ? [studentId, params.teacherId, 'package', params.quantity].join('|')
    : [studentId, params.teacherId, params.type, params.date, params.time].join('|');
}

export function rememberCheckout(studentId: string, params: CreatePaymentParams, url: string) {
  openCheckouts.set(checkoutKey(studentId, params), { url, at: Date.now() });
}

export function openCheckoutFor(studentId: string, params: CreatePaymentParams): string | null {
  const key = checkoutKey(studentId, params);
  const open = openCheckouts.get(key);
  if (open && Date.now() - open.at < REOPEN_CHECKOUT_MS) return open.url;
  openCheckouts.delete(key);
  return null;
}

// once the page has come back with a result it can't be used again
export function forgetCheckout(studentId: string, params: CreatePaymentParams) {
  openCheckouts.delete(checkoutKey(studentId, params));
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

// The lesson type a successful redirect reports - what the booking really
// became. payment-callback books a trial as a regular lesson when the
// student's one trial with this teacher was taken while they paid (AR005),
// and says so with &type=lesson.
export function paymentRedirectType(url: string): 'trial' | 'lesson' | null {
  if (!parsePaymentRedirect(url)) return null;
  const type = new URL(url).searchParams.get('type');
  return type === 'trial' || type === 'lesson' ? type : null;
}
