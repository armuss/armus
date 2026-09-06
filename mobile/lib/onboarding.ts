import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'armus_onboarding_seen';

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === 'true';
  } catch {
    return true;
  }
}

export async function markOnboardingSeen() {
  try {
    await AsyncStorage.setItem(KEY, 'true');
  } catch {
    // ignore - worst case the user sees onboarding again next launch
  }
}
