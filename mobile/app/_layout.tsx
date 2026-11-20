import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import { Unbounded_700Bold, Unbounded_800ExtraBold } from '@expo-google-fonts/unbounded';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { router, Stack, useRootNavigationState, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import LaunchAnimation from '../components/LaunchAnimation';
import { AuthProvider, needsEmailVerification, useAuth } from '../lib/auth';
import { LanguageProvider } from '../lib/i18n';
import { registerForPushNotifications } from '../lib/push';
import { colors } from '../lib/theme';

// Registers this device for push once someone is signed in, and opens the
// screen a tapped notification points at (data.path, set by
// send-push-notification).
function PushNotifications() {
  const { session, profile, loading } = useAuth();
  const lastResponse = Platform.OS === 'web' ? null : Notifications.useLastNotificationResponse();
  // a new account is asked about notifications once its email code is done,
  // not over the code screen
  const ready = !!profile && !needsEmailVerification(profile);

  useEffect(() => {
    if (!ready) return;
    registerForPushNotifications();
    // the phone's push token can change (an OS update, a restore): register
    // the new one, or the notifications stop arriving
    if (Platform.OS === 'web') return;
    const sub = Notifications.addPushTokenListener(() => registerForPushNotifications());
    return () => sub.remove();
  }, [profile?.id, ready]);

  useEffect(() => {
    if (!lastResponse || lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    // opened from a notification: wait until it's known who is signed in
    if (loading) return;
    // tapped while signed out: dropped, not kept for whoever signs in next
    // (their own lesson or someone else's chat would open for them)
    if (!session) {
      Notifications.clearLastNotificationResponse();
      return;
    }
    if (!ready) return;
    const path = lastResponse.notification.request.content.data?.path;
    // a screen of this app only: expo-router hands "//host/..." to the OS
    // as an outside web link (hasUrlProtocolPrefix)
    if (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')) router.push(path as any);
    Notifications.clearLastNotificationResponse();
  }, [lastResponse, profile?.id, ready, loading, !!session]);

  return null;
}

// The 6-digit email code holds on every screen, like the website's
// armusEnforceEmailVerification (every page but register/login/password
// reset). Only the tabs checked it, so a new, unconfirmed account reached
// booking, chat, a teacher's profile... through an armus:// link or a
// notification.
const OPEN_BEFORE_VERIFYING = new Set(['(auth)', 'verify-email', 'welcome']);

function EmailVerificationGate() {
  const { session, profile } = useAuth();
  const segments = useSegments();
  const navReady = !!useRootNavigationState()?.key;

  useEffect(() => {
    if (!navReady || !session || !needsEmailVerification(profile)) return;
    const first = segments[0] as string | undefined;
    // the start screen (no segment) sends a session to the tabs, which redirect
    if (!first || OPEN_BEFORE_VERIFYING.has(first)) return;
    router.replace('/verify-email');
  }, [navReady, session, profile, segments]);

  return null;
}

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Unbounded_700Bold,
    Unbounded_800ExtraBold,
  });

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <LanguageProvider>
      <AuthProvider>
        <PushNotifications />
        <EmailVerificationGate />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
        {/* over everything until it has played; it also lets go of the native launch screen */}
        <LaunchAnimation />
      </AuthProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}
