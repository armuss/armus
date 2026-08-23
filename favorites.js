/*
 * ARMUS - favorite teachers.
 * A personal, per-browser convenience (like a bookmark), so it lives in
 * localStorage rather than the database - it doesn't need to sync across
 * devices or be visible to anyone else.
 */

const ARMUS_FAVORITES_KEY = "armus_favorite_teachers";

function armusGetFavorites() {
  try {
    return JSON.parse(localStorage.getItem(ARMUS_FAVORITES_KEY)) || [];
  } catch {
    return [];
  }
}

function armusIsFavorite(teacherId) {
  return armusGetFavorites().includes(teacherId);
}

// Returns the new favorited state (true = now favorited).
function armusToggleFavorite(teacherId) {

  const favorites = armusGetFavorites();
  const index = favorites.indexOf(teacherId);
  const nowFavorited = index === -1;

  if (nowFavorited) {
    favorites.push(teacherId);
  } else {
    favorites.splice(index, 1);
  }

  try {
    localStorage.setItem(ARMUS_FAVORITES_KEY, JSON.stringify(favorites));
  } catch {
    // localStorage full/unavailable - favoriting silently no-ops
  }

  return nowFavorited;
}
