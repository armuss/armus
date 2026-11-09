import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Words and a short note the user jots down during a lesson (the class
 * room's bottom panel). Kept on this device only, one entry per lesson.
 */
export type LessonNotes = { words: string[]; note: string };

const key = (bookingId: string) => `armus_lesson_notes_${bookingId}`;

export async function getLessonNotes(bookingId: string): Promise<LessonNotes> {
  try {
    const raw = await AsyncStorage.getItem(key(bookingId));
    if (!raw) return { words: [], note: '' };
    const parsed = JSON.parse(raw);
    return {
      words: Array.isArray(parsed.words) ? parsed.words.filter((w: unknown) => typeof w === 'string') : [],
      note: typeof parsed.note === 'string' ? parsed.note : '',
    };
  } catch {
    return { words: [], note: '' };
  }
}

export async function saveLessonNotes(bookingId: string, notes: LessonNotes) {
  try {
    await AsyncStorage.setItem(key(bookingId), JSON.stringify(notes));
  } catch {
    // a full or unavailable store only loses the jotted words, never the lesson
  }
}
