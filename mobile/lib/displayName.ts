// A teacher's full real name is never shown to a student anywhere in the
// UI - only "Ahmet Y." - so a student can't take that name off ARMUS and
// look the teacher up (or contact them) elsewhere, bypassing the platform
// entirely. Mirrors armusShortDisplayName on the web. The stored data
// (profiles.name, bookings.teacherName, etc.) keeps the real full name for
// admin/support purposes; this only affects what gets rendered, and is
// never applied to a student's name shown to their teacher.
export function shortDisplayName(fullName: string | null | undefined): string {
  const parts = String(fullName || '').trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || 'Öğretmen';
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
