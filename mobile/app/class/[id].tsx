import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';

import Button from '../../components/Button';
import { useAuth } from '../../lib/auth';
import { canJoinLessonNow, formatTimeRange, getBookingById, lessonWindow, roomNameForBooking, type Booking } from '../../lib/bookings';
import { shortDisplayName } from '../../lib/displayName';
import { addReview, getReviewForBooking } from '../../lib/reviews';
import { colors, fonts, radius } from '../../lib/theme';

type Phase = 'loading' | 'tooEarly' | 'tooLate' | 'noAccess' | 'cancelled' | 'room' | 'review';

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

    getBookingById(id).then((b) => {
      if (!b) {
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
  }, [id, profile]);

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

  async function handleLeave() {
    if (!booking || !profile) return;

    const existing = await getReviewForBooking(booking.id);
    if (existing) {
      router.replace('/(tabs)/lessons');
      return;
    }
    setPhase('review');
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
    return (
      <Gate
        title="Henüz erken"
        subtitle={`${otherName} ile ${booking.dateLabel}, ${formatTimeRange(booking.time)} — ${minutesUntil} dakika sonra katılabileceksin.`}
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
          {otherName} ile ders · {formatTimeRange(booking.time)}
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
