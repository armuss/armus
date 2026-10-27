import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from './supabase';

// Phone push notifications (migration_111.sql's expo_push_tokens; sent by
// the send-push-notification Edge Function through Expo's push service):
// a new booking (teacher), a new message, a lesson starting within the
// hour (both sides). Every notification carries data.path - the app
// screen a tap opens.

// shown while the app is open too (no native module on the web build)
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

let registeredToken: string | null = null;

function easProjectId(): string | undefined {
  return (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId ?? undefined;
}

// Asks for permission (once - the OS remembers the answer) and stores this
// device's Expo push token for the signed-in user (register_expo_push_token).
// Quietly does nothing on the web build, a simulator, without permission,
// or before the app has an EAS project id (`eas init`, see the publishing
// notes) - push simply stays off there, nothing else depends on it.
export async function registerForPushNotifications() {
  try {
    if (Platform.OS === 'web' || !Device.isDevice) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'ARMUS',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return;

    const projectId = easProjectId();
    if (!projectId) {
      console.warn('push: no EAS projectId yet (run `eas init`) - skipping registration');
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    // moves the row over if someone else was signed in on this phone before
    const { error } = await supabase.rpc('register_expo_push_token', { p_token: token, p_platform: Platform.OS });
    if (error) throw error;
    registeredToken = token;
  } catch (err) {
    console.warn('push registration failed', err);
  }
}

// On sign-out: this device stops getting the signed-out user's notifications.
export async function unregisterPushNotifications() {
  if (!registeredToken) return;
  try {
    await supabase.from('expo_push_tokens').delete().eq('token', registeredToken);
  } catch {
    // the row is cleaned up anyway the first time Expo reports the token gone
  }
  registeredToken = null;
}
