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

import LaunchAnimation from '../components/LaunchAnimation';
import { AuthProvider, useAuth } from '../lib/auth';
import { LanguageProvider } from '../lib/i18n';
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
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
        {/* over everything until it has played; it also lets go of the native launch screen */}
        <LaunchAnimation />
      </AuthProvider>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}
