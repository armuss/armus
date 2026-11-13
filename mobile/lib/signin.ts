import { invokeEdge } from './edge';
import { ARMUS_SUPABASE_ANON_KEY, supabase } from './supabase';
import { tr } from './i18n';

// Signs in through the login-with-throttle Edge Function, exactly like the
// website (auth.js armusSignIn) - never with signInWithPassword directly,
// which has no limit on how many passwords can be tried against one email
// (the function allows a handful, then "15 dakika sonra tekrar dene").
// It also records the sign-in for the account's security log.
export async function signInThrottled(email: string, password: string): Promise<{ error: string | null }> {
  const res = await invokeEdge<{ access_token?: string; refresh_token?: string }>('login-with-throttle', {
    email: email.trim(),
    password,
    anon_key: ARMUS_SUPABASE_ANON_KEY,
  });
  if (!res.ok || !res.data?.access_token || !res.data?.refresh_token) {
    return { error: (!res.ok && res.error) || tr("E-posta veya şifre hatalı.") };
  }
  const { error } = await supabase.auth.setSession({ access_token: res.data.access_token, refresh_token: res.data.refresh_token });
  return { error: error ? tr("Giriş yapılamadı. Lütfen tekrar dene.") : null };
}
