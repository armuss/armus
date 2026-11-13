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

// Uploads a local image to the same public "teacher-uploads" bucket and
// the same "<user id>/profile-<time>.<ext>" path the website's settings
// page uses. The bucket's insert policy only accepts paths inside the
// caller's own "<uid>/" folder (migration_74.sql) - the app used to write
// to "profile-photos/...", which that policy refused every time.
// Returns the public URL, or null on failure.
export async function uploadProfilePhoto(userId: string, localUri: string): Promise<string | null> {
  try {
    const response = await fetch(localUri);
    const blob = await response.blob();

    const rawExt = localUri.includes('.') ? localUri.split('.').pop()!.split('?')[0] : '';
    const ext = /^[a-zA-Z0-9]{1,10}$/.test(rawExt) ? rawExt.toLowerCase() : 'jpg';
    const path = `${userId}/profile-${Date.now()}.${ext}`;
    const contentType = blob.type || (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`);

    const { error } = await supabase.storage.from('teacher-uploads').upload(path, blob, { upsert: true, contentType });
    if (error) return null;

    const { data } = supabase.storage.from('teacher-uploads').getPublicUrl(path);
    return data.publicUrl;
  } catch {
    return null;
  }
}
