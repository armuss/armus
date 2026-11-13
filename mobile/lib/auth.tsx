import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    setProfile((data as Profile) ?? null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        loadProfile(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) {
        loadProfile(nextSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => sub.subscription.unsubscribe();
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
          if (session) await loadProfile(session.user.id);
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
