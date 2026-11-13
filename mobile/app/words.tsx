import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
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
import { colors, fonts, radius, redGradient } from '../lib/theme';
import { addVocabEntry, deleteVocabEntry, getVocabEntries, setVocabMastered, type VocabEntry } from '../lib/vocab';
import { useT } from '../lib/i18n';

const ALL = 'Tümü';

/**
 * Kelime kartlarım: study the student's word cards one at a time - tap to
 * turn the card over, "Öğrendim" to mark it known (and hide known ones if
 * they like), filter by category, add a new word, delete one. The same
 * cards as the website's student panel.
 */
export default function Words() {
  const t = useT();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ add?: string }>();
  const [entries, setEntries] = useState<VocabEntry[] | null>(null);
  const [category, setCategory] = useState(ALL);
  const [hideMastered, setHideMastered] = useState(false);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  // the card turns over like the website's (a 3D flip, 0.6s): 0 = word, 1 = meaning
  const flip = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const [adding, setAdding] = useState(params.add === '1');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    getVocabEntries(profile.id).then((list) => setEntries(list ?? []));
  }, [profile?.id]);

  const categories = useMemo(() => [...new Set((entries ?? []).map((e) => e.category))].sort((a, b) => a.localeCompare(b, 'tr')), [entries]);
  // "Kartları karıştır": the shuffled order of the card ids (null = the
  // normal order). It stays while the category or the hide switch changes;
  // a card added afterwards goes to the front, where the new card is shown.
  const [order, setOrder] = useState<string[] | null>(null);
  const [toast, setToast] = useState('');
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const deck = useMemo(() => {
    const list = (entries ?? []).filter((e) => (category === ALL || e.category === category) && (!hideMastered || !e.mastered));
    if (!order) return list;
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...list].sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1));
  }, [entries, category, hideMastered, order]);
  const current = deck.length ? deck[Math.min(index, deck.length - 1)] : null;
  const position = current ? deck.indexOf(current) : -1;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion, () => {});
  }, []);

  // turning the card over animates; a new card always starts on its word
  // side straight away (no glimpse of the next card's meaning)
  useEffect(() => {
    Animated.timing(flip, {
      toValue: flipped ? 1 : 0,
      duration: reduceMotion ? 0 : 600,
      easing: Easing.bezier(0.4, 0.2, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [flipped]);

  useEffect(() => {
    flip.stopAnimation();
    flip.setValue(0);
  }, [current?.id]);

  const frontStyle = {
    opacity: flip.interpolate({ inputRange: [0, 0.5, 0.501, 1], outputRange: [1, 1, 0, 0] }),
    transform: [{ perspective: 1400 }, { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }],
  };
  const backStyle = {
    opacity: flip.interpolate({ inputRange: [0, 0.5, 0.501, 1], outputRange: [0, 0, 1, 1] }),
    transform: [{ perspective: 1400 }, { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] }) }],
  };

  function showToast(text: string) {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastOpacity.stopAnimation();
    Animated.timing(toastOpacity, { toValue: 1, duration: reduceMotion ? 0 : 180, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: reduceMotion ? 0 : 300, useNativeDriver: true }).start(() => setToast(''));
    }, 2200);
  }

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  // a real shuffle of the whole deck (every card once, in a new order),
  // starting again from the first card on its word side
  function shuffle() {
    if (deck.length < 2) return;
    const ids = (entries ?? []).map((e) => e.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    // make the change visible: the card on screen doesn't stay first
    const visible = new Set(deck.map((e) => e.id));
    const firstVisible = ids.findIndex((id) => visible.has(id));
    if (current && ids[firstVisible] === current.id) {
      const other = ids.findIndex((id, k) => k !== firstVisible && visible.has(id));
      if (other >= 0) [ids[firstVisible], ids[other]] = [ids[other], ids[firstVisible]];
    }
    setOrder(ids);
    setIndex(0);
    setFlipped(false);
    const text = t("Karıştırıldı · {0} kart, baştan başlıyorsun", deck.length);
    showToast(text);
    AccessibilityInfo.announceForAccessibility(text);
  }

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
      Alert.alert(t("Kaydedilemedi"), t("Lütfen tekrar dene."));
      return;
    }
    setEntries((prev) => (prev ?? []).map((e) => (e.id === updated.id ? updated : e)));
    setFlipped(false);
    // a card marked known disappears when known ones are hidden; otherwise move on
    if (!(hideMastered && updated.mastered)) setIndex(deck.length ? (position + 1) % deck.length : 0);
  }

  function confirmDelete() {
    if (!current) return;
    Alert.alert(t("Kartı sil"), t("\"{0}\" kartı silinsin mi?", current.term), [
      { text: t("Vazgeç"), style: 'cancel' },
      {
        text: t("Sil"),
        style: 'destructive',
        onPress: async () => {
          const ok = await deleteVocabEntry(current.id);
          if (!ok) {
            Alert.alert(t("Silinemedi"), t("Lütfen tekrar dene."));
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
          <Pressable onPress={() => router.back()} style={styles.roundBtn} accessibilityLabel={t("Geri")}>
            <Ionicons name="chevron-back" size={20} color={colors.onRed} />
          </Pressable>
          <View style={styles.headText}>
            <Text style={styles.title}>{t("Kelime kartlarım")}</Text>
            {!!entries?.length && (
              <Text style={styles.sub}>
                {t("{0} kelime · {1} öğrendin", entries.length, learned)}</Text>
            )}
          </View>
          <Pressable onPress={() => setAdding(true)} style={styles.roundBtn} accessibilityLabel={t("Kelime ekle")}>
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
            <Text style={styles.emptyTitle}>{t("Henüz kelimen yok")}</Text>
            <Text style={styles.emptyText}>{t("Derste öğrendiğin kelimeleri anlamlarıyla birlikte ekle, sonra kart kart çalış.")}</Text>
            <Pressable onPress={() => setAdding(true)} style={styles.primary}>
              <Ionicons name="add" size={18} color={colors.onRed} />
              <Text style={styles.primaryText}>{t("İlk kelimeni ekle")}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsInner}>
              {[ALL, ...categories].map((c) => (
                <Pressable key={c} onPress={() => pickCategory(c)} style={[styles.chip, category === c && styles.chipOn]}>
                  <Text style={[styles.chipText, category === c && styles.chipTextOn]}>
                    {c === ALL ? `${t(ALL)} · ${(entries ?? []).filter((e) => !hideMastered || !e.mastered).length}` : t(c)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {current ? (
              <Pressable
                onPress={() => setFlipped((f) => !f)}
                style={styles.cardWrap}
                accessibilityRole="button"
                accessibilityLabel={flipped ? t("{0}: {1}. Kelimeye dönmek için dokun", current.term, current.meaning) : t("{0}. Anlamını görmek için dokun", current.term)}
              >
                <View style={styles.cardBack} />

                {/* both sides live in their own flat layer drawn above the
                    tilted card behind: on iOS, views turning in 3D are
                    depth-sorted against their siblings, so without this the
                    card behind cut through the turning card mid-flip.
                    collapsable={false} keeps this wrapper from being
                    optimised away. */}
                <View style={styles.flipLayer} collapsable={false} pointerEvents="box-none">
                {/* the word side */}
                <Animated.View style={[styles.card, styles.face, frontStyle]} pointerEvents={flipped ? 'none' : 'auto'}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cat}>{t(current.category)}</Text>
                    {current.mastered && (
                      <View style={styles.knownTag}>
                        <Ionicons name="checkmark" size={12} color={colors.petrol} />
                        <Text style={styles.knownText}>{t("Öğrendin")}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.term} adjustsFontSizeToFit numberOfLines={2}>
                    {current.term}
                  </Text>
                  <View style={styles.hint}>
                    <Ionicons name="sync-outline" size={13} color={colors.muted} />
                    <Text style={styles.hintText}>{t("Anlamını görmek için dokun")}</Text>
                  </View>
                  <Pressable onPress={confirmDelete} hitSlop={10} style={styles.trash} accessibilityLabel={t("Kartı sil")}>
                    <Ionicons name="trash-outline" size={17} color={colors.faint} />
                  </Pressable>
                </Animated.View>

                {/* the meaning side, on the back of the card */}
                <Animated.View style={[styles.face, styles.cardBackFace, backStyle]} pointerEvents={flipped ? 'auto' : 'none'}>
                  <LinearGradient colors={redGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.backFill} />
                  <Text style={styles.backCat}>{t(current.category)}</Text>
                  <Text style={styles.backLabel}>{t("ANLAMI")}</Text>
                  <Text style={styles.backMeaning} adjustsFontSizeToFit numberOfLines={4}>
                    {current.meaning}
                  </Text>
                  <Text style={styles.backTerm} numberOfLines={1}>
                    {current.term}
                  </Text>
                  <View style={styles.hint}>
                    <Ionicons name="sync-outline" size={13} color="rgba(250,245,226,0.8)" />
                    <Text style={[styles.hintText, { color: 'rgba(250,245,226,0.8)' }]}>{t("Kelimeye dönmek için dokun")}</Text>
                  </View>
                </Animated.View>
                </View>
              </Pressable>
            ) : (
              <View style={[styles.cardWrap, styles.doneBox]}>
                <Ionicons name="checkmark-done" size={30} color={colors.petrol} />
                <Text style={styles.doneTitle}>{t("Burada çalışılacak kart kalmadı")}</Text>
                <Text style={styles.doneText}>{t("Öğrendiklerini gizlemeyi kapat ya da başka bir kategori seç.")}</Text>
              </View>
            )}

            <View style={styles.progressRow}>
              <Text style={styles.progressText}>{current ? `${position + 1} / ${deck.length}` : `0 / 0`}</Text>
              <View style={styles.track}>
                <View style={[styles.trackFill, { width: deck.length ? `${((position + 1) / deck.length) * 100}%` : '0%' }]} />
              </View>
              <Text style={styles.progressText}>{t("Öğrendiklerimi gizle")}</Text>
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
              <Pressable onPress={() => go(-1)} style={styles.navBtn} accessibilityLabel={t("Önceki kart")} disabled={!current}>
                <Ionicons name="chevron-back" size={22} color={colors.ink} />
              </Pressable>
              <Pressable onPress={toggleMastered} disabled={!current || busy} style={[styles.knowBtn, current?.mastered && styles.knowBtnUndo]}>
                {busy ? (
                  <ActivityIndicator color={current?.mastered ? colors.petrol : '#fff'} />
                ) : (
                  <>
                    <Ionicons name={current?.mastered ? 'refresh' : 'checkmark'} size={18} color={current?.mastered ? colors.petrol : '#fff'} />
                    <Text style={[styles.knowText, current?.mastered && { color: colors.petrol }]}>
                      {current?.mastered ? t("Tekrar çalış") : t("Öğrendim")}
                    </Text>
                  </>
                )}
              </Pressable>
              <Pressable onPress={() => go(1)} style={styles.navBtn} accessibilityLabel={t("Sonraki kart")} disabled={!current}>
                <Ionicons name="chevron-forward" size={22} color={colors.ink} />
              </Pressable>
            </View>

            <View style={styles.shuffleArea}>
              <Pressable
                onPress={shuffle}
                disabled={deck.length < 2}
                style={({ pressed }) => [styles.shuffleBtn, deck.length < 2 && { opacity: 0.45 }, pressed && { opacity: 0.8 }]}
                accessibilityRole="button"
                accessibilityLabel={t("Kartları karıştır")}
              >
                <Ionicons name="shuffle" size={18} color={colors.red} />
                <Text style={styles.shuffleText}>{t("Kartları karıştır")}</Text>
              </Pressable>
              {!!toast && (
                <Animated.View style={[styles.toast, { opacity: toastOpacity }]} pointerEvents="none">
                  <Ionicons name="checkmark" size={14} color="#fff" />
                  <Text style={styles.toastText}>{toast}</Text>
                </Animated.View>
              )}
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
  const t = useT();
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
    const w = term.trim();
    const m = meaning.trim();
    const c = (newCategory ?? category).trim() || 'Genel';
    if (!w || !m) {
      setError(t("Kelimeyi ve anlamını yaz."));
      return;
    }
    setSaving(true);
    const entry = await addVocabEntry(studentId, w, m, c);
    setSaving(false);
    if (!entry) {
      setError(t("Kaydedilemedi. Lütfen tekrar dene."));
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
          <Text style={styles.sheetTitle}>{t("Yeni kelime")}</Text>

          <Text style={styles.label}>{t("Kelime")}</Text>
          <TextInput
            value={term}
            onChangeText={setTerm}
            placeholder={t("ör. deadline")}
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            autoFocus
          />
          <Text style={styles.label}>{t("Anlamı")}</Text>
          <TextInput value={meaning} onChangeText={setMeaning} placeholder={t("ör. son teslim tarihi")} placeholderTextColor={colors.faint} style={styles.input} />

          <Text style={styles.label}>{t("Kategori")}</Text>
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
                <Text style={[styles.catChipText, newCategory === null && category === c && styles.catChipTextOn]}>{t(c)}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setNewCategory('')} style={[styles.catChip, newCategory !== null && styles.catChipOn]}>
              <Text style={[styles.catChipText, newCategory !== null && styles.catChipTextOn]}>{t("+ Yeni kategori")}</Text>
            </Pressable>
          </View>
          {newCategory !== null && (
            <TextInput
              value={newCategory}
              onChangeText={setNewCategory}
              placeholder={t("Kategori adı (ör. IELTS)")}
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
                <Text style={styles.primaryText}>{t("Kartı ekle")}</Text>
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
    zIndex: 0,
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
  flipLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 },
  // both sides sit on top of each other; only the one facing you shows
  face: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backfaceVisibility: 'hidden' },
  cardBackFace: {
    borderRadius: 26,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 26,
    gap: 10,
    shadowColor: colors.redDeep,
    shadowOpacity: 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8,
  },
  backFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  backCat: {
    position: 'absolute',
    top: 18,
    left: 20,
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 0.6,
    color: 'rgba(250,245,226,0.75)',
  },
  backLabel: { fontFamily: fonts.bodyExtraBold, fontSize: 11, letterSpacing: 1.4, color: 'rgba(250,245,226,0.72)' },
  backMeaning: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: colors.onRed, textAlign: 'center', letterSpacing: -0.5 },
  backTerm: { fontFamily: fonts.bodySemibold, fontSize: 14, color: 'rgba(250,245,226,0.7)', marginTop: 4 },
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

  shuffleArea: { alignItems: 'center', marginTop: 18, gap: 10 },
  shuffleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: colors.champagneDeep,
    backgroundColor: colors.panel,
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  shuffleText: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.ink },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  toastText: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: '#fff' },
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
