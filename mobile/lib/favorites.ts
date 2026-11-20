import AsyncStorage from '@react-native-async-storage/async-storage';

// A personal, per-device convenience (like a bookmark) - mirrors
// favorites.js on the web, which keeps this in localStorage rather than
// the database since it doesn't need to sync across devices or be
// visible to anyone else.
const KEY = 'armus_favorite_teachers';

// Every change reads the list, edits it and writes it back - unlike the
// website's synchronous localStorage, AsyncStorage awaits in between, so
// two hearts tapped in quick succession both read the old list and the
// second write dropped the first one. Changes now run one after another,
// and a read waits for the ones already on their way.
let queue: Promise<unknown> = Promise.resolve();

export async function getFavorites(): Promise<string[]> {
  await queue;
  return readFavorites();
}

async function readFavorites(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
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
    const favorites = await readFavorites();
    const nowFavorited = edit(favorites);
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(favorites));
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
