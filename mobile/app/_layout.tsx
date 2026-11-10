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
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../lib/auth';
import { registerForPushNotifications } from '../lib/push';
import { colors } from '../lib/theme';

// Registers this device for push once someone is signed in, and opens the
// screen a tapped notification points at (data.path, set by
// send-push-notification).
function PushNotifications() {
  const { profile } = useAuth();
  const lastResponse = Platform.OS === 'web' ? null : Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (profile) registerForPushNotifications();
  }, [profile?.id]);

  useEffect(() => {
    if (!profile || !lastResponse || lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const path = lastResponse.notification.request.content.data?.path;
    if (typeof path === 'string' && path.startsWith('/')) router.push(path as any);
    Notifications.clearLastNotificationResponse();
  }, [lastResponse, profile?.id]);

  return null;
}

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Keeps the launch screen up until the first real screen can be drawn:
 * fonts are in (this only mounts after they are) and the sign-in state is
 * known. Without it the launch screen gave way to a blank page with a
 * spinner first. A slow connection can't hold it for long - after a few
 * seconds it lets go anyway.
 */
function SplashGate() {
  const { loading } = useAuth();

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(() => {});
  }, [loading]);

  useEffect(() => {
    const timer = setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 5000);
    return () => clearTimeout(timer);
  }, []);

  return null;
}

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
      <AuthProvider>
        <SplashGate />
        <PushNotifications />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
