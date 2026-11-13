// The payer checks the website's checkout runs (bookings.js), word for word;
// create-payment repeats both on the server.

// Turkish GSM normalization: "+90 555 112 51 21", "905551125121",
// "0555 223 21 23" and bare "5551125121" are all the same number - returns
// the canonical "+90XXXXXXXXXX" iyzico's gsmNumber field expects, or null
// when the digits can't be one Turkish mobile number (landlines, starting
// 2/3/4, are rejected on purpose - iyzico would fail the payment later).
export function normalizeTurkishPhone(raw: string): string | null {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('90')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^5\d{9}$/.test(digits)) return null;
  return '+90' + digits;
}

// T.C. Kimlik No validity - the official MOD-10 scheme: 11 digits, the
// first never 0; the 10th digit is (7 * odd-position sum - even-position
// sum) mod 10, the 11th is the first ten's sum mod 10 (and always even).
export function isValidTurkishIdentityNumber(raw: string): boolean {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!/^[1-9][0-9]{10}$/.test(digits)) return false;
  const d = digits.split('').map(Number);
  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8];
  const evenSum = d[1] + d[3] + d[5] + d[7];
  if (d[9] !== (((oddSum * 7 - evenSum) % 10) + 10) % 10) return false;
  if (d[10] !== (oddSum + evenSum + d[9]) % 10) return false;
  return d[10] % 2 === 0;
}
