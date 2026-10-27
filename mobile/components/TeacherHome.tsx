import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../lib/auth';
import {
  TEACHER_MONTHLY_CANCEL_LIMIT,
  bookingCancellable,
  cancelBooking,
  canJoinLessonNow,
  formatLessonWhenForViewer,
  formatRescheduleSlot,
  getBookingsForTeacher,
  getPendingRescheduleRequests,
  isBookingPast,
  lessonTypeLabel,
  lessonWindow,
  localDateKey,
  rescheduleBooking,
  respondReschedule,
  teacherCancelsThisMonth,
  todayIn,
  withdrawReschedule,
  type Booking,
  type RescheduleRequest,
} from '../lib/bookings';
import { formatMoney } from '../lib/credits';
import { confirmAsync, notify } from '../lib/dialogs';
import { getTeacherCredits, getWithdrawalRequests, summarizeEarnings, type EarningsSummary } from '../lib/earnings';
import { colors, fonts, radius } from '../lib/theme';
import ReschedulePicker from './ReschedulePicker';

const LIMIT_MESSAGE =
  'Bu ay 3 ders iptal hakkını kullandın. Dersin saatini değiştirmek için öğrencine "Saat Öner" ile yeni bir saat önerebilirsin; gerçekten acil bir durumsa destek ekibimize yaz.';

type Row = { kind: 'heading'; key: string; title: string } | { kind: 'lesson'; key: string; booking: Booking; compact: boolean } | { kind: 'empty'; key: string; text: string };

// The teacher's "Bugün" tab: today's and every upcoming lesson, with the
// same actions dashboard.html offers - propose a new time (doesn't count
// toward the monthly cap), answer a student's request, cancel (3 a month,
// migration_107.sql).
export default function TeacherHome() {
  const { profile } = useAuth();
  const timeZone = profile?.timezone || 'Europe/Istanbul';
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [pending, setPending] = useState<Record<string, RescheduleRequest>>({});
  const [earnings, setEarnings] = useState<EarningsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [proposing, setProposing] = useState<Booking | null>(null);
  const [submittingMove, setSubmittingMove] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    const [data, credits, withdrawals] = await Promise.all([
      getBookingsForTeacher(profile.id),
      getTeacherCredits(profile.id),
      getWithdrawalRequests(profile.id),
    ]);
    setPending(await getPendingRescheduleRequests(data.filter(bookingCancellable).map((b) => b.id)));
    setBookings(data);
    setEarnings(summarizeEarnings(data, credits, withdrawals, timeZone));
    setLoading(false);
    setRefreshing(false);
  }, [profile, timeZone]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // lesson dates are wall-clock dates in the teacher's own timezone - "today"
  // must be too (a UTC date string was a day off around midnight)
  const todayKey = localDateKey(todayIn(timeZone));
  const active = bookings.filter((b) => b.status !== 'cancelled');
  const startOf = (b: Booking) => lessonWindow(b).start.getTime();
  const today = active.filter((b) => b.date === todayKey).sort((a, b) => startOf(a) - startOf(b));
  const upcoming = active.filter((b) => b.date > todayKey).sort((a, b) => startOf(a) - startOf(b));
  const studentCount = new Set(active.map((b) => b.studentId)).size;
  const cancelsLeft = Math.max(0, TEACHER_MONTHLY_CANCEL_LIMIT - teacherCancelsThisMonth(bookings, timeZone));

  const rows: Row[] = [
    { kind: 'heading', key: 'h-today', title: 'Bugünkü derslerin' },
    ...(today.length
      ? today.map((b) => ({ kind: 'lesson' as const, key: b.id, booking: b, compact: false }))
      : [{ kind: 'empty' as const, key: 'e-today', text: 'Bugün planlanmış bir dersin yok.' }]),
    ...(upcoming.length ? [{ kind: 'heading' as const, key: 'h-up', title: 'Yaklaşan dersler' }] : []),
    ...upcoming.map((b) => ({ kind: 'lesson' as const, key: b.id, booking: b, compact: true })),
  ];

  async function handleCancel(b: Booking) {
    if (cancelsLeft <= 0) {
      notify('İptal hakkın kalmadı', LIMIT_MESSAGE);
      return;
    }
    const ok = await confirmAsync(
      'Dersi iptal et',
      `Bu dersi iptal etmek istediğine emin misin? Ödenmişse öğrenciye bir ders hakkı eklenir.\n\nBu iptal, bu ayki iptal hakkından düşer (kalan: ${cancelsLeft}). Öğrencine yeni bir saat önermek istersen "Saat Öner"i kullan.`,
      'İptal Et',
      true
    );
    if (!ok) return;
    setActingId(b.id);
    const result = await cancelBooking(b.id);
    setActingId(null);
    if (!result.ok) {
      notify('İptal edilemedi', result.limitReached ? LIMIT_MESSAGE : result.error);
      return;
    }
    load();
  }

  async function act(bookingId: string, call: () => Promise<{ ok: boolean; error?: string }>) {
    setActingId(bookingId);
    const result = await call();
    setActingId(null);
    if (!result.ok) {
      notify('İşlem yapılamadı', result.error);
      return;
    }
    load();
  }

  async function confirmProposal(pick: { date: string; time: string }) {
    if (!proposing) return;
    setSubmittingMove(true);
    const result = await rescheduleBooking(proposing.id, pick.date, pick.time);
    setSubmittingMove(false);
    if (!result.ok) {
      notify('Saat önerilemedi', result.error);
      return;
    }
    setProposing(null);
    notify('Önerin gönderildi', 'Öğrencin onaylarsa ders yeni saate taşınır. Ders başlayana kadar onaylamazsa ders eski saatinde kalır.');
    load();
  }

  function renderLesson(b: Booking, compact: boolean) {
    const when = formatLessonWhenForViewer(b);
    const joinable = canJoinLessonNow(b);
    const cancellable = bookingCancellable(b);
    const request = pending[b.id];
    const busy = actingId === b.id;
    const done = isBookingPast(b) && !joinable;
    return (
      <View style={[styles.bookingCard, done && styles.bookingCardDone]}>
        <View style={styles.bookingRow}>
          <Text style={styles.bookingName}>{b.studentName}</Text>
          <Text style={styles.bookingMeta}>{compact ? `${when.dateLabel} · ${when.time}` : when.timeRange}</Text>
        </View>
        <Text style={styles.bookingType}>
          {lessonTypeLabel(b.type)}
          {done ? ' · tamamlandı' : ''}
        </Text>

        {joinable && (
          <Pressable style={styles.joinBtn} onPress={() => router.push(`/class/${b.id}`)}>
            <Text style={styles.joinBtnText}>🎥 Derse Katıl</Text>
          </Pressable>
        )}

        {cancellable && request && (
          <View style={styles.requestBox}>
            <Text style={styles.requestText}>
              {request.requestedBy === 'student' ? 'Öğrenci yeni bir saat istedi: ' : 'Önerin öğrenci onayı bekliyor: '}
              <Text style={styles.requestSlot}>{formatRescheduleSlot(request.newDate, request.newTime, b.teacherTimezone)}</Text>
            </Text>
            <View style={styles.actionRow}>
              {request.requestedBy === 'student' ? (
                <>
                  <Pressable disabled={busy} onPress={() => act(b.id, () => respondReschedule(request.id, true))} style={[styles.smallBtn, styles.smallBtnPrimary]}>
                    <Text style={[styles.smallBtnText, styles.smallBtnTextPrimary]}>Kabul Et</Text>
                  </Pressable>
                  <Pressable disabled={busy} onPress={() => act(b.id, () => respondReschedule(request.id, false))} style={styles.smallBtn}>
                    <Text style={styles.smallBtnText}>Reddet</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable disabled={busy} onPress={() => act(b.id, () => withdrawReschedule(request.id))} style={styles.smallBtn}>
                  <Text style={styles.smallBtnText}>Geri Çek</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {cancellable && (
          <View style={[styles.actionRow, { marginTop: 12 }]}>
            {!request && (
              <Pressable disabled={busy} onPress={() => setProposing(b)} style={styles.smallBtn}>
                <Text style={styles.smallBtnText}>Saat Öner</Text>
              </Pressable>
            )}
            <Pressable disabled={busy} onPress={() => handleCancel(b)} style={[styles.smallBtn, styles.smallBtnDanger]}>
              <Text style={[styles.smallBtnText, styles.smallBtnTextDanger]}>{busy ? '…' : 'Dersi İptal Et'}</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]} edges={['top']}>
        <ActivityIndicator color={colors.gold3} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.gold3}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <Text style={styles.eyebrow}>BUGÜN</Text>
            <Text style={styles.title}>Merhaba, {profile?.name?.split(' ')[0] || 'Öğretmen'} 👋</Text>

            <View style={styles.statRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{today.length}</Text>
                <Text style={styles.statLabel}>Bugünkü ders</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{studentCount}</Text>
                <Text style={styles.statLabel}>Öğrenci</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{active.length}</Text>
                <Text style={styles.statLabel}>Toplam ders</Text>
              </View>
            </View>

            {earnings && (
              <Pressable onPress={() => router.push('/earnings')} style={({ pressed }) => [styles.earningsCard, { opacity: pressed ? 0.9 : 1 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.earningsLabel}>Bu ayki kazancın (tahmini)</Text>
                  <Text style={styles.earningsValue}>{formatMoney(earnings.netThisMonth)}</Text>
                  <Text style={styles.earningsSub}>Çekilebilir: {formatMoney(earnings.withdrawableBalance)}</Text>
                </View>
                <Text style={styles.earningsLink}>Kazançlarım →</Text>
              </Pressable>
            )}

            {bookings.length > 0 && (
              <Text style={styles.allowance}>
                Bu ay kalan iptal hakkın: <Text style={{ fontFamily: fonts.bodyExtraBold }}>{cancelsLeft} / {TEACHER_MONTHLY_CANCEL_LIMIT}</Text> · Bir
                dersin saatini değiştirmek için iptal yerine "Saat Öner"i kullan, iptal hakkından düşmez.
              </Text>
            )}
          </View>
        }
        renderItem={({ item: row }) =>
          row.kind === 'heading' ? (
            <Text style={styles.sectionTitle}>{row.title}</Text>
          ) : row.kind === 'empty' ? (
            <Text style={styles.empty}>{row.text}</Text>
          ) : (
            renderLesson(row.booking, row.compact)
          )
        }
      />

      {proposing && (
        <ReschedulePicker
          visible
          teacher={null}
          timeZone={proposing.teacherTimezone || timeZone}
          busyTimes={active.map((b) => ({ date: b.date, time: b.time }))}
          current={{ date: proposing.date, time: proposing.time }}
          title="Öğrencine yeni bir saat öner"
          note="Öğrencin onaylarsa ders yeni saate taşınır. Ders başlayana kadar onaylamazsa ders eski saatinde kalır. Saat önermek iptal hakkından düşmez."
          confirmLabel="Bu Saati Öner"
          submitting={submittingMove}
          onClose={() => setProposing(null)}
          onConfirm={confirmProposal}
        />
      )}
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
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  headerBlock: {
    paddingTop: 8,
    paddingBottom: 6,
  },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    letterSpacing: 1,
    color: colors.goldText,
    marginBottom: 8,
  },
  title: {
    fontFamily: fonts.displayBlack,
    fontSize: 25,
    lineHeight: 31,
    color: colors.ink,
    letterSpacing: -0.5,
    marginBottom: 18,
  },
  statRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.panel,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    paddingVertical: 14,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 20,
    color: colors.ink,
  },
  statLabel: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 3,
    textAlign: 'center',
  },
  earningsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff8e6',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.gold2,
    padding: 14,
    marginBottom: 14,
  },
  earningsLabel: {
    fontFamily: fonts.bodySemibold,
    fontSize: 12,
    color: colors.muted,
  },
  earningsValue: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
    marginVertical: 2,
  },
  earningsSub: {
    fontFamily: fonts.bodySemibold,
    fontSize: 12,
    color: colors.goldText,
  },
  earningsLink: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.goldText,
  },
  allowance: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
    marginBottom: 18,
  },
  sectionTitle: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 15,
    color: colors.ink,
    marginTop: 6,
    marginBottom: 10,
  },
  empty: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.muted,
    marginBottom: 14,
  },
  bookingCard: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 14,
    marginBottom: 10,
  },
  bookingCardDone: {
    opacity: 0.6,
  },
  bookingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  bookingName: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 15,
    color: colors.ink,
    flexShrink: 1,
  },
  bookingMeta: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13,
    color: colors.muted,
  },
  bookingType: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 3,
  },
  joinBtn: {
    marginTop: 12,
    backgroundColor: colors.gold3,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  joinBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.onGold,
  },
  requestBox: {
    marginTop: 12,
    backgroundColor: '#fff8e6',
    borderRadius: radius.md,
    padding: 10,
    gap: 8,
  },
  requestText: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.ink,
  },
  requestSlot: {
    fontFamily: fonts.bodyBold,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  smallBtn: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.bg,
  },
  smallBtnPrimary: {
    borderColor: colors.gold3,
    backgroundColor: colors.gold3,
  },
  smallBtnDanger: {
    borderColor: '#f3c9c6',
  },
  smallBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.ink,
  },
  smallBtnTextPrimary: {
    color: colors.onGold,
  },
  smallBtnTextDanger: {
    color: colors.error,
  },
});
