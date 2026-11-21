import { getCalendars } from 'expo-localization';

import { base64ToBytes } from './photo';
import { supabase } from './supabase';

// Updates the signed-in user's own profile row. Mirrors armusUpdateOwnProfile
// on the web - used for teacher-only fields like availability_dates that the
// profile-lock trigger deliberately leaves editable without admin approval.
export async function updateOwnProfile(updates: Record<string, unknown>): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase.from('profiles').update(updates).eq('id', user.id);
  return !error;
}

// The phone's own IANA time zone (null if it can't be read).
export function deviceTimeZone(): string | null {
  try {
    const fromOs = getCalendars()[0]?.timeZone;
    if (fromOs) return fromOs;
  } catch {
    // fall through to Intl
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

// Keeps profiles.timezone (migration_37.sql) on the zone the person is in
// now, like the website does on every visit (auth.js
// armusRefreshOwnTimezone); the app never wrote it. It matters most for a
// teacher: their weekly hours (availability_dates) are wall-clock times in
// this zone - the hours they tick in Programım on this phone's clock - and
// new bookings take it as their teacher_timezone, so a teacher abroad who
// only used the app was bookable at Istanbul-time hours they never meant.
// It also sets the time shown in lesson emails and reminders. Existing
// bookings keep the zone they were made in. Silent and best-effort: true
// when the row was changed.
export async function syncOwnTimezone(profile: { id: string; timezone?: string | null }): Promise<boolean> {
  const detected = deviceTimeZone();
  if (!detected || detected === profile.timezone) return false;
  const { error } = await supabase.from('profiles').update({ timezone: detected }).eq('id', profile.id);
  return !error;
}

// Uploads a profile photo to the "teacher-uploads" bucket at
// "<user id>/profile-<time>.jpg", the path the website's settings page uses
// (the bucket's insert policy only accepts the caller's own "<uid>/"
// folder - migration_74.sql).
//
// It takes the JPEG preparePhoto made, as base64, and sends the raw bytes:
//   - the bucket only accepts image/jpeg and image/png (migration_49.sql),
//     so a photo straight from the phone (often HEIC on an iPhone) was
//     refused - every photo is re-encoded to JPEG first now;
//   - a React Native Blob from fetch(file://...) uploads unreliably to
//     Supabase Storage (empty files, failed requests), bytes don't.
// Returns the public URL, or null on failure.
export async function uploadProfilePhoto(userId: string, jpegBase64: string): Promise<string | null> {
  try {
    const bytes = base64ToBytes(jpegBase64);
    if (!bytes.length) return null;
    const path = `${userId}/profile-${Date.now()}.jpg`;
    const { error } = await supabase.storage.from('teacher-uploads').upload(path, bytes, { upsert: true, contentType: 'image/jpeg' });
    if (error) {
      console.warn('profile photo upload failed', error.message);
      return null;
    }
    const { data } = supabase.storage.from('teacher-uploads').getPublicUrl(path);
    return data.publicUrl;
  } catch (err) {
    console.warn('profile photo upload failed', err);
    return null;
  }
}
