import {
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import {
  Poppins_700Bold,
  Poppins_800ExtraBold,
  Poppins_900Black,
} from '@expo-google-fonts/poppins';
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

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Nunito_400Regular,
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
    Poppins_900Black,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <PushNotifications />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
