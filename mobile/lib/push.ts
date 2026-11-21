import AsyncStorage from '@react-native-async-storage/async-storage';
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
    // switched off in Profil > Bildirimler: this phone stays unregistered
    if (!(await getPushEnabled())) return;

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
    // kept on the phone too, so a sign-out can take it off the account even
    // when this run of the app never got to register (no network at launch)
    try {
      await AsyncStorage.setItem(TOKEN_KEY, token);
      await AsyncStorage.removeItem(UNBIND_KEY);
    } catch {
      // only the clean-up on sign-out leans on this
    }
  } catch (err) {
    console.warn('push registration failed', err);
  }
}

// this phone's token while it is on someone's account
const TOKEN_KEY = 'armus_push_token';
// a sign-out whose token removal didn't go through yet (tried again later)
const UNBIND_KEY = 'armus_push_unbind';

async function readKey(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

// Deletes this phone's row: unregister_expo_push_token (migration_129.sql)
// works signed in or out; until that migration has run, the plain delete,
// which RLS allows only while still signed in.
async function removeToken(token: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('unregister_expo_push_token', { p_token: token });
    if (!error) return true;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return false;
    const { error: deleteError } = await supabase.from('expo_push_tokens').delete().eq('token', token);
    return !deleteError;
  } catch {
    return false;
  }
}

// Takes this phone off the account's notifications: on sign-out (before
// the session goes) and when the switch in Profil is turned off. A removal
// that doesn't go through (no network) is kept and tried again by
// releasePushToken, so a signed-out phone doesn't go on getting that
// person's lesson and message notifications.
export async function unregisterPushNotifications() {
  const token = registeredToken ?? (await readKey(TOKEN_KEY)) ?? (await readKey(UNBIND_KEY));
  registeredToken = null;
  if (!token) return;
  const removed = await removeToken(token);
  try {
    await AsyncStorage.removeItem(TOKEN_KEY);
    if (removed) await AsyncStorage.removeItem(UNBIND_KEY);
    else await AsyncStorage.setItem(UNBIND_KEY, token);
  } catch {
    // nothing more to do on this phone
  }
}

// Signed out, however it happened (the sign-out button, or the session
// ending on the server, when the app's own clean-up never ran): finishes
// taking the token off the account, and clears that person's
// notifications from the phone, so nobody opens them after them.
export async function releasePushToken() {
  if (Platform.OS === 'web') return;
  Notifications.dismissAllNotificationsAsync().catch(() => {});
  if (registeredToken || (await readKey(TOKEN_KEY)) || (await readKey(UNBIND_KEY))) {
    await unregisterPushNotifications();
  }
}

// Profil > Bildirimler: a per-phone switch. Off removes this phone's token
// (no more lesson / message notifications here); on registers it again.
const PUSH_OFF_KEY = 'armus_push_off';

export async function getPushEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PUSH_OFF_KEY)) !== 'true';
  } catch {
    return true;
  }
}

export async function setPushEnabled(enabled: boolean) {
  try {
    if (enabled) await AsyncStorage.removeItem(PUSH_OFF_KEY);
    else await AsyncStorage.setItem(PUSH_OFF_KEY, 'true');
  } catch {
    // the switch just won't survive a restart
  }
  if (enabled) await registerForPushNotifications();
  else await unregisterPushNotifications();
}
