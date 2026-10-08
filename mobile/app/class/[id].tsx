import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';

import Button from '../../components/Button';
import { getAttendanceReportForBooking, reportAttendanceIssue } from '../../lib/attendance';
import { useAuth } from '../../lib/auth';
import {
  canJoinLessonNow,
  formatLessonWhenForViewer,
  getBookingById,
  lessonWindow,
  roomNameForBooking,
  type Booking,
} from '../../lib/bookings';
import { shortDisplayName } from '../../lib/displayName';
import { addReview, getReviewForBooking } from '../../lib/reviews';
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

  const [phase, setPhase] = useState<Phase>('loading');
  const [booking, setBooking] = useState<Booking | null>(null);
  const [minutesUntil, setMinutesUntil] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [overtime, setOvertime] = useState(false);

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
      } else {
        setOvertime(false);
        setProgressLabel(`${formatClock(now.getTime() - start.getTime())} geçti · ${formatClock(end.getTime() - now.getTime())} kaldı`);
      }
    }

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  const [checkinBusy, setCheckinBusy] = useState(false);
  const [checkinError, setCheckinError] = useState(false);

  // Only the student rates a lesson or reports the teacher's attendance -
  // mirrors class.html's `if (isStudent)` gate around its whole
  // post-class modal. A teacher leaving just goes straight back.
  async function handleLeave() {
    if (!booking || !profile) return;

    if (profile.id !== booking.studentId) {
      router.replace('/(tabs)/lessons');
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
        router.replace('/(tabs)/lessons');
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
        router.replace('/(tabs)/lessons');
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
    router.replace('/(tabs)/lessons');
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
    router.replace('/(tabs)/lessons');
  }

  if (phase === 'loading') {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.gold3} />
      </SafeAreaView>
    );
  }

  if (phase === 'noAccess') {
    return (
      <Gate
        title="Bu derse erişimin yok"
        subtitle="Bu ders bağlantısı geçersiz ya da bu dersin katılımcılarından biri değilsin."
        buttonLabel="Derslerime dön"
        onPress={() => router.replace('/(tabs)/lessons')}
      />
    );
  }

  if (phase === 'cancelled') {
    return (
      <Gate
        title="Bu ders iptal edildi"
        subtitle="Bu ders artık gerçekleşmeyecek."
        buttonLabel="← Geri dön"
        onPress={() => router.replace('/(tabs)/lessons')}
      />
    );
  }

  if (phase === 'tooEarly' && booking) {
    const isStudent = profile?.id === booking.studentId;
    const otherName = isStudent ? shortDisplayName(booking.teacherName) : booking.studentName;
    const when = formatLessonWhenForViewer(booking);
    return (
      <Gate
        title="Henüz erken"
        subtitle={`${otherName} ile ${when.dateLabel}, ${when.timeRange} — ${minutesUntil} dakika sonra katılabileceksin.`}
        buttonLabel="Derslerime dön"
        onPress={() => router.replace('/(tabs)/lessons')}
      />
    );
  }

  if (phase === 'tooLate') {
    return (
      <Gate
        title="Bu dersin katılım süresi doldu"
        subtitle="Ders saati ve sonrasındaki katılım penceresi geçti."
        buttonLabel="Derslerime dön"
        onPress={() => router.replace('/(tabs)/lessons')}
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
            <Pressable onPress={() => router.replace('/(tabs)/lessons')}>
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
          <Pressable onPress={() => router.replace('/(tabs)/lessons')}>
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

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {otherName} ile ders · {formatLessonWhenForViewer(booking).timeRange}
        </Text>
        <Pressable onPress={handleLeave} style={styles.leaveBtn}>
          <Text style={styles.leaveBtnText}>Ayrıl</Text>
        </Pressable>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, overtime && styles.progressFillOvertime, { width: `${progressPct}%` }]} />
      </View>
      <Text style={styles.progressLabel}>{progressLabel}</Text>

      <WebView
        source={{ uri: roomUrl }}
        style={{ flex: 1 }}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        startInLoadingState
        renderLoading={() => <ActivityIndicator color={colors.gold3} style={{ marginTop: 40 }} />}
      />
    </SafeAreaView>
  );
}

function Gate({
  title,
  subtitle,
  buttonLabel,
  onPress,
}: {
  title: string;
  subtitle: string;
  buttonLabel: string;
  onPress: () => void;
}) {
  return (
    <SafeAreaView style={[styles.screen, styles.centered, { paddingHorizontal: 28 }]}>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.bodyExtraBold,
    fontSize: 14.5,
    color: colors.ink,
    marginRight: 12,
  },
  leaveBtn: {
    backgroundColor: colors.panel2,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  leaveBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.error,
  },
  progressTrack: {
    height: 4,
    backgroundColor: colors.panel2,
  },
  progressFill: {
    height: 4,
    backgroundColor: colors.gold3,
  },
  progressFillOvertime: {
    backgroundColor: colors.error,
  },
  progressLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: 6,
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
