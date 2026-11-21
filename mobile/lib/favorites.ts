import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';

// A personal, per-device convenience (like a bookmark) - mirrors
// favorites.js on the web, which keeps this in localStorage rather than
// the database since it doesn't need to sync across devices or be
// visible to anyone else.
const KEY = 'armus_favorite_teachers';

// One list per person signed in on this phone: with a single list, whoever
// signed in after someone else saw (and changed) that person's favourite
// teachers. The list kept from before goes to the first account that opens
// its favourites here - in practice the phone's owner.
async function storageKey(): Promise<string> {
  let uid: string | undefined;
  try {
    const { data } = await supabase.auth.getSession();
    uid = data.session?.user.id;
  } catch {
    uid = undefined;
  }
  if (!uid) return KEY;
  const own = `${KEY}:${uid}`;
  try {
    const legacy = await AsyncStorage.getItem(KEY);
    if (legacy !== null) {
      if ((await AsyncStorage.getItem(own)) === null) await AsyncStorage.setItem(own, legacy);
      await AsyncStorage.removeItem(KEY);
    }
  } catch {
    // the old list just stays where it was
  }
  return own;
}

// Every change reads the list, edits it and writes it back - unlike the
// website's synchronous localStorage, AsyncStorage awaits in between, so
// two hearts tapped in quick succession both read the old list and the
// second write dropped the first one. Changes now run one after another,
// and a read waits for the ones already on their way.
let queue: Promise<unknown> = Promise.resolve();

export async function getFavorites(): Promise<string[]> {
  await queue;
  return readFavorites(await storageKey());
}

async function readFavorites(key: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export async function isFavorite(teacherId: string): Promise<boolean> {
  const favorites = await getFavorites();
  return favorites.includes(teacherId);
}

function change(edit: (favorites: string[]) => boolean): Promise<boolean> {
  const run = queue.then(async () => {
    const key = await storageKey();
    const favorites = await readFavorites(key);
    const nowFavorited = edit(favorites);
    try {
      await AsyncStorage.setItem(key, JSON.stringify(favorites));
    } catch {
      // storage full/unavailable - favoriting silently no-ops
    }
    return nowFavorited;
  });
  queue = run.catch(() => {});
  return run;
}

// Returns the new favorited state (true = now favorited).
export function toggleFavorite(teacherId: string): Promise<boolean> {
  return change((favorites) => {
    const index = favorites.indexOf(teacherId);
    if (index === -1) {
      favorites.push(teacherId);
      return true;
    }
    favorites.splice(index, 1);
    return false;
  });
}

// Sets one teacher's state outright (a screen that already shows the
// heart's state, so a double tap can't flip it back behind the screen).
export function setFavorite(teacherId: string, on: boolean): Promise<boolean> {
  return change((favorites) => {
    const index = favorites.indexOf(teacherId);
    if (on && index === -1) favorites.push(teacherId);
    if (!on && index !== -1) favorites.splice(index, 1);
    return on;
  });
}
