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

// Uploads a local image (from expo-image-picker's asset.uri) to the same
// public "teacher-uploads" bucket the web's apply-teacher.html uses - its
// RLS lets any authenticated account write there, not just teachers (see
// migration_12.sql). Returns the public URL, or null on failure.
export async function uploadProfilePhoto(userId: string, localUri: string): Promise<string | null> {
  try {
    const response = await fetch(localUri);
    const blob = await response.blob();

    const ext = localUri.includes('.') ? localUri.split('.').pop()!.split('?')[0] : 'jpg';
    const path = `profile-photos/${userId}-${Date.now()}.${ext}`;

    const { error } = await supabase.storage
      .from('teacher-uploads')
      .upload(path, blob, { upsert: true, contentType: blob.type || `image/${ext}` });

    if (error) return null;

    const { data } = supabase.storage.from('teacher-uploads').getPublicUrl(path);
    return data.publicUrl;
  } catch {
    return null;
  }
}
