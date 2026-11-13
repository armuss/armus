import { tr } from './i18n';
// A teacher's full real name is never shown to a student anywhere in the
// UI - only "Ahmet Y." - so a student can't take that name off ARMUS and
// look the teacher up (or contact them) elsewhere, bypassing the platform
// entirely. Mirrors armusShortDisplayName on the web. The stored data
// (profiles.name, bookings.teacherName, etc.) keeps the real full name for
// admin/support purposes; this only affects what gets rendered, and is
// never applied to a student's name shown to their teacher.
export function shortDisplayName(fullName: string | null | undefined): string {
  const parts = capitalizeName(fullName).split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || tr("Öğretmen");
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// "arman cAN" -> "Arman Can": every word starts with a capital, whatever
// the person typed when signing up. Mirrors armusCapitalizeName on the web
// (plain upper/lower case, not Turkish rules, so "Mike" stays "Mike").
export function capitalizeName(fullName: string | null | undefined): string {
  return String(fullName || '')
    .trim()
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(' ');
}

// For Turkish words such as a city: "istanbul" -> "İstanbul", "IĞDIR" ->
// "Iğdır" - Turkish dotted/dotless i rules, which capitalizeName can't use
// because people's names here are often not Turkish ("isabel" stays Isabel).
export function capitalizeTurkish(text: string | null | undefined): string {
  const lower = (w: string) => w.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
  const upper = (c: string) => (c === 'i' ? 'İ' : c === 'ı' ? 'I' : c.toUpperCase());
  return String(text || '')
    .trim()
    .split(/\s+/)
    .map((word) => {
      const w = lower(word);
      return w ? upper(w[0]) + w.slice(1) : w;
    })
    .join(' ');
}
