import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScrollBand } from '../../components/Band';
import { TeacherPhoto } from '../../components/TeacherCard';
import TeacherVideo from '../../components/TeacherVideo';
import { useAuth } from '../../lib/auth';
import { DAY_NAMES, getTeacherBusyTimes, slotsForDate, zonedTimeToUtc, type BusyTime } from '../../lib/bookings';
import { hasTakenTrialWith } from '../../lib/credits';
import { shortDisplayName } from '../../lib/displayName';
import { isFavorite as checkIsFavorite, toggleFavorite } from '../../lib/favorites';
import { getOrCreateConversation } from '../../lib/messages';
import { findMarketplaceTeacher } from '../../lib/teachers';
import type { Teacher } from '../../lib/teachers-data';
import { colors, fonts, radius } from '../../lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;
type Tab = 'about' | 'times' | 'reviews';

// same local-calendar key the booking screen uses
function toDateKey(date: Date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

export default function TeacherDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [loading, setLoading] = useState(true);
  const [messaging, setMessaging] = useState(false);
  const [isFav, setIsFav] = useState(false);
  // the red band reaches just past the photo and the name
  const [headBottom, setHeadBottom] = useState(140);
  // one trial per teacher (migration_110.sql) - after it, regular lessons
  const [trialTaken, setTrialTaken] = useState(false);
  const [tab, setTab] = useState<Tab>('about');
  const [busyTimes, setBusyTimes] = useState<BusyTime[]>([]);

  useEffect(() => {
    checkIsFavorite(id).then(setIsFav);
  }, [id]);

  useEffect(() => {
    if (!profile || profile.role !== 'student') return;
    hasTakenTrialWith(profile.id, id).then(setTrialTaken);
  }, [profile, id]);

  function book(type: 'trial' | 'lesson', date?: string) {
    if (!teacher) return;
    if (!profile) {
      router.push('/(auth)/login');
      return;
    }
    router.push({ pathname: '/booking/[id]', params: date ? { id: teacher.id, type, date } : { id: teacher.id, type } });
  }

  // the "Saatler" tab: open times for each of the next 7 days, read the
  // same way the booking screen reads them (taken and past times excluded)
  useEffect(() => {
    if (tab !== 'times' || !teacher) return;
    let active = true;
    getTeacherBusyTimes(teacher.id).then((busy) => {
      if (active) setBusyTimes(busy);
    });
    return () => {
      active = false;
    };
  }, [tab, teacher]);

  const week = useMemo(() => {
    if (!teacher) return [];
    const now = Date.now();
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() + i);
      const key = toDateKey(date);
      const open = slotsForDate(teacher, key, date.getDay(), busyTimes).filter(
        (slot) => slot.available && zonedTimeToUtc(key, slot.time, teacher.timezone).getTime() > now
      );
      return { key, dayName: DAY_NAMES[date.getDay()], dayNum: date.getDate(), open: open.length };
    });
  }, [teacher, busyTimes]);

  async function handleToggleFavorite() {
    const next = await toggleFavorite(id);
    setIsFav(next);
  }

  async function handleMessage() {
    if (!teacher || !profile || messaging) return;
    setMessaging(true);
    const conversation = await getOrCreateConversation(profile.id, profile.role, teacher.id);
    setMessaging(false);
    if (!conversation) return;
    router.push({
      pathname: '/chat/[id]',
      params: { id: conversation.id, otherName: shortDisplayName(teacher.name), otherPhoto: teacher.photo ?? '' },
    });
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    findMarketplaceTeacher(id).then((t) => {
      if (active) {
        setTeacher(t);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.ink} />
      </SafeAreaView>
    );
  }

  if (!teacher) {
    return (
      <SafeAreaView style={styles.screen}>
        <Text style={styles.notFound}>Öğretmen bulunamadı.</Text>
      </SafeAreaView>
    );
  }

  const reviewsLabel = teacher.reviewCount > 0 ? `${teacher.reviewCount} yorum` : teacher.reviews.length > 0 ? `${teacher.reviews.length} yorum` : null;
  type Fact = { icon: IconName; value: string; label: string };
  const facts = ([
    { icon: 'calendar-outline', value: teacher.completedLessons, label: 'tamamlanan ders' },
    { icon: 'people-outline', value: String(teacher.students), label: 'öğrenci' },
    { icon: 'chatbubble-outline', value: shortLanguages(teacher.languages), label: 'diller' },
    { icon: 'star-outline', value: teacher.levelRange.replace(/\s*[–-]\s*/, '–'), label: 'seviye' },
  ] as Fact[]).filter((f) => f.value && f.value !== '0');
  const showMessage = !!teacher.isRegistered && !!profile;

  return (
    <SafeAreaView style={styles.safeRed} edges={['top']}>
      <ScrollView style={styles.list} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScrollBand height={headBottom - 4} fade={72} />
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.roundBtn} accessibilityLabel="Geri">
            <Ionicons name="chevron-back" size={20} color={colors.onRed} />
          </Pressable>
          <Pressable
            onPress={handleToggleFavorite}
            style={[styles.roundBtn, isFav && styles.roundBtnOn]}
            accessibilityLabel={isFav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
          >
            <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={19} color={isFav ? colors.red : colors.onRed} />
          </Pressable>
        </View>

        <View style={styles.head} onLayout={(e) => setHeadBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
          <TeacherPhoto teacher={teacher} style={styles.avatar} initialsSize={24} />
          <View style={styles.headText}>
            <Text style={styles.name} numberOfLines={1}>
              {shortDisplayName(teacher.name)}
            </Text>
            <Text style={styles.role} numberOfLines={2}>
              {teacher.role}
            </Text>
            <View style={styles.pill}>
              <Text style={styles.pillText}>
                {teacher.rating ? `★ ${teacher.rating.toFixed(1)}` : 'Yeni öğretmen'}
                {reviewsLabel ? ` · ${reviewsLabel}` : ''}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.tabs}>
          {(
            [
              ['about', 'Hakkında'],
              ['times', 'Saatler'],
              ['reviews', 'Yorumlar'],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <Pressable key={key} onPress={() => setTab(key)} style={[styles.tab, tab === key && styles.tabOn]}>
              <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'about' && (
          <>
            {/* the intro video when the teacher has one (like the website), else the big photo */}
            {teacher.video && /^https:\/\//i.test(teacher.video) ? (
              <TeacherVideo uri={teacher.video} style={styles.mediaVideo} badge={teacher.availability || undefined} />
            ) : (
              <View style={styles.media}>
                <TeacherPhoto teacher={teacher} style={StyleSheet.absoluteFill} initialsSize={48} />
                {!!teacher.availability && (
                  <View style={styles.mediaTag}>
                    <View style={styles.liveDot} />
                    <Text style={styles.mediaTagText}>{teacher.availability}</Text>
                  </View>
                )}
              </View>
            )}

            <View style={styles.facts}>
              {facts.map((f) => (
                <View key={f.label} style={styles.fact}>
                  <Ionicons name={f.icon} size={18} color={colors.ink} />
                  <View style={{ flexShrink: 1 }}>
                    <Text style={styles.factValue} numberOfLines={1}>
                      {f.value}
                    </Text>
                    <Text style={styles.factLabel}>{f.label}</Text>
                  </View>
                </View>
              ))}
            </View>

            <Text style={styles.sectionTitle}>Tanışalım</Text>
            {teacher.about.map((p, i) => (
              <Text key={i} style={styles.paragraph}>
                {p}
              </Text>
            ))}

            {teacher.specialties.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Uzmanlık alanları</Text>
                <View style={styles.tagRow}>
                  {teacher.specialties.map((sp) => (
                    <View key={sp} style={styles.tag}>
                      <Text style={styles.tagText}>{sp}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        )}

        {tab === 'times' && (
          <>
            <Text style={styles.hint}>Önümüzdeki 7 gün. Bir güne dokun, o günün saatlerini seç.</Text>
            {week.map((d) => (
              <Pressable
                key={d.key}
                disabled={d.open === 0}
                onPress={() => book(trialTaken ? 'lesson' : 'trial', d.key)}
                style={({ pressed }) => [styles.dayRow, d.open === 0 && styles.dayRowOff, pressed && { opacity: 0.85 }]}
              >
                <View style={styles.dayBadge}>
                  <Text style={styles.dayBadgeName}>{d.dayName}</Text>
                  <Text style={styles.dayBadgeNum}>{d.dayNum}</Text>
                </View>
                <Text style={[styles.dayText, d.open === 0 && styles.dayTextOff]}>
                  {d.open === 0 ? 'Boş saat yok' : `${d.open} boş saat`}
                </Text>
                {d.open > 0 && <Ionicons name="chevron-forward" size={18} color={colors.faint} />}
              </Pressable>
            ))}
          </>
        )}

        {tab === 'reviews' &&
          (teacher.reviews.length === 0 ? (
            <Text style={styles.hint}>Henüz yorum yok. İlk dersten sonra öğrencilerin yorumları burada görünür.</Text>
          ) : (
            teacher.reviews.map((r, i) => (
              <View key={i} style={styles.review}>
                <View style={styles.reviewHeader}>
                  <View style={styles.reviewAvatar}>
                    <Text style={styles.reviewAvatarText}>{r.name.charAt(0)}</Text>
                  </View>
                  <Text style={styles.reviewName}>{r.name}</Text>
                  <Text style={styles.reviewStars}>{'★'.repeat(r.stars)}</Text>
                </View>
                {!!r.text && <Text style={styles.reviewText}>{r.text}</Text>}
              </View>
            ))
          ))}

        {!trialTaken && (
          <Pressable onPress={() => book('lesson')} hitSlop={8} style={styles.lessonLink}>
            <Text style={styles.lessonLinkText}>Deneme dersi yerine normal ders rezerve et →</Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {showMessage && (
          <Pressable onPress={handleMessage} disabled={messaging} style={styles.msgBtn} accessibilityLabel="Mesaj gönder">
            {messaging ? <ActivityIndicator color={colors.ink} /> : <Ionicons name="chatbubble-outline" size={22} color={colors.ink} />}
          </Pressable>
        )}
        <Pressable
          onPress={() => book(trialTaken ? 'lesson' : 'trial')}
          style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.88 : 1 }]}
        >
          <Text style={styles.ctaText}>
            {trialTaken ? 'Ders rezerve et' : 'Deneme dersi al'} · <Text style={styles.ctaPrice}>₺{teacher.price}</Text>
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// "English / Türkçe" → "EN / TR" so it fits the fact tile
function shortLanguages(languages: string) {
  const map: Record<string, string> = { english: 'EN', türkçe: 'TR', turkish: 'TR', deutsch: 'DE', german: 'DE', español: 'ES', spanish: 'ES', français: 'FR', french: 'FR', arabic: 'AR', русский: 'RU', russian: 'RU' };
  const parts = languages.split(/\s*[\/,]\s*/).map((p) => p.replace(/\s*\(.*?\)\s*/g, '').trim()).filter(Boolean);
  return parts.map((p) => map[p.toLowerCase()] ?? p).join(' / ');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  // the status bar area is plain red; the scroll view paints the ground and carries the band
  safeRed: { flex: 1, backgroundColor: colors.red },
  list: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 30 },
  notFound: { fontFamily: fonts.body, color: colors.muted, textAlign: 'center', marginTop: 60 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, marginBottom: 12 },
  // on the red band: see-through cream buttons, the name in cream
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
  roundBtnOn: { backgroundColor: colors.cream, borderColor: colors.cream },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 72, height: 72, borderRadius: 22, borderWidth: 2, borderColor: colors.cream },
  headText: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.displayBold, fontSize: 19, color: colors.onRed },
  role: { fontFamily: fonts.body, fontSize: 13.5, color: 'rgba(250,245,226,0.85)', marginTop: 2 },
  pill: { alignSelf: 'flex-start', backgroundColor: colors.cream, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.red },
  tabs: { flexDirection: 'row', gap: 18, borderBottomWidth: 1, borderBottomColor: colors.border, marginTop: 26, marginBottom: 14 },
  tab: { paddingBottom: 10, borderBottomWidth: 3, borderBottomColor: 'transparent', marginBottom: -1 },
  tabOn: { borderBottomColor: colors.red },
  tabText: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.faint },
  tabTextOn: { color: colors.red },
  media: { height: 220, borderRadius: 20, overflow: 'hidden', backgroundColor: colors.panel2 },
  mediaVideo: { width: '100%', aspectRatio: 16 / 9, borderRadius: 20 },
  mediaTag: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#3ecf7a' },
  mediaTagText: { fontFamily: fonts.bodyBold, fontSize: 12, color: '#fff' },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  fact: {
    width: '48.6%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  factValue: { fontFamily: fonts.bodyExtraBold, fontSize: 15, color: colors.ink },
  factLabel: { fontFamily: fonts.bodyMedium, fontSize: 11.5, color: colors.faint },
  sectionTitle: { fontFamily: fonts.bodyExtraBold, fontSize: 16, color: colors.ink, marginTop: 22, marginBottom: 8 },
  paragraph: { fontFamily: fonts.body, fontSize: 14.5, color: '#444', lineHeight: 22, marginBottom: 10 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { backgroundColor: colors.panel2, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7 },
  tagText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink },
  hint: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.faint, lineHeight: 19, marginBottom: 12 },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    borderRadius: 16,
    padding: 10,
    marginBottom: 8,
  },
  dayRowOff: { borderStyle: 'dashed', borderColor: colors.champagneDeep, backgroundColor: 'transparent' },
  dayBadge: { width: 44, alignItems: 'center', backgroundColor: colors.panel2, borderRadius: 12, paddingVertical: 5 },
  dayBadgeName: { fontFamily: fonts.bodySemibold, fontSize: 11, color: colors.faint },
  dayBadgeNum: { fontFamily: fonts.bodyExtraBold, fontSize: 16, color: colors.ink },
  dayText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.ink },
  dayTextOff: { color: '#b5b5b5', fontFamily: fonts.bodySemibold },
  review: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, borderRadius: 16, padding: 14, marginBottom: 8 },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 6 },
  reviewAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  reviewAvatarText: { fontFamily: fonts.bodyExtraBold, fontSize: 13, color: colors.muted },
  reviewName: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  reviewStars: { fontSize: 12, color: colors.goldDot },
  reviewText: { fontFamily: fonts.body, fontSize: 14, color: '#444', lineHeight: 20 },
  lessonLink: { alignSelf: 'center', marginTop: 18 },
  lessonLinkText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.muted, textDecorationLine: 'underline' },
  bar: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.bg },
  msgBtn: { width: 56, height: 56, borderRadius: 18, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  cta: { flex: 1, height: 56, borderRadius: 18, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontFamily: fonts.bodyExtraBold, fontSize: 15, color: colors.onRed },
  ctaPrice: { color: colors.gold2 },
});
