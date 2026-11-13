import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Band from '../components/Band';
import { useAuth } from '../lib/auth';
import { colors, fonts, radius } from '../lib/theme';
import { addVocabEntry, deleteVocabEntry, getVocabEntries, setVocabMastered, type VocabEntry } from '../lib/vocab';

const ALL = 'Tümü';

/**
 * Kelime kartlarım: study the student's word cards one at a time - tap to
 * turn the card over, "Öğrendim" to mark it known (and hide known ones if
 * they like), filter by category, add a new word, delete one. The same
 * cards as the website's student panel.
 */
export default function Words() {
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ add?: string }>();
  const [entries, setEntries] = useState<VocabEntry[] | null>(null);
  const [category, setCategory] = useState(ALL);
  const [hideMastered, setHideMastered] = useState(false);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [adding, setAdding] = useState(params.add === '1');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    getVocabEntries(profile.id).then((list) => setEntries(list ?? []));
  }, [profile?.id]);

  const categories = useMemo(() => [...new Set((entries ?? []).map((e) => e.category))].sort((a, b) => a.localeCompare(b, 'tr')), [entries]);
  const deck = useMemo(
    () => (entries ?? []).filter((e) => (category === ALL || e.category === category) && (!hideMastered || !e.mastered)),
    [entries, category, hideMastered]
  );
  const current = deck.length ? deck[Math.min(index, deck.length - 1)] : null;
  const position = current ? deck.indexOf(current) : -1;

  function go(step: number) {
    if (!deck.length) return;
    setFlipped(false);
    setIndex((position + step + deck.length) % deck.length);
  }

  function pickCategory(c: string) {
    setCategory(c);
    setIndex(0);
    setFlipped(false);
  }

  async function toggleMastered() {
    if (!current || busy) return;
    setBusy(true);
    const updated = await setVocabMastered(current.id, !current.mastered);
    setBusy(false);
    if (!updated) {
      Alert.alert('Kaydedilemedi', 'Lütfen tekrar dene.');
      return;
    }
    setEntries((prev) => (prev ?? []).map((e) => (e.id === updated.id ? updated : e)));
    setFlipped(false);
    // a card marked known disappears when known ones are hidden; otherwise move on
    if (!(hideMastered && updated.mastered)) setIndex(deck.length ? (position + 1) % deck.length : 0);
  }

  function confirmDelete() {
    if (!current) return;
    Alert.alert('Kartı sil', `"${current.term}" kartı silinsin mi?`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          const ok = await deleteVocabEntry(current.id);
          if (!ok) {
            Alert.alert('Silinemedi', 'Lütfen tekrar dene.');
            return;
          }
          setEntries((prev) => (prev ?? []).filter((e) => e.id !== current.id));
          setFlipped(false);
        },
      },
    ]);
  }

  function onAdded(entry: VocabEntry) {
    setEntries((prev) => [entry, ...(prev ?? [])]);
    // show the new card right away
    setCategory(ALL);
    setHideMastered(false);
    setIndex(0);
    setFlipped(false);
    setAdding(false);
  }

  const learned = (entries ?? []).filter((e) => e.mastered).length;

  return (
    <View style={styles.screen}>
      <Band height={112} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.head}>
          <Pressable onPress={() => router.back()} style={styles.roundBtn} accessibilityLabel="Geri">
            <Ionicons name="chevron-back" size={20} color={colors.onRed} />
          </Pressable>
          <View style={styles.headText}>
            <Text style={styles.title}>Kelime kartlarım</Text>
            {!!entries?.length && (
              <Text style={styles.sub}>
                {entries.length} kelime · {learned} öğrendin
              </Text>
            )}
          </View>
          <Pressable onPress={() => setAdding(true)} style={styles.roundBtn} accessibilityLabel="Kelime ekle">
            <Ionicons name="add" size={22} color={colors.onRed} />
          </Pressable>
        </View>

        {entries === null ? (
          <ActivityIndicator color={colors.onRed} style={{ marginTop: 60 }} />
        ) : entries.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="albums-outline" size={30} color={colors.red} />
            </View>
            <Text style={styles.emptyTitle}>Henüz kelimen yok</Text>
            <Text style={styles.emptyText}>Derste öğrendiğin kelimeleri anlamlarıyla birlikte ekle, sonra kart kart çalış.</Text>
            <Pressable onPress={() => setAdding(true)} style={styles.primary}>
              <Ionicons name="add" size={18} color={colors.onRed} />
              <Text style={styles.primaryText}>İlk kelimeni ekle</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsInner}>
              {[ALL, ...categories].map((c) => (
                <Pressable key={c} onPress={() => pickCategory(c)} style={[styles.chip, category === c && styles.chipOn]}>
                  <Text style={[styles.chipText, category === c && styles.chipTextOn]}>
                    {c === ALL ? `${ALL} · ${(entries ?? []).filter((e) => !hideMastered || !e.mastered).length}` : c}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {current ? (
              <Pressable onPress={() => setFlipped((f) => !f)} style={styles.cardWrap} accessibilityRole="button" accessibilityLabel="Kartı çevir">
                <View style={styles.cardBack} />
                <View style={styles.card}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cat}>{current.category}</Text>
                    {current.mastered && (
                      <View style={styles.knownTag}>
                        <Ionicons name="checkmark" size={12} color={colors.petrol} />
                        <Text style={styles.knownText}>Öğrendin</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.term} adjustsFontSizeToFit numberOfLines={2}>
                    {current.term}
                  </Text>
                  {flipped && <Text style={styles.meaning}>{current.meaning}</Text>}
                  <View style={styles.hint}>
                    <Ionicons name="sync-outline" size={13} color={colors.muted} />
                    <Text style={styles.hintText}>{flipped ? 'Kelimeye dönmek için dokun' : 'Anlamını görmek için dokun'}</Text>
                  </View>
                  <Pressable onPress={confirmDelete} hitSlop={10} style={styles.trash} accessibilityLabel="Kartı sil">
                    <Ionicons name="trash-outline" size={17} color={colors.faint} />
                  </Pressable>
                </View>
              </Pressable>
            ) : (
              <View style={[styles.cardWrap, styles.doneBox]}>
                <Ionicons name="checkmark-done" size={30} color={colors.petrol} />
                <Text style={styles.doneTitle}>Burada çalışılacak kart kalmadı</Text>
                <Text style={styles.doneText}>Öğrendiklerini gizlemeyi kapat ya da başka bir kategori seç.</Text>
              </View>
            )}

            <View style={styles.progressRow}>
              <Text style={styles.progressText}>{current ? `${position + 1} / ${deck.length}` : `0 / 0`}</Text>
              <View style={styles.track}>
                <View style={[styles.trackFill, { width: deck.length ? `${((position + 1) / deck.length) * 100}%` : '0%' }]} />
              </View>
              <Text style={styles.progressText}>Öğrendiklerimi gizle</Text>
              <Switch
                value={hideMastered}
                onValueChange={(v) => {
                  setHideMastered(v);
                  setIndex(0);
                  setFlipped(false);
                }}
                trackColor={{ true: colors.red, false: colors.border }}
                thumbColor="#ffffff"
                ios_backgroundColor={colors.border}
                style={{ transform: [{ scale: 0.85 }] }}
              />
            </View>

            <View style={styles.controls}>
              <Pressable onPress={() => go(-1)} style={styles.navBtn} accessibilityLabel="Önceki kart" disabled={!current}>
                <Ionicons name="chevron-back" size={22} color={colors.ink} />
              </Pressable>
              <Pressable onPress={toggleMastered} disabled={!current || busy} style={[styles.knowBtn, current?.mastered && styles.knowBtnUndo]}>
                {busy ? (
                  <ActivityIndicator color={current?.mastered ? colors.petrol : '#fff'} />
                ) : (
                  <>
                    <Ionicons name={current?.mastered ? 'refresh' : 'checkmark'} size={18} color={current?.mastered ? colors.petrol : '#fff'} />
                    <Text style={[styles.knowText, current?.mastered && { color: colors.petrol }]}>
                      {current?.mastered ? 'Tekrar çalış' : 'Öğrendim'}
                    </Text>
                  </>
                )}
              </Pressable>
              <Pressable onPress={() => go(1)} style={styles.navBtn} accessibilityLabel="Sonraki kart" disabled={!current}>
                <Ionicons name="chevron-forward" size={22} color={colors.ink} />
              </Pressable>
            </View>
          </>
        )}
      </SafeAreaView>

      {profile && (
        <AddWordSheet visible={adding} studentId={profile.id} categories={categories} onClose={() => setAdding(false)} onAdded={onAdded} />
      )}
    </View>
  );
}

function AddWordSheet({
  visible,
  studentId,
  categories,
  onClose,
  onAdded,
}: {
  visible: boolean;
  studentId: string;
  categories: string[];
  onClose: () => void;
  onAdded: (entry: VocabEntry) => void;
}) {
  const [term, setTerm] = useState('');
  const [meaning, setMeaning] = useState('');
  const [category, setCategory] = useState('Genel');
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setTerm('');
      setMeaning('');
      setNewCategory(null);
      setError('');
    }
  }, [visible]);

  const options = [...new Set(['Genel', ...categories])];

  async function save() {
    const t = term.trim();
    const m = meaning.trim();
    const c = (newCategory ?? category).trim() || 'Genel';
    if (!t || !m) {
      setError('Kelimeyi ve anlamını yaz.');
      return;
    }
    setSaving(true);
    const entry = await addVocabEntry(studentId, t, m, c);
    setSaving(false);
    if (!entry) {
      setError('Kaydedilemedi. Lütfen tekrar dene.');
      return;
    }
    setCategory(c);
    onAdded(entry);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.shade} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap} pointerEvents="box-none">
        <View style={styles.sheet}>
          <View style={styles.grab} />
          <Text style={styles.sheetTitle}>Yeni kelime</Text>

          <Text style={styles.label}>Kelime</Text>
          <TextInput
            value={term}
            onChangeText={setTerm}
            placeholder="ör. deadline"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            autoFocus
          />
          <Text style={styles.label}>Anlamı</Text>
          <TextInput value={meaning} onChangeText={setMeaning} placeholder="ör. son teslim tarihi" placeholderTextColor={colors.faint} style={styles.input} />

          <Text style={styles.label}>Kategori</Text>
          <View style={styles.catRow}>
            {options.map((c) => (
              <Pressable
                key={c}
                onPress={() => {
                  setCategory(c);
                  setNewCategory(null);
                }}
                style={[styles.catChip, newCategory === null && category === c && styles.catChipOn]}
              >
                <Text style={[styles.catChipText, newCategory === null && category === c && styles.catChipTextOn]}>{c}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setNewCategory('')} style={[styles.catChip, newCategory !== null && styles.catChipOn]}>
              <Text style={[styles.catChipText, newCategory !== null && styles.catChipTextOn]}>+ Yeni kategori</Text>
            </Pressable>
          </View>
          {newCategory !== null && (
            <TextInput
              value={newCategory}
              onChangeText={setNewCategory}
              placeholder="Kategori adı (ör. IELTS)"
              placeholderTextColor={colors.faint}
              style={[styles.input, { marginTop: 10 }]}
            />
          )}

          {!!error && <Text style={styles.error}>{error}</Text>}

          <Pressable onPress={save} disabled={saving} style={[styles.primary, { marginTop: 18, alignSelf: 'stretch' }]}>
            {saving ? (
              <ActivityIndicator color={colors.onRed} />
            ) : (
              <>
                <Ionicons name="add" size={18} color={colors.onRed} />
                <Text style={styles.primaryText}>Kartı ekle</Text>
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1, backgroundColor: 'transparent' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12 },
  headText: { flex: 1, alignItems: 'center' },
  title: { fontFamily: fonts.bodyExtraBold, fontSize: 16, color: colors.onRed },
  sub: { fontFamily: fonts.bodyMedium, fontSize: 12, color: 'rgba(250,245,226,0.8)', marginTop: 1 },
  roundBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(250,245,226,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(250,245,226,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  chips: { flexGrow: 0 },
  chipsInner: { paddingHorizontal: 16, gap: 7 },
  chip: {
    backgroundColor: 'rgba(250,245,226,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(250,245,226,0.3)',
    borderRadius: radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  chipOn: { backgroundColor: colors.cream, borderColor: colors.cream },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.onRed },
  chipTextOn: { color: colors.red },

  cardWrap: { height: 330, marginHorizontal: 22, marginTop: 18 },
  cardBack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 26,
    backgroundColor: colors.champagne,
    borderWidth: 1,
    borderColor: colors.champagneDeep,
    transform: [{ rotate: '-4deg' }, { translateX: -6 }, { translateY: 10 }],
  },
  card: {
    flex: 1,
    borderRadius: 26,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    shadowColor: colors.redDeep,
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cat: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.champagneText,
    backgroundColor: colors.champagne,
    borderWidth: 1,
    borderColor: colors.champagneDeep,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  knownTag: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.petrolSoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  knownText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.petrol },
  term: { fontFamily: fonts.display, fontSize: 32, color: colors.ink, letterSpacing: -1, textAlign: 'center' },
  meaning: {
    fontFamily: fonts.bodyMedium,
    fontSize: 17,
    lineHeight: 24,
    color: '#3a3a3a',
    textAlign: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.champagneDeep,
    borderStyle: 'dashed',
    paddingTop: 12,
    alignSelf: 'stretch',
  },
  hint: { position: 'absolute', bottom: 16, flexDirection: 'row', alignItems: 'center', gap: 6 },
  hintText: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  trash: { position: 'absolute', top: 14, right: 14 },
  doneBox: {
    borderRadius: 26,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.champagneDeep,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  doneTitle: { fontFamily: fonts.bodyExtraBold, fontSize: 16, color: colors.ink, textAlign: 'center' },
  doneText: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.muted, textAlign: 'center' },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 22, marginTop: 22 },
  progressText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.muted },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#f0e7d8', overflow: 'hidden' },
  trackFill: { height: '100%', borderRadius: 3, backgroundColor: colors.petrol },

  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 22 },
  navBtn: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  knowBtn: { minWidth: 150, height: 54, borderRadius: 27, backgroundColor: colors.petrol, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20 },
  knowBtnUndo: { backgroundColor: colors.petrolSoft },
  knowText: { fontFamily: fonts.bodyExtraBold, fontSize: 14.5, color: '#fff' },

  empty: { alignItems: 'center', marginTop: 70, paddingHorizontal: 32, gap: 10 },
  emptyIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  emptyTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.ink, marginTop: 6 },
  emptyText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: 'center', marginBottom: 8 },
  primary: { height: 50, borderRadius: 16, backgroundColor: colors.red, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20 },
  primaryText: { fontFamily: fonts.bodyExtraBold, fontSize: 15, color: colors.onRed },

  shade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(20,6,8,0.45)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 34 },
  grab: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.silver2, alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.ink, letterSpacing: -0.5 },
  label: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.muted, marginTop: 14, marginBottom: 6, marginLeft: 2 },
  input: {
    height: 50,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#e8ddcc',
    backgroundColor: colors.panel,
    paddingHorizontal: 15,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  catChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.panel, borderWidth: 1, borderColor: '#e8ddcc' },
  catChipOn: { backgroundColor: colors.red, borderColor: colors.red },
  catChipText: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.ink },
  catChipTextOn: { color: colors.onRed },
  error: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.error, marginTop: 12 },
});
