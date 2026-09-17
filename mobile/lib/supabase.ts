import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as aesjs from 'aes-js';
import { createClient } from '@supabase/supabase-js';

// Same project the web app (supabase-config.js) talks to, so accounts
// created on the site or in the app both work everywhere.
const ARMUS_SUPABASE_URL = 'https://rwdxubadjbwdsmrmgmkr.supabase.co';
const ARMUS_SUPABASE_ANON_KEY = 'sb_publishable_JpGfg8-vY2dJf-2XOa3Law_o4Uzegci';

// A Supabase session (access + refresh token, plus the user object) is a
// few KB - too big for SecureStore's own ~2KB-per-item limit (backed by
// the iOS Keychain / Android Keystore), but plain AsyncStorage stores it
// completely unencrypted on disk (a plain SQLite db on Android, plain
// files on iOS). Anyone with ADB/root access to the device, or an
// unencrypted local backup, could previously read the refresh token
// straight out of that file and mint fresh sessions indefinitely - a
// silent, persistent account takeover that survives the user changing
// their password on-device. This is Supabase's own documented pattern
// for React Native: generate a random AES-256 key per storage key, keep
// ONLY that (small) key in SecureStore, and store the (large) encrypted
// session blob in AsyncStorage - so what's on disk outside the OS
// keystore is useless without it.
class LargeSecureStore {
  private async _encrypt(key: string, value: string) {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));

    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));

    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));

    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async _decrypt(key: string, value: string) {
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) {
      return null;
    }

    const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(encryptionKeyHex), new aesjs.Counter(1));
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));

    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async getItem(key: string) {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return encrypted;
    return await this._decrypt(key, encrypted);
  }

  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }

  async setItem(key: string, value: string) {
    const encrypted = await this._encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }
}

export const supabase = createClient(ARMUS_SUPABASE_URL, ARMUS_SUPABASE_ANON_KEY, {
  auth: {
    storage: new LargeSecureStore() as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
