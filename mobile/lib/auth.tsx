import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { unregisterPushNotifications } from './push';
import { supabase } from './supabase';
import { useT, tr } from './i18n';

export type Profile = {
  id: string;
  email: string;
  name: string;
  role: 'student' | 'teacher';
  is_admin: boolean;
  city: string | null;
  photo_url: string | null;
  // IANA zone - a teacher's lesson times are wall-clock in it
  timezone?: string | null;
  // the invite code behind armus.com.tr/register?ref=... (Arkadaşını davet et)
  referral_code?: string | null;
  // the 6-digit email code (send-verification-email / verify-email-code)
  email_verified?: boolean | null;
  created_at?: string | null;
  // teachers: 'pending' | 'approved' | 'rejected'
  status?: string | null;
  // teachers: attendance-report hide / ban state (migration_41, 100, 104)
  is_banned?: boolean | null;
  hidden_from_new_students?: boolean | null;
  hidden_until?: string | null;
  hidden_reason?: string | null;
  penalty_hide_reason?: string | null;
  trial_hidden_tier?: number | null;
  trial_noshow_count?: number | null;
  trial_unhide_eligible_at?: string | null;
  trial_unhide_requires_ack?: boolean | null;
};

// Same rule as the website (auth.js): accounts created from this date on
// must confirm their email with the 6-digit code before using anything
// else; older accounts are grandfathered in.
const EMAIL_VERIFICATION_REQUIRED_FROM = new Date('2026-09-29T00:00:00Z');

export function needsEmailVerification(profile: Profile | null | undefined): boolean {
  return !!profile && !profile.email_verified && !!profile.created_at && new Date(profile.created_at) >= EMAIL_VERIFICATION_REQUIRED_FROM;
}

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  deleteAccount: () => Promise<{ ok: true } | { ok: false; error: string }>;
};

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
  deleteAccount: async () => ({ ok: false, error: tr("Giriş yapmalısın.") }),
});

// The same row read again: only a teacher's presence beat (last_active_at,
// written every 2 minutes) differs, which no screen shows for oneself.
function sameProfile(a: Profile, b: Profile): boolean {
  const strip = ({ last_active_at, ...rest }: any) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  // whose session this is now: a profile read that answers after a sign-out,
  // or after someone else signed in on this phone, must not land on them
  const userIdRef = useRef<string | null>(null);

  async function loadProfile(userId: string) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (userIdRef.current !== userId) return;
    // a failed read (no network) keeps the profile we have - wiping it turned
    // a teacher into a student and back until the next successful read
    if (error) return;
    const next = (data as Profile) ?? null;
    // the same data keeps the same object, so the screens' effects that
    // depend on the profile don't all reload for nothing
    setProfile((prev) => (prev && next && sameProfile(prev, next) ? prev : next));
  }

  useEffect(() => {
    // INITIAL_SESSION (the session restored from the phone, or none) first,
    // then every sign-in, token refresh and sign-out
    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextId = nextSession?.user.id ?? null;
      setSession(nextSession);
      if (!nextId) {
        userIdRef.current = null;
        setProfile(null);
        setLoading(false);
        return;
      }
      if (nextId === userIdRef.current) return; // a token refresh: same person, same profile
      // someone (else) signed in: the app waits for their profile, so a
      // teacher never sees the student tabs first and a new account the
      // app before its email code
      userIdRef.current = nextId;
      setProfile(null);
      setLoading(true);
      loadProfile(nextId).finally(() => {
        if (userIdRef.current === nextId) setLoading(false);
      });
    });

    // back in the app: read the profile again (an approval, a ban, or a
    // first read that failed offline); unchanged, it stays the same object
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active' && userIdRef.current) loadProfile(userIdRef.current);
    });

    return () => {
      sub.subscription.unsubscribe();
      appState.remove();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        signOut: async () => {
          // while still signed in - the token row is the user's own (RLS)
          await unregisterPushNotifications();
          await supabase.auth.signOut();
        },
        refreshProfile: async () => {
          if (userIdRef.current) await loadProfile(userIdRef.current);
        },
        deleteAccount: async () => {
          const { data, error } = await supabase.functions.invoke('delete-account');
          if (error || !data?.ok) {
            return { ok: false, error: (data && data.error) || t("Hesap silinemedi. Lütfen tekrar dene.") };
          }
          await supabase.auth.signOut();
          return { ok: true };
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
