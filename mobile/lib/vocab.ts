import { supabase } from './supabase';

// The student's word cards (Kelime kartlarım) - the same vocab_entries rows
// the website's student panel reads and writes (student-extras.js), so a
// word added here shows up there and the other way round. Each row is the
// student's own (vocab_entries_all_own); a teacher can also pin a word in
// mid-lesson from the class screen.
export type VocabEntry = {
  id: string;
  term: string;
  meaning: string;
  category: string;
  mastered: boolean;
  createdAt: string;
};

function mapEntry(row: any): VocabEntry {
  return {
    id: row.id,
    term: row.term,
    meaning: row.meaning,
    category: row.category || 'Genel',
    mastered: !!row.mastered,
    createdAt: row.created_at,
  };
}

// newest first, capped like the website (far above any real deck)
export async function getVocabEntries(studentId: string): Promise<VocabEntry[] | null> {
  const { data, error } = await supabase
    .from('vocab_entries')
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) return null;
  return (data || []).map(mapEntry);
}

export async function addVocabEntry(studentId: string, term: string, meaning: string, category: string): Promise<VocabEntry | null> {
  const { data, error } = await supabase
    .from('vocab_entries')
    .insert({ student_id: studentId, term, meaning, category: category || 'Genel' })
    .select()
    .single();
  if (error || !data) return null;
  return mapEntry(data);
}

export async function deleteVocabEntry(id: string): Promise<boolean> {
  const { error } = await supabase.from('vocab_entries').delete().eq('id', id);
  return !error;
}

// "I know this one" - no schedule, just a flag the student flips either way
export async function setVocabMastered(id: string, mastered: boolean): Promise<VocabEntry | null> {
  const { data, error } = await supabase.from('vocab_entries').update({ mastered }).eq('id', id).select().single();
  if (error || !data) return null;
  return mapEntry(data);
}
