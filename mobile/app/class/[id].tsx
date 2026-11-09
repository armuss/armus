import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';

import Button from '../../components/Button';
import { getAttendanceReportForBooking, reportAttendanceIssue } from '../../lib/attendance';
import { useAuth } from '../../lib/auth';
import {
  canJoinLessonNow,
  formatLessonWhenForViewer,
  formatMinutes,
  getBookingById,
  lessonWindow,
  roomNameForBooking,
  type Booking,
} from '../../lib/bookings';
import { shortDisplayName } from '../../lib/displayName';
import { getLessonNotes, saveLessonNotes } from '../../lib/lessonNotes';
import { addReview, getReviewForBooking } from '../../lib/reviews';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius } from '../../lib/theme';

type Phase = 'loading' | 'tooEarly' | 'tooLate' | 'noAccess' | 'cancelled' | 'room' | 'checkin' | 'review';

// how long after the lesson's real start a "the teacher never showed up"
// report can be filed - mirrors ARMUS_NO_SHOW_GRACE_MINUTES (class.html):
// short enough a student doesn't wait long to report, long enough that a
// teacher joining a couple minutes late isn't instantly flagged.
const NO_SHOW_GRACE_MINUTES = 10;

function formatClock(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function Class() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();

  // a teacher's lessons live on the "Bugün" tab, a student's on "Derslerim"
  function goBackToLessons() {
    router.replace(profile?.role === 'teacher' ? '/(tabs)' : '/(tabs)/lessons');
  }

  const [phase, setPhase] = useState<Phase>('loading');
  const [booking, setBooking] = useState<Booking | null>(null);
  const [minutesUntil, setMinutesUntil] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [overtime, setOvertime] = useState(false);
  const [timerShort, setTimerShort] = useState('');
  const insets = useSafeAreaInsets();

  // the bottom panel: words and a note for this lesson, kept on the device
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<'words' | 'notes'>('words');
  const [words, setWords] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [wordInput, setWordInput] = useState('');
  const notesLoaded = useRef(false);

  useEffect(() => {
    notesLoaded.current = false;
    getLessonNotes(id).then((n) => {
      setWords(n.words);
      setNote(n.note);
      notesLoaded.current = true;
    });
  }, [id]);

  useEffect(() => {
    if (!notesLoaded.current) return;
    const t = setTimeout(() => saveLessonNotes(id, { words, note }), 400);
    return () => clearTimeout(t);
  }, [id, words, note]);

  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [savingReview, setSavingReview] = useState(false);

  const windowRef = useRef<{ start: Date; end: Date } | null>(null);

  useEffect(() => {
    if (!profile) return;
    let active = true;

    getBookingById(id).then((b) => {
      if (!active) return;

      if (!b) {
        setPhase('noAccess');
        return;
      }
      // RLS lets more than just the two participants read a booking row
      // (an admin, for dispute review) - getBookingById succeeding is not
      // the same as "you belong in this call", unlike a booking that
      // doesn't exist or isn't yours at all, which already lands here as
      // `!b` via RLS. Mirrors class.html's explicit isStudent/isTeacher gate.
      if (profile.id !== b.studentId && profile.id !== b.teacherId) {
        setPhase('noAccess');
        return;
      }
      if (b.status === 'cancelled') {
        setPhase('cancelled');
        return;
      }

      const { start, end, joinsFrom, joinsUntil } = lessonWindow(b);
      windowRef.current = { start, end };
      const now = new Date();

      if (now < joinsFrom) {
        setMinutesUntil(Math.ceil((joinsFrom.getTime() - now.getTime()) / 60000));
        setBooking(b);
        setPhase('tooEarly');
        return;
      }
      if (now > joinsUntil) {
        setPhase('tooLate');
        return;
      }

      setBooking(b);
      setPhase('room');
    });

    return () => {
      active = false;
    };
  }, [id, profile]);

  // "tooEarly" only reflects the moment the booking was first fetched - a
  // student who opened the link early would otherwise be stuck on this
  // screen forever even once the join window actually opens, with no way
  // back in short of leaving and re-entering. Re-checks every 15s and
  // flips into the room once joinsFrom passes, mirroring class.html.
  useEffect(() => {
    if (phase !== 'tooEarly' || !booking) return;

    const interval = setInterval(() => {
      const { start, end, joinsFrom, joinsUntil } = lessonWindow(booking);
      const now = new Date();
      if (now >= joinsFrom && now <= joinsUntil) {
        windowRef.current = { start, end };
        setPhase('room');
      } else if (now > joinsUntil) {
        setPhase('tooLate');
      } else {
        setMinutesUntil(Math.ceil((joinsFrom.getTime() - now.getTime()) / 60000));
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [phase, booking]);

  useEffect(() => {
    if (phase !== 'room' || !windowRef.current) return;

    function tick() {
      const { start, end } = windowRef.current!;
      const now = new Date();
      const pct = Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100));
      setProgressPct(pct);

      if (now > end) {
        setOvertime(true);
        setProgressLabel(`Ders bitti · +${formatClock(now.getTime() - end.getTime())} ek süre`);
        setTimerShort(`+${formatClock(now.getTime() - end.getTime())} ek süre`);
      } else {
        setOvertime(false);
        setProgressLabel(`${formatClock(now.getTime() - start.getTime())} geçti · ${formatClock(end.getTime() - now.getTime())} kaldı`);
        setTimerShort(now < start ? `${formatClock(start.getTime() - now.getTime())} sonra başlıyor` : `${formatClock(end.getTime() - now.getTime())} kaldı`);
      }
    }

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  // who was in the lesson room (lesson_presence, migration_112.sql) - a
  // heartbeat about once a minute while the room is open, the same as
  // class.html; the admin looks at it when a lesson is reported
  useEffect(() => {
    if (phase !== 'room' || !booking) return;
    const beat = () => {
      supabase.rpc('lesson_heartbeat', { p_booking_id: booking.id }).then(() => {}, () => {});
    };
    beat();
    const interval = setInterval(beat, 60000);
    return () => clearInterval(interval);
  }, [phase, booking]);

  const [checkinBusy, setCheckinBusy] = useState(false);
  const [checkinError, setCheckinError] = useState(false);

  // Only the student rates a lesson or reports the teacher's attendance -
  // mirrors class.html's `if (isStudent)` gate around its whole
  // post-class modal. A teacher leaving just goes straight back.
  async function handleLeave() {
    if (!booking || !profile) return;

    if (profile.id !== booking.studentId) {
      goBackToLessons();
      return;
    }

    // asked first, every time (unless already reported from inside the
    // room, which this screen doesn't offer yet - only the post-leave
    // check-in below) - an existing report already answered this, so go
    // straight to the review step same as web does.
    const existingReport = await getAttendanceReportForBooking(booking.id);
    if (existingReport) {
      const existingReview = await getReviewForBooking(booking.id);
      if (existingReview) {
        goBackToLessons();
        return;
      }
      setPhase('review');
      return;
    }

    setPhase('checkin');
  }

  async function submitCheckin(type: 'yes' | 'late' | 'no_show') {
    if (!booking || !profile) return;

    if (type === 'yes') {
      const existing = await getReviewForBooking(booking.id);
      if (existing) {
        goBackToLessons();
        return;
      }
      setPhase('review');
      return;
    }

    setCheckinBusy(true);
    setCheckinError(false);
    const result = await reportAttendanceIssue({
      bookingId: booking.id,
      teacherId: booking.teacherId,
      studentId: profile.id,
      type,
    });
    setCheckinBusy(false);

    if (!result) {
      setCheckinError(true);
      return;
    }
    // nothing to rate for a lesson that didn't properly happen - same as
    // web, a filed no_show/late report skips straight to leaving.
    goBackToLessons();
  }

  async function submitReview() {
    if (!booking || !profile || savingReview) return;

    setSavingReview(true);
    if (stars > 0) {
      await addReview({
        bookingId: booking.id,
        teacherId: booking.teacherId,
        studentId: profile.id,
        studentName: profile.name,
        stars,
        text: comment.trim(),
      });
    }
    setSavingReview(false);
    goBackToLessons();
  }

  if (phase === 'loading') {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.ink} />
      </SafeAreaView>
    );
  }

  if (phase === 'noAccess') {
    return (
      <Gate
        title="Bu derse erişimin yok"
        subtitle="Bu ders bağlantısı geçersiz ya da bu dersin katılımcılarından biri değilsin."
        buttonLabel="Derslerime dön"
        onPress={() => goBackToLessons()}
      />
    );
  }

  if (phase === 'cancelled') {
    return (
      <Gate
        icon="close-circle-outline"
        title="Bu ders iptal edildi"
        subtitle="Bu ders artık gerçekleşmeyecek."
        buttonLabel="← Geri dön"
        onPress={() => goBackToLessons()}
      />
    );
  }

  if (phase === 'tooEarly' && booking) {
    const isStudent = profile?.id === booking.studentId;
    const otherName = isStudent ? shortDisplayName(booking.teacherName) : booking.studentName;
    const when = formatLessonWhenForViewer(booking);
    return (
      <Gate
        icon="time-outline"
        title="Henüz erken"
        subtitle={`${otherName} ile ${when.dateLabel}, ${when.timeRange} — ${formatMinutes(minutesUntil)} sonra katılabileceksin.`}
        buttonLabel="Derslerime dön"
        onPress={() => goBackToLessons()}
      />
    );
  }

  if (phase === 'tooLate') {
    return (
      <Gate
        title="Bu dersin katılım süresi doldu"
        subtitle="Ders saati ve sonrasındaki katılım penceresi geçti."
        buttonLabel="Derslerime dön"
        onPress={() => goBackToLessons()}
      />
    );
  }

  if (phase === 'checkin' && booking) {
    const noShowReady = windowRef.current
      ? new Date() >= new Date(windowRef.current.start.getTime() + NO_SHOW_GRACE_MINUTES * 60000)
      : false;

    if (checkinError) {
      return (
        <SafeAreaView style={[styles.screen, styles.centered, { paddingHorizontal: 28 }]}>
          <Text style={styles.reviewTitle}>Bildirim gönderilemedi</Text>
          <Text style={styles.gateSubtitle}>Lütfen tekrar dene.</Text>
          <View style={{ width: '100%', marginTop: 20, gap: 10 }}>
            <Button label="Tekrar dene" onPress={() => setCheckinError(false)} />
            <Pressable onPress={() => goBackToLessons()}>
              <Text style={styles.skipText}>Atla</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={[styles.screen, styles.centered, { paddingHorizontal: 28 }]}>
        <Text style={styles.reviewTitle}>Bu ders gerçekleşti mi?</Text>
        <Text style={[styles.gateSubtitle, { marginBottom: 20 }]}>
          {formatLessonWhenForViewer(booking).dateLabel}, {formatLessonWhenForViewer(booking).timeRange} için planlanan ders.
        </Text>
        <View style={{ width: '100%', gap: 10 }}>
          <Button label="Evet, zamanında oldu" onPress={() => submitCheckin('yes')} loading={checkinBusy} />
          <Button
            label="Evet ama öğretmen geç geldi"
            variant="outline"
            onPress={() => submitCheckin('late')}
            loading={checkinBusy}
          />
          <Button
            label="Hayır, öğretmen gelmedi"
            variant="outline"
            onPress={() => submitCheckin('no_show')}
            disabled={!noShowReady}
            loading={checkinBusy}
          />
          {!noShowReady && (
            <Text style={styles.skipText}>Öğretmen hâlâ gelmediyse birkaç dakika sonra tekrar dene.</Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'review') {
    return (
      <SafeAreaView style={[styles.screen, styles.centered, { paddingHorizontal: 28 }]}>
        <Text style={styles.reviewTitle}>Bu ders nasıldı?</Text>
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} onPress={() => setStars(n)}>
              <Text style={[styles.star, n <= stars && styles.starActive]}>★</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={comment}
          onChangeText={setComment}
          placeholder="İstersen kısa bir not bırak (opsiyonel)"
          placeholderTextColor={colors.faint}
          style={styles.commentInput}
          multiline
        />
        <View style={{ width: '100%', marginTop: 20, gap: 10 }}>
          <Button label="Gönder" onPress={submitReview} loading={savingReview} />
          <Pressable onPress={() => goBackToLessons()}>
            <Text style={styles.skipText}>Atla</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!booking) return null;

  const roomUrl = `https://meet.jit.si/${roomNameForBooking(booking.id)}#config.prejoinPageEnabled=false&userInfo.displayName=%22${encodeURIComponent(
    profile?.name || 'ARMUS'
  )}%22`;

  const isStudent = profile?.id === booking.studentId;
  const otherName = isStudent ? shortDisplayName(booking.teacherName) : booking.studentName;

  function addWord() {
    const w = wordInput.trim();
    if (!w || words.some((x) => x.toLowerCase() === w.toLowerCase())) {
      setWordInput('');
      return;
    }
    setWords((prev) => [...prev, w]);
    setWordInput('');
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.room, { paddingTop: insets.top + 6 }]}>
      <View style={styles.roomTop}>
        <View style={[styles.timer, overtime && styles.timerOver]} accessibilityLabel={progressLabel}>
          <View style={[styles.timerDot, overtime && { backgroundColor: '#fff' }]} />
          <Text style={styles.timerText}>{timerShort}</Text>
        </View>
        <Text style={styles.roomWith} numberOfLines={1}>
          {otherName} · {formatLessonWhenForViewer(booking).timeRange}
        </Text>
        <Pressable onPress={handleLeave} style={styles.leave} accessibilityLabel="Dersten ayrıl">
          <Ionicons name="exit-outline" size={16} color="#fff" />
          <Text style={styles.leaveText}>Ayrıl</Text>
        </Pressable>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, overtime && styles.progressFillOvertime, { width: `${progressPct}%` }]} />
      </View>

      <View style={styles.videoFrame}>
        <WebView
          source={{ uri: roomUrl }}
          style={{ flex: 1, backgroundColor: '#0b0b0b' }}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          startInLoadingState
          renderLoading={() => (
            <View style={styles.videoLoading}>
              <ActivityIndicator color={colors.gold2} />
              <Text style={styles.videoLoadingText}>Ders odası açılıyor…</Text>
            </View>
          )}
        />
      </View>

      <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable onPress={() => setPanelOpen((v) => !v)} style={styles.grabArea} accessibilityLabel={panelOpen ? 'Paneli kapat' : 'Paneli aç'}>
          <View style={styles.grab} />
        </Pressable>
        <View style={styles.panelTabs}>
          {(
            [
              ['words', `Kelimeler${words.length ? ` · ${words.length}` : ''}`],
              ['notes', 'Notlar'],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => {
                setPanelTab(key);
                setPanelOpen(true);
              }}
            >
              <Text style={[styles.panelTab, panelOpen && panelTab === key && styles.panelTabOn]}>{label}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setPanelOpen((v) => !v)} style={{ marginLeft: 'auto' }} hitSlop={10}>
            <Ionicons name={panelOpen ? 'chevron-down' : 'chevron-up'} size={18} color={colors.muted} />
          </Pressable>
        </View>

        {panelOpen && panelTab === 'words' && (
          <>
            <View style={styles.words}>
              {words.map((w) => (
                <Pressable key={w} onPress={() => setWords((prev) => prev.filter((x) => x !== w))} style={styles.word} accessibilityLabel={`${w} kelimesini sil`}>
                  <Text style={styles.wordText}>{w}</Text>
                  <Ionicons name="close" size={12} color={colors.faint} />
                </Pressable>
              ))}
              {words.length === 0 && <Text style={styles.panelHint}>Derste duyduğun yeni kelimeleri buraya yaz, ders bitince de burada kalır.</Text>}
            </View>
            <View style={styles.addRow}>
              <TextInput
                value={wordInput}
                onChangeText={setWordInput}
                onSubmitEditing={addWord}
                placeholder="Yeni kelime"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                returnKeyType="done"
                style={styles.addInput}
              />
              <Pressable onPress={addWord} style={styles.addBtn} accessibilityLabel="Kelime ekle">
                <Ionicons name="add" size={20} color={colors.gold2} />
              </Pressable>
            </View>
          </>
        )}

        {panelOpen && panelTab === 'notes' && (
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Bu dersten aklında kalmasını istediklerin…"
            placeholderTextColor={colors.faint}
            multiline
            style={styles.noteInput}
          />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function Gate({
  icon = 'videocam-outline',
  title,
  subtitle,
  buttonLabel,
  onPress,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  buttonLabel: string;
  onPress: () => void;
}) {
  return (
    <SafeAreaView style={[styles.screen, styles.centered, { paddingHorizontal: 28 }]}>
      <View style={styles.gateIcon}>
        <Ionicons name={icon} size={28} color={colors.gold2} />
      </View>
      <Text style={styles.gateTitle}>{title}</Text>
      <Text style={styles.gateSubtitle}>{subtitle}</Text>
      <View style={{ width: '100%', marginTop: 24 }}>
        <Button label={buttonLabel} variant="outline" onPress={onPress} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  room: { flex: 1, backgroundColor: '#0b0b0b' },
  roomTop: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 10 },
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  timerOver: { backgroundColor: colors.error },
  timerDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#e5484d' },
  timerText: { fontFamily: fonts.bodyBold, fontSize: 13, color: '#fff', fontVariant: ['tabular-nums'] },
  roomWith: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 13, color: '#aaa' },
  leave: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#e5484d', borderRadius: radius.pill, paddingHorizontal: 13, paddingVertical: 7 },
  leaveText: { fontFamily: fonts.bodyBold, fontSize: 13, color: '#fff' },
  progressTrack: { height: 3, marginHorizontal: 14, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', marginBottom: 10 },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: colors.gold2 },
  progressFillOvertime: { backgroundColor: colors.error },
  videoFrame: { flex: 1, marginHorizontal: 10, borderRadius: 24, overflow: 'hidden', backgroundColor: '#161616' },
  videoLoading: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#161616' },
  videoLoadingText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: '#aaa' },
  panel: { backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, marginTop: 10, paddingHorizontal: 16 },
  grabArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 10 },
  grab: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#ddd' },
  panelTabs: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingBottom: 4 },
  panelTab: { fontFamily: fonts.bodyBold, fontSize: 14, color: '#9a9a9a' },
  panelTabOn: { color: colors.ink },
  words: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, maxHeight: 110, overflow: 'hidden' },
  word: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.panel2, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7 },
  wordText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink },
  panelHint: { fontFamily: fonts.bodyMedium, fontSize: 12.5, lineHeight: 18, color: colors.faint },
  addRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  addInput: { flex: 1, height: 46, borderRadius: 14, backgroundColor: colors.panel2, paddingHorizontal: 14, fontFamily: fonts.bodyMedium, fontSize: 14.5, color: colors.ink },
  addBtn: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  noteInput: {
    minHeight: 96,
    maxHeight: 160,
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: colors.panel2,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  gateIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.dark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  gateTitle: {
    fontFamily: fonts.displayBlack,
    fontSize: 22,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 10,
  },
  gateSubtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  reviewTitle: {
    fontFamily: fonts.displayBlack,
    fontSize: 21,
    color: colors.ink,
    marginBottom: 20,
  },
  starsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  star: {
    fontSize: 36,
    color: colors.border,
  },
  starActive: {
    color: colors.gold3,
  },
  commentInput: {
    width: '100%',
    minHeight: 80,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  skipText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13.5,
    color: colors.muted,
    textAlign: 'center',
  },
});
