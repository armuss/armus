import AsyncStorage from '@react-native-async-storage/async-storage';

// A personal, per-device convenience (like a bookmark) - mirrors
// favorites.js on the web, which keeps this in localStorage rather than
// the database since it doesn't need to sync across devices or be
// visible to anyone else.
const KEY = 'armus_favorite_teachers';

export async function getFavorites(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function isFavorite(teacherId: string): Promise<boolean> {
  const favorites = await getFavorites();
  return favorites.includes(teacherId);
}

// Returns the new favorited state (true = now favorited).
export async function toggleFavorite(teacherId: string): Promise<boolean> {
  const favorites = await getFavorites();
  const index = favorites.indexOf(teacherId);
  const nowFavorited = index === -1;

  if (nowFavorited) {
    favorites.push(teacherId);
  } else {
    favorites.splice(index, 1);
  }

  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(favorites));
  } catch {
    // storage full/unavailable - favoriting silently no-ops
  }

  return nowFavorited;
}
