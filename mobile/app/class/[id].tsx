import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Redirect, router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputInstance,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView, { type WebViewNavigation } from 'react-native-webview';

import AttendanceFlow from '../../components/AttendanceFlow';
import Button from '../../components/Button';
import { CHECKIN_OK_KEY } from '../../components/LessonAftercare';
import { NO_SHOW_GRACE_MINUTES, getAttendanceReportForBooking, type AttendanceReport } from '../../lib/attendance';
import { useAuth } from '../../lib/auth';
import {
  formatLessonWhenForViewer,
  formatMinutes,
  getBookingById,
  lessonWindow,
  roomNameForBooking,
  type Booking,
} from '../../lib/bookings';
import { capitalizeName, shortDisplayName } from '../../lib/displayName';
import { notify } from '../../lib/dialogs';
import { getLessonNotes, saveLessonNotes } from '../../lib/lessonNotes';
import { pinVocabEntry } from '../../lib/vocab';
import { addReview, getReviewForBooking } from '../../lib/reviews';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius } from '../../lib/theme';
import { useT } from '../../lib/i18n';

type Phase = 'loading' | 'tooEarly' | 'tooLate' | 'noAccess' | 'cancelled' | 'room' | 'checkin' | 'review';

// class.html's toolbar: no "invite", "embed" or "share link" buttons, so the
// call's own UI doesn't hand the room's link to anyone past the two of them
const JITSI_TOOLBAR = [
  'microphone', 'camera', 'desktop', 'fullscreen', 'fodeviceselection',
  'hangup', 'profile', 'chat', 'raisehand', 'videoquality', 'filmstrip',
  'tileview', 'settings', 'shortcuts',
];

// The meet.jit.si room, its settings in the URL's hash (Jitsi reads each
// value as JSON, and only the keys on its URL whitelist). Opened in a phone
// browser - which a WebView is to Jitsi - meet.jit.si first shows its
// "get the Jitsi Meet app" page unless deep linking is off, and the old
// `prejoinPageEnabled` key is no longer on the whitelist (the name-and-camera
// page before joining kept showing).
function jitsiRoomUrl(bookingId: string, displayName: string) {
  const settings: [string, unknown][] = [
    ['config.prejoinConfig.enabled', false],
    ['config.disableDeepLinking', true],
    ['config.deeplinking.disabled', true],
    ['config.toolbarButtons', JITSI_TOOLBAR],
    ['userInfo.displayName', displayName],
  ];
  const hash = settings.map(([key, value]) => `${key}=${encodeURIComponent(JSON.stringify(value))}`).join('&');
  return `https://meet.jit.si/${roomNameForBooking(bookingId)}#${hash}`;
}

// Where meet.jit.si sends the page once the call is left with its own red
// hang-up button: its welcome page ("/", where anyone can start any other
// meeting) or a static close page. Seen from the WebView, that means the
// person left the lesson.
function isJitsiExitPage(url: string) {
  const match = /^https?:\/\/meet\.jit\.si(\/[^?#]*)?/i.exec(url);
  if (!match) return false;
  const path = (match[1] || '/').replace(/\/+$/, '');
  return path === '' || /^\/static\/close/i.test(path);
}

const KEEP_AWAKE_TAG = 'armus-lesson-room';

function formatClock(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function Class() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, session, loading: authLoading } = useAuth();
  const navigation = useNavigation();

  // who opened the room, kept from the moment the lesson loaded: a token
  // refresh reloads the profile, and when that read fails (a moment without
  // signal) `profile` turns null - the call's URL (with the name in it)
  // changed and the WebView reloaded, dropping the call, and "Ayrıl" did
  // nothing
  const [me, setMe] = useState<{ id: string; name: string; role: string } | null>(null);

  // a teacher's lessons live on the "Bugün" tab, a student's on "Derslerim"
  function goBackToLessons() {
    router.replace((me?.role ?? profile?.role) === 'teacher' ? '/(tabs)' : '/(tabs)/lessons');
  }

  const [phase, setPhase] = useState<Phase>('loading');
  const [booking, setBooking] = useState<Booking | null>(null);
  const [minutesUntil, setMinutesUntil] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [overtime, setOvertime] = useState(false);
  const [timerShort, setTimerShort] = useState('');
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  // the bottom panel: a word and its meaning go onto the student's word
  // cards (class.html's "pin a word", either side can add one); the list of
  // words pinned in this lesson and the note stay on this device
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<'words' | 'notes'>('words');
  const [words, setWords] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [wordInput, setWordInput] = useState('');
  const [meaningInput, setMeaningInput] = useState('');
  const [pinning, setPinning] = useState(false);
  const pinningRef = useRef(false);
  const meaningField = useRef<TextInputInstance>(null);
  const notesLoaded = useRef(false);
  const latestNotes = useRef({ words, note });
  latestNotes.current = { words, note };

  useEffect(() => {
    notesLoaded.current = false;
    getLessonNotes(id).then((n) => {
      setWords(n.words);
      setNote(n.note);
      notesLoaded.current = true;
    });
    // the save below waits 400ms after the last keystroke - leaving the
    // room inside that time used to drop the last word or note line
    return () => {
      if (notesLoaded.current) saveLessonNotes(id, latestNotes.current);
    };
  }, [id]);

  useEffect(() => {
    if (!notesLoaded.current) return;
    const t = setTimeout(() => saveLessonNotes(id, { words, note }), 400);
    return () => clearTimeout(t);
  }, [id, words, note]);

  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const savingReviewRef = useRef(false);

  const windowRef = useRef<{ start: Date; end: Date } | null>(null);

  // which screen a booking opens on, right now
  function enter(b: Booking | null, viewer: { id: string }) {
    if (!b) {
      setPhase('noAccess');
      return;
    }
    // RLS lets more than just the two participants read a booking row
    // (an admin, for dispute review) - getBookingById succeeding is not
    // the same as "you belong in this call", unlike a booking that
    // doesn't exist or isn't yours at all, which already lands here as
    // `!b` via RLS. Mirrors class.html's explicit isStudent/isTeacher gate.
    if (viewer.id !== b.studentId && viewer.id !== b.teacherId) {
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
  }

  useEffect(() => {
    if (!profile) return;
    let active = true;
    const viewer = { id: profile.id, name: profile.name, role: profile.role };

    getBookingById(id).then((b) => {
      if (!active) return;
      setMe(viewer);
      enter(b, viewer);
    });

    return () => {
      active = false;
    };
    // the profile's id, not the object: a token refresh reloads the profile
    // (a new object), and re-running this reset the phase - a student on
    // the check-in or rating step was thrown back into the room
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, profile?.id]);

  // "tooEarly" only reflects the moment the booking was first fetched - a
  // student who opened the link early would otherwise be stuck on this
  // screen forever even once the join window actually opens, with no way
  // back in short of leaving and re-entering. Re-checks every 15s; once
  // joinsFrom passes, the booking is read again (class.html reloads the
  // page) - a lesson cancelled or moved to another time while they waited
  // used to open the room at the old time all the same.
  useEffect(() => {
    if (phase !== 'tooEarly' || !booking || !me) return;
    let active = true;

    const interval = setInterval(() => {
      const { joinsFrom } = lessonWindow(booking);
      const now = new Date();
      if (now >= joinsFrom) {
        clearInterval(interval);
        // a failed read (no signal) keeps the booking already in hand
        getBookingById(booking.id).then((fresh) => {
          if (active) enter(fresh ?? booking, me);
        });
      } else {
        setMinutesUntil(Math.ceil((joinsFrom.getTime() - now.getTime()) / 60000));
      }
    }, 15000);

    return () => {
      active = false;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, booking, me]);

  useEffect(() => {
    if (phase !== 'room' || !windowRef.current) return;

    function tick() {
      const { start, end } = windowRef.current!;
      const now = new Date();
      const pct = Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100));
      setProgressPct(pct);

      if (now > end) {
        setOvertime(true);
        setProgressLabel(t("Ders bitti · +{0} ek süre", formatClock(now.getTime() - end.getTime())));
        setTimerShort(t("+{0} ek süre", formatClock(now.getTime() - end.getTime())));
      } else {
        setOvertime(false);
        setProgressLabel(t("{0} geçti · {1} kaldı", formatClock(now.getTime() - start.getTime()), formatClock(end.getTime() - now.getTime())));
        setTimerShort(now < start ? t("{0} sonra başlıyor", formatClock(start.getTime() - now.getTime())) : t("{0} kaldı", formatClock(end.getTime() - now.getTime())));
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

  // the screen stays on through the lesson: when an idle phone dimmed and
  // locked itself mid-lesson (nobody touches the screen while talking),
  // iOS stopped the WebView's camera and microphone
  useEffect(() => {
    if (phase !== 'room') return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [phase]);

  // after the student leaves: the website's shared report flow, then
  // the message it filed (or the star rating)
  const [checkinMessage, setCheckinMessage] = useState('');
  // the in-room "Bildir" sheet (class.html's report button)
  const [reportOpen, setReportOpen] = useState(false);
  const [reportExisting, setReportExisting] = useState(false);
  const [reportMessage, setReportMessage] = useState('');

  // the WebView is drawn again from scratch (a new key) after a failed load
  // or when the phone killed its web process
  const [webViewKey, setWebViewKey] = useState(0);

  function lessonStarted() {
    return windowRef.current ? new Date() >= windowRef.current.start : false;
  }

  function noShowReady() {
    return windowRef.current ? new Date() >= new Date(windowRef.current.start.getTime() + NO_SHOW_GRACE_MINUTES * 60000) : false;
  }

  async function openReport() {
    if (!booking) return;
    setReportMessage('');
    setReportExisting(!!(await getAttendanceReportForBooking(booking.id)));
    setReportOpen(true);
  }

  // Only the student rates a lesson or reports the teacher's attendance -
  // mirrors class.html's `if (isStudent)` gate around its whole
  // post-class modal. A teacher leaving just goes straight back.
  const leaving = useRef(false);
  async function handleLeave() {
    if (!booking || !me || leaving.current) return;

    if (me.id !== booking.studentId) {
      goBackToLessons();
      return;
    }

    // left before the lesson's start time (joined early, then left): there
    // is nothing to confirm or rate yet - the check-in asked "did this
    // lesson happen?" about a lesson still to come, every report on it was
    // refused (one can only be filed once the lesson has started) and "yes"
    // rated it in advance
    if (!lessonStarted()) {
      goBackToLessons();
      return;
    }

    leaving.current = true;
    // asked first, every time (unless already reported from inside the
    // room) - an existing report already answered this, so go straight to
    // the review step same as web does.
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

  // Leaving the room by any way out goes through "Ayrıl": an iPhone's swipe
  // from the screen's edge or Android's back button used to close the call
  // in an instant, skipping the check-in and rating - one stray swipe ended
  // a live lesson
  const handleLeaveRef = useRef(handleLeave);
  handleLeaveRef.current = handleLeave;
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: phase !== 'room' });
    if (phase !== 'room') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      handleLeaveRef.current();
      return true;
    });
    return () => sub.remove();
  }, [phase, navigation]);

  // Jitsi's own red hang-up button: the page moves on to meet.jit.si's
  // welcome or close page, inside the WebView - where anyone can start any
  // other meeting - and the lesson's check-in and rating never came (on the
  // website, Jitsi's readyToClose event opens them). Stop that page and leave
  // the way "Ayrıl" does.
  function onRoomNavigation(request: WebViewNavigation & { isTopFrame?: boolean }) {
    if (request.isTopFrame === false || !isJitsiExitPage(request.url)) return true;
    handleLeaveRef.current();
    return false;
  }

  // "yes" (or a late start that was still held) moves on to the star
  // rating; anything else just confirms and leaves - class.html
  async function goToReview() {
    if (!booking) return;
    const existing = await getReviewForBooking(booking.id);
    if (existing) {
      goBackToLessons();
      return;
    }
    setPhase('review');
  }

  // "yes, it happened" here is the same answer as on the lesson's card in
  // Derslerim, which used to ask it all over again for the next 24 hours
  function onHappened() {
    if (booking) AsyncStorage.setItem(CHECKIN_OK_KEY(booking.id), '1').catch(() => {});
    goToReview();
  }

  function onCheckinFiled(report: AttendanceReport, message: string) {
    if (report.type === 'late') {
      goToReview();
      return;
    }
    setCheckinMessage(message);
  }

  async function submitReview() {
    // a ref, not only the state: a quick second tap ran before the state
    // had turned, and the second insert hit reviews' one-per-lesson rule
    if (!booking || !me || savingReviewRef.current) return;

    if (stars === 0) {
      // a note typed without picking stars was dropped without a word
      if (comment.trim()) {
        notify(t("Puan seç"), t("Lütfen bir puan seç."));
        return;
      }
      goBackToLessons();
      return;
    }

    savingReviewRef.current = true;
    setSavingReview(true);
    const saved = await addReview({
      bookingId: booking.id,
      teacherId: booking.teacherId,
      studentId: me.id,
      studentName: me.name,
      stars,
      text: comment.trim(),
    });
    savingReviewRef.current = false;
    setSavingReview(false);
    if (!saved) {
      // it used to leave as if the rating had been saved
      notify(t("Kaydedilemedi"), t("Değerlendirme kaydedilemedi."));
      return;
    }
    goBackToLessons();
  }

  if (!authLoading && !session) return <Redirect href="/(auth)/login" />;

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
        title={t("Bu derse erişimin yok")}
        subtitle={t("Bu ders bağlantısı geçersiz ya da bu dersin katılımcılarından biri değilsin.")}
        buttonLabel={t("Derslerime dön")}
        onPress={() => goBackToLessons()}
      />
    );
  }

  if (phase === 'cancelled') {
    return (
      <Gate
        icon="close-circle-outline"
        title={t("Bu ders iptal edildi")}
        subtitle={t("Bu ders artık gerçekleşmeyecek.")}
        buttonLabel={t("← Geri dön")}
        onPress={() => goBackToLessons()}
      />
    );
  }

  if (phase === 'tooEarly' && booking) {
    const isStudent = me?.id === booking.studentId;
    const otherName = isStudent ? shortDisplayName(booking.teacherName) : capitalizeName(booking.studentName);
    const when = formatLessonWhenForViewer(booking);
    return (
      <Gate
        icon="time-outline"
        title={t("Henüz erken")}
        subtitle={t("{0} ile {1}, {2} — {3} sonra katılabileceksin.", otherName, when.dateLabel, when.timeRange, formatMinutes(minutesUntil))}
        buttonLabel={t("Derslerime dön")}
        onPress={() => goBackToLessons()}
      />
    );
  }

  if (phase === 'tooLate') {
    return (
      <Gate
        title={t("Bu dersin katılım süresi doldu")}
        subtitle={t("Ders saati ve sonrasındaki katılım penceresi geçti.")}
        buttonLabel={t("Derslerime dön")}
        onPress={() => goBackToLessons()}
      />
    );
  }

  if (phase === 'checkin' && booking && me) {
    if (checkinMessage) {
      return (
        <SafeAreaView style={[styles.screen, styles.centered, { paddingHorizontal: 28 }]}>
          <Text style={styles.reviewTitle}>{t("Bildirimin alındı")}</Text>
          <Text style={styles.gateSubtitle}>{checkinMessage}</Text>
          <View style={{ width: '100%', marginTop: 22 }}>
            <Button label={t("Çık")} onPress={() => goBackToLessons()} />
          </View>
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={styles.screen}>
        {/* "how many minutes" is typed here - on a small iPhone the keyboard covered "Devam Et" */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
        <ScrollView contentContainerStyle={styles.checkinContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.reviewTitle}>{t("Bu ders gerçekleşti mi?")}</Text>
          <Text style={[styles.gateSubtitle, { marginBottom: 20 }]}>
            {t("{0}, {1} için planlanan ders.", formatLessonWhenForViewer(booking).dateLabel, formatLessonWhenForViewer(booking).timeRange)}</Text>
          <AttendanceFlow
            booking={booking}
            studentId={me.id}
            noShowReady={noShowReady()}
            askHappened
            onHappened={onHappened}
            onFiled={onCheckinFiled}
          />
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (phase === 'review') {
    return (
      <SafeAreaView style={styles.screen}>
        {/* on iPhone the keyboard otherwise covers the note box and "Gönder" */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.screen, styles.centered, { paddingHorizontal: 28 }]}>
        <Text style={styles.reviewTitle}>{t("Bu ders nasıldı?")}</Text>
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
          placeholder={t("İstersen kısa bir not bırak (opsiyonel)")}
          placeholderTextColor={colors.faint}
          style={styles.commentInput}
          multiline
        />
        <View style={{ width: '100%', marginTop: 20, gap: 10 }}>
          <Button label={t("Gönder")} onPress={submitReview} loading={savingReview} />
          <Pressable onPress={() => goBackToLessons()}>
            <Text style={styles.skipText}>{t("Atla")}</Text>
          </Pressable>
        </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (!booking) return null;

  const isStudent = me?.id === booking.studentId;
  // the other person sees this name in the call - a teacher's full name is
  // never shown to a student (class.html does the same)
  const callName = me?.name
    ? isStudent
      ? capitalizeName(me.name)
      : shortDisplayName(me.name)
    : 'ARMUS';
  const roomUrl = jitsiRoomUrl(booking.id, callName);

  const otherName = isStudent ? shortDisplayName(booking.teacherName) : capitalizeName(booking.studentName);

  // The words used to be kept only in this screen, which closes for good
  // 15 minutes after the lesson - "they stay after the lesson" was never
  // true, and a teacher's words never reached the student. Each one now
  // goes onto the student's word cards (Kelime kartlarım), with its meaning.
  async function addWord() {
    if (!booking || pinningRef.current) return;
    const w = wordInput.trim();
    const m = meaningInput.trim();
    if (!w) return;
    if (words.some((x) => x.toLowerCase() === w.toLowerCase())) {
      setWordInput('');
      setMeaningInput('');
      return;
    }
    if (!m) {
      meaningField.current?.focus();
      return;
    }
    pinningRef.current = true;
    setPinning(true);
    const saved = await pinVocabEntry(booking.studentId, w, m);
    pinningRef.current = false;
    setPinning(false);
    if (!saved) {
      notify(t("Kaydedilemedi"), t("Kaydedilemedi. Lütfen tekrar dene."));
      return;
    }
    setWords((prev) => [...prev, w]);
    setWordInput('');
    setMeaningInput('');
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
        {isStudent && (
          <Pressable onPress={openReport} style={styles.reportBtn} accessibilityLabel={t("Bir sorun bildir")}>
            <Ionicons name="flag-outline" size={15} color="#fff" />
          </Pressable>
        )}
        <Pressable onPress={handleLeave} style={styles.leave} accessibilityLabel={t("Dersten ayrıl")}>
          <Ionicons name="exit-outline" size={16} color="#fff" />
          <Text style={styles.leaveText}>{t("Ayrıl")}</Text>
        </Pressable>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, overtime && styles.progressFillOvertime, { width: `${progressPct}%` }]} />
      </View>

      <View style={styles.videoFrame}>
        <WebView
          key={webViewKey}
          source={{ uri: roomUrl }}
          style={{ flex: 1, backgroundColor: '#0b0b0b' }}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          onShouldStartLoadWithRequest={onRoomNavigation}
          // the phone ended the page's web process (low memory, or long in
          // the background): the video went blank for good - load it again
          onContentProcessDidTerminate={() => setWebViewKey((k) => k + 1)}
          onRenderProcessGone={() => setWebViewKey((k) => k + 1)}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.videoLoading}>
              <ActivityIndicator color={colors.gold2} />
              <Text style={styles.videoLoadingText}>{t("Ders odası açılıyor…")}</Text>
            </View>
          )}
          // no connection: the WebView's own English "Error loading page"
          // with an error code, and no way to try again
          renderError={() => (
            <View style={[styles.videoLoading, { paddingHorizontal: 28 }]}>
              <Ionicons name="cloud-offline-outline" size={26} color={colors.gold2} />
              <Text style={[styles.videoLoadingText, { textAlign: 'center', lineHeight: 19 }]}>
                {t("Görüntülü ders bağlantısı yüklenemedi. İnternet bağlantını kontrol edip tekrar dene.")}
              </Text>
              <Pressable onPress={() => setWebViewKey((k) => k + 1)} style={styles.videoRetry}>
                <Text style={styles.videoRetryText}>{t("Tekrar dene")}</Text>
              </Pressable>
            </View>
          )}
        />
      </View>

      <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable onPress={() => setPanelOpen((v) => !v)} style={styles.grabArea} accessibilityLabel={panelOpen ? t("Paneli kapat") : t("Paneli aç")}>
          <View style={styles.grab} />
        </Pressable>
        <View style={styles.panelTabs}>
          {(
            [
              ['words', t("Kelimeler{0}", words.length ? ` · ${words.length}` : '')],
              ['notes', t("Notlar")],
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
                <View key={w} style={styles.word}>
                  <Ionicons name="checkmark" size={12} color={colors.faint} />
                  <Text style={styles.wordText}>{w}</Text>
                </View>
              ))}
              {words.length === 0 && (
                <Text style={styles.panelHint}>
                  {isStudent
                    ? t("Derste duyduğun yeni kelimeyi anlamıyla yaz, kelime kartlarına eklenir.")
                    : t("Yeni bir kelimeyi anlamıyla yaz, öğrencinin kelime kartlarına eklenir.")}
                </Text>
              )}
            </View>
            <View style={styles.addRow}>
              <TextInput
                value={wordInput}
                onChangeText={setWordInput}
                onSubmitEditing={() => meaningField.current?.focus()}
                placeholder={t("Yeni kelime")}
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                returnKeyType="next"
                submitBehavior="submit"
                style={styles.addInput}
              />
              <TextInput
                ref={meaningField}
                value={meaningInput}
                onChangeText={setMeaningInput}
                onSubmitEditing={addWord}
                placeholder={t("Anlamı")}
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                returnKeyType="done"
                style={styles.addInput}
              />
              <Pressable onPress={addWord} disabled={pinning} style={[styles.addBtn, pinning && { opacity: 0.6 }]} accessibilityLabel={t("Kelime ekle")}>
                {pinning ? <ActivityIndicator size="small" color={colors.gold2} /> : <Ionicons name="add" size={20} color={colors.gold2} />}
              </Pressable>
            </View>
          </>
        )}

        {panelOpen && panelTab === 'notes' && (
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={t("Bu dersten aklında kalmasını istediklerin…")}
            placeholderTextColor={colors.faint}
            multiline
            style={styles.noteInput}
          />
        )}
      </View>

      <Modal visible={reportOpen} transparent animationType="slide" onRequestClose={() => setReportOpen(false)}>
        <Pressable style={styles.sheetShade} onPress={() => setReportOpen(false)} />
        {/* "how many minutes late" is typed here: keep the sheet above the keyboard */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.reportSheet, { maxHeight: windowHeight * 0.86, paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
          <View style={styles.sheetGrab} />
          <Text style={styles.reportTitle}>{t("Bir sorun bildir")}</Text>
          {reportExisting ? (
            <>
              <Text style={styles.reportText}>{t("Bu ders için zaten bir bildirim göndermiştin.")}</Text>
              <View style={{ marginTop: 14 }}>
                <Button label={t("Kapat")} variant="outline" onPress={() => setReportOpen(false)} />
              </View>
            </>
          ) : reportMessage ? (
            <>
              <Text style={styles.reportText}>{reportMessage}</Text>
              <View style={{ marginTop: 14 }}>
                <Button label={t("Kapat")} variant="outline" onPress={() => setReportOpen(false)} />
              </View>
            </>
          ) : (
            me && (
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <Text style={[styles.reportText, { marginBottom: 14 }]}>{t("Öğretmenle ilgili ne bildirmek istiyorsun?")}</Text>
                <AttendanceFlow
                  booking={booking}
                  studentId={me.id}
                  lessonStarted={lessonStarted()}
                  noShowReady={noShowReady()}
                  onCancel={() => setReportOpen(false)}
                  onFiled={(_report, message) => setReportMessage(message)}
                />
              </ScrollView>
            )
          )}
        </View>
        </KeyboardAvoidingView>
      </Modal>
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
  checkinContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32 },
  reportBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginRight: 8,
  },
  sheetShade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  reportSheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 10,
  },
  sheetGrab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 14 },
  reportTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink, letterSpacing: -0.3, marginBottom: 6 },
  reportText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
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
  videoRetry: { marginTop: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', paddingHorizontal: 18, paddingVertical: 9 },
  videoRetryText: { fontFamily: fonts.bodyBold, fontSize: 13, color: '#fff' },
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
  addInput: { flex: 1, minWidth: 0, height: 46, borderRadius: 14, backgroundColor: colors.panel2, paddingHorizontal: 14, fontFamily: fonts.bodyMedium, fontSize: 14.5, color: colors.ink },
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
