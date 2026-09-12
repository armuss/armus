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
