import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../lib/auth';
import { getBlockedStudents } from '../lib/blocks';
import {
  TEACHER_MONTHLY_CANCEL_LIMIT,
  bookingCancellable,
  cancelBooking,
  canJoinLessonNow,
  formatLessonWhenForViewer,
  formatRescheduleSlot,
  getAllBookingsForTeacher,
  getPendingRescheduleRequests,
  getRescheduleCounts,
  MAX_TEACHER_PROPOSALS,
  isBookingPast,
  lessonTypeLabel,
  lessonWindow,
  localDateKey,
  rescheduleBooking,
  respondReschedule,
  teacherCancelsThisMonth,
  teacherCancelWeight,
  withdrawReschedule,
  type Booking,
  type RescheduleRequest,
} from '../lib/bookings';
import { formatMoney } from '../lib/credits';
import { confirmAsync, notify } from '../lib/dialogs';
import { getTeacherCredits, getWithdrawalRequests, summarizeEarnings, type EarningsSummary } from '../lib/earnings';
import { capitalizeName } from '../lib/displayName';
import { colors, fonts, radius } from '../lib/theme';
import Band, { ScrollBand } from './Band';
import ReschedulePicker from './ReschedulePicker';
import TeacherAttendanceBanner from './TeacherAttendanceBanner';
import { useT } from '../lib/i18n';

const LIMIT_MESSAGE =
  'Bu ay 3 ders iptal hakkını kullandın. Dersin saatini değiştirmek için öğrencine "Saat Öner" ile yeni bir saat önerebilirsin; gerçekten acil bir durumsa destek ekibimize yaz.';
// migration_112.sql: a cancellation less than 12 hours before the lesson weighs 2
const LATE_LIMIT_MESSAGE =
  'Derse 12 saatten az kala yapılan iptal 2 iptal hakkı sayılır ve bu ay bunun için yeterli hakkın kalmadı. Öğrencine "Saat Öner" ile yeni bir saat önerebilirsin; gerçekten acil bir durumsa destek ekibimize yaz.';

type Row = { kind: 'heading'; key: string; title: string } | { kind: 'lesson'; key: string; booking: Booking; compact: boolean } | { kind: 'empty'; key: string; text: string };

// The teacher's "Bugün" tab: today's and every upcoming lesson, with the
// same actions dashboard.html offers - propose a new time (doesn't count
// toward the monthly cap), answer a student's request, cancel (3 a month,
// migration_107.sql).
export default function TeacherHome() {
  const t = useT();
  const { profile } = useAuth();
  const timeZone = profile?.timezone || 'Europe/Istanbul';
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [pending, setPending] = useState<Record<string, RescheduleRequest>>({});
  // a teacher proposes a new time at most 2 times per lesson (migration_112.sql)
  const [proposalCounts, setProposalCounts] = useState<Record<string, { studentMoves: number; teacherProposals: number }>>({});
  const [earnings, setEarnings] = useState<EarningsSummary | null>(null);
  // cancelling a blocked student's lesson doesn't count toward the cap
  // (cancel-booking checks blocked_students)
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  // a second tap before the screen redraws must not send the same call twice
  const actingRef = useRef(false);
  const [proposing, setProposing] = useState<Booking | null>(null);
  const [submittingMove, setSubmittingMove] = useState(false);
  // bumps on every refresh so the attendance banner re-reads its report
  const [reloadKey, setReloadKey] = useState(0);

  // the lessons couldn't be read: say so instead of "no lessons today"
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    setReloadKey((k) => k + 1);
    const [data, credits, withdrawals, blockedIds] = await Promise.all([
      getAllBookingsForTeacher(profile.id),
      getTeacherCredits(profile.id),
      getWithdrawalRequests(profile.id),
      getBlockedStudents(profile.id),
    ]);
    setLoadFailed(!data);
    if (!data) {
      // what was already on screen stays
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const openIds = data.filter(bookingCancellable).map((b) => b.id);
    const [pendingData, countsData] = await Promise.all([getPendingRescheduleRequests(openIds), getRescheduleCounts(openIds)]);
    setPending(pendingData);
    setProposalCounts(countsData);
    setBlocked(blockedIds);
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

  // The join button, "tamamlandı" and the cancel / propose buttons all
  // depend on the clock: redraw every minute while the tab is open, like
  // dashboard.html's agenda (setInterval(renderAgenda, 60000)). The list
  // used to stay as it was drawn, so "Derse katıl" never showed up for a
  // teacher who opened the tab before the lesson's join window.
  const [, setClock] = useState(0);
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => setClock((n) => n + 1), 60_000);
      return () => clearInterval(timer);
    }, [])
  );

  // A lesson belongs to the day its real start falls on, on this phone's
  // clock - the clock its time is shown in (formatLessonWhenForViewer),
  // like dashboard.html's agenda (bookingLocalDateKey). Comparing the
  // booking's frozen lesson_date (wall-clock in the zone it was booked in)
  // with today in profiles.timezone put a lesson under the wrong day when
  // the two zones differ, e.g. a lesson at 01:00 on the phone listed
  // under "upcoming" while its time read today.
  const todayKey = localDateKey(new Date());
  const dayOf = (b: Booking) => localDateKey(lessonWindow(b).start);
  const active = bookings.filter((b) => b.status !== 'cancelled');
  const startOf = (b: Booking) => lessonWindow(b).start.getTime();
  // a lesson that began before midnight stays here while it can still be joined
  const today = active.filter((b) => dayOf(b) === todayKey || canJoinLessonNow(b)).sort((a, b) => startOf(a) - startOf(b));
  const upcoming = active.filter((b) => dayOf(b) > todayKey && !canJoinLessonNow(b)).sort((a, b) => startOf(a) - startOf(b));
  const studentCount = new Set(active.map((b) => b.studentId)).size;
  const cancelsLeft = Math.max(0, TEACHER_MONTHLY_CANCEL_LIMIT - teacherCancelsThisMonth(bookings, timeZone));

  const rows: Row[] = [
    { kind: 'heading', key: 'h-today', title: t("Bugünkü derslerin") },
    ...(loadFailed && !bookings.length
      ? [{ kind: 'empty' as const, key: 'e-failed', text: t("Derslerin yüklenemedi. Aşağı çekerek tekrar dene.") }]
      : today.length
        ? today.map((b) => ({ kind: 'lesson' as const, key: b.id, booking: b, compact: false }))
        : [{ kind: 'empty' as const, key: 'e-today', text: t("Bugün planlanmış bir dersin yok.") }]),
    ...(upcoming.length ? [{ kind: 'heading' as const, key: 'h-up', title: t("Yaklaşan dersler") }] : []),
    ...upcoming.map((b) => ({ kind: 'lesson' as const, key: b.id, booking: b, compact: true })),
  ];

  // mirrors dashboard.html's cancel button: a blocked student's lesson
  // doesn't count, a last-minute one counts 2
  async function handleCancel(b: Booking) {
    if (actingRef.current) return;
    const counts = !blocked.has(b.studentId);
    const weight = teacherCancelWeight(b);
    if (counts && cancelsLeft < weight) {
      notify(t("İptal hakkın kalmadı"), weight === 2 && cancelsLeft > 0 ? t(LATE_LIMIT_MESSAGE) : t(LIMIT_MESSAGE));
      return;
    }
    let message = t("Bu dersi iptal etmek istediğine emin misin? Ödenmişse öğrenciye bir ders hakkı eklenir.");
    if (counts) {
      message +=
        '\n\n' +
        (weight === 2
          ? t("Derse 12 saatten az kaldığı için bu iptal, bu ayki iptal hakkından 2 hak düşer (kalan: {0}). Öğrencine yeni bir saat önermek istersen \"Saat Öner\"i kullan.", cancelsLeft)
          : t("Bu iptal, bu ayki iptal hakkından düşer (kalan: {0}). Öğrencine yeni bir saat önermek istersen \"Saat Öner\"i kullan.", cancelsLeft));
    }
    const ok = await confirmAsync(t("Dersi iptal et"), message, t("İptal Et"), true);
    if (!ok || actingRef.current) return;
    actingRef.current = true;
    setActingId(b.id);
    const result = await cancelBooking(b.id);
    actingRef.current = false;
    setActingId(null);
    if (!result.ok) {
      notify(t("İptal edilemedi"), result.limitReached ? t(weight === 2 ? LATE_LIMIT_MESSAGE : LIMIT_MESSAGE) : t(result.error));
      return;
    }
    load();
  }

  async function act(bookingId: string, call: () => Promise<{ ok: boolean; error?: string }>) {
    if (actingRef.current) return;
    actingRef.current = true;
    setActingId(bookingId);
    const result = await call();
    actingRef.current = false;
    setActingId(null);
    if (!result.ok) {
      notify(t("İşlem yapılamadı"), result.error);
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
      notify(t("Saat önerilemedi"), result.error);
      return;
    }
    setProposing(null);
    notify(t("Önerin gönderildi"), t("Öğrencin onaylarsa ders yeni saate taşınır. Ders başlayana kadar onaylamazsa ders eski saatinde kalır."));
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
          <Text style={styles.bookingName}>{capitalizeName(b.studentName)}</Text>
          <Text style={styles.bookingMeta}>{compact ? `${when.dateLabel} · ${when.time}` : when.timeRange}</Text>
        </View>
        <Text style={styles.bookingType}>
          {lessonTypeLabel(b.type)}
          {done ? t(" · tamamlandı") : ''}
        </Text>

        {joinable && (
          <Pressable style={styles.joinBtn} onPress={() => router.push(`/class/${b.id}`)}>
            <Text style={styles.joinBtnText}>{t("Derse katıl")}</Text>
          </Pressable>
        )}

        {cancellable && request && (
          <View style={styles.requestBox}>
            <Text style={styles.requestText}>
              {request.requestedBy === 'student' ? t("Öğrenci yeni bir saat istedi: ") : t("Önerin öğrenci onayı bekliyor: ")}
              <Text style={styles.requestSlot}>{formatRescheduleSlot(request.newDate, request.newTime, b.teacherTimezone)}</Text>
            </Text>
            <View style={styles.actionRow}>
              {request.requestedBy === 'student' ? (
                <>
                  <Pressable disabled={busy} onPress={() => act(b.id, () => respondReschedule(request.id, true))} style={[styles.smallBtn, styles.smallBtnPrimary]}>
                    <Text style={[styles.smallBtnText, styles.smallBtnTextPrimary]}>{t("Kabul Et")}</Text>
                  </Pressable>
                  <Pressable disabled={busy} onPress={() => act(b.id, () => respondReschedule(request.id, false))} style={styles.smallBtn}>
                    <Text style={styles.smallBtnText}>{t("Reddet")}</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable disabled={busy} onPress={() => act(b.id, () => withdrawReschedule(request.id))} style={styles.smallBtn}>
                  <Text style={styles.smallBtnText}>{t("Geri Çek")}</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {cancellable && (
          <View style={[styles.actionRow, { marginTop: 12 }]}>
            {!request && MAX_TEACHER_PROPOSALS - (proposalCounts[b.id]?.teacherProposals || 0) > 0 && (
              <Pressable disabled={busy} onPress={() => setProposing(b)} style={styles.smallBtn}>
                <Text style={styles.smallBtnText}>{t("Saat Öner")}</Text>
              </Pressable>
            )}
            <Pressable disabled={busy} onPress={() => handleCancel(b)} style={[styles.smallBtn, styles.smallBtnDanger]}>
              <Text style={[styles.smallBtnText, styles.smallBtnTextDanger]}>{busy ? '…' : t("Dersi İptal Et")}</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <Band height={175} />
        <SafeAreaView style={[styles.safe, styles.centered]} edges={['top']}>
          <ActivityIndicator color={colors.onRed} />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeRed} edges={['top']}>
      <FlatList
          extraData={t}
        style={styles.list}
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
            tintColor={colors.onRed}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            {/* the red band under the greeting and the three numbers (design A) */}
            <ScrollBand height={175} inset={20} />
            <Text style={styles.eyebrow}>{t("ÖĞRETMEN PANELİ · BUGÜN")}</Text>
            <Text style={styles.title}>{t("Merhaba, ")}{capitalizeName(profile?.name).split(' ')[0] || t("Öğretmen")}</Text>

            <View style={styles.statRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{today.length}</Text>
                <Text style={styles.statLabel}>{t("Bugünkü ders")}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{studentCount}</Text>
                <Text style={styles.statLabel}>{t("Öğrenci", studentCount)}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{active.length}</Text>
                <Text style={styles.statLabel}>{t("Toplam ders")}</Text>
              </View>
            </View>

            {/* a student's report / the hide state - dashboard.html's attendance banner */}
            <TeacherAttendanceBanner reloadKey={reloadKey} />

            {earnings && (
              <Pressable onPress={() => router.push('/earnings')} style={({ pressed }) => [styles.earningsCard, { opacity: pressed ? 0.9 : 1 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.earningsLabel}>{t("Bu ayki kazancın (tahmini)")}</Text>
                  <Text style={styles.earningsValue}>{formatMoney(earnings.netThisMonth)}</Text>
                  <Text style={styles.earningsSub}>{t("Çekilebilir: {0}", formatMoney(earnings.withdrawableBalance))}</Text>
                </View>
                <Text style={styles.earningsLink}>{t("Kazançlarım")}</Text>
              </Pressable>
            )}

            {bookings.length > 0 && (
              <Text style={styles.allowance}>
                {t("Bu ay kalan iptal hakkın: ")}<Text style={{ fontFamily: fonts.bodyExtraBold }}>{cancelsLeft} / {TEACHER_MONTHLY_CANCEL_LIMIT}</Text>{t(" · Derse 12 saatten az kala yapılan iptal 2 hak sayılır.")}{t(" · Bir dersin saatini değiştirmek için iptal yerine \"Saat Öner\"i kullan, iptal hakkından düşmez.")}</Text>
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
          title={t("Öğrencine yeni bir saat öner")}
          note={t("Öğrencin onaylarsa ders yeni saate taşınır. Ders başlayana kadar onaylamazsa ders eski saatinde kalır. Saat önermek iptal hakkından düşmez. Bir ders için en fazla 2 kez saat önerebilirsin (kalan: {0}).", MAX_TEACHER_PROPOSALS - (proposalCounts[proposing.id]?.teacherProposals || 0))}
          confirmLabel={t("Bu Saati Öner")}
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
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  // the status bar area is plain red; the list paints the ground and carries the band
  safeRed: { flex: 1, backgroundColor: colors.red },
  list: { flex: 1, backgroundColor: colors.bg },
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
    color: 'rgba(250,245,226,0.8)',
    marginBottom: 8,
  },
  title: {
    fontFamily: fonts.displayBlack,
    fontSize: 25,
    lineHeight: 31,
    color: colors.onRed,
    letterSpacing: -0.5,
    marginBottom: 18,
  },
  statRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  // the three numbers sit on the red band: see-through cream tiles
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(250,245,226,0.14)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(250,245,226,0.24)',
    paddingVertical: 14,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.onRed,
  },
  statLabel: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: 'rgba(250,245,226,0.82)',
    marginTop: 3,
    textAlign: 'center',
  },
  earningsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark,
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  earningsLabel: {
    fontFamily: fonts.bodySemibold,
    fontSize: 12,
    color: 'rgba(250,245,226,0.8)',
  },
  earningsValue: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.onRed,
    marginVertical: 3,
  },
  earningsSub: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.gold2,
  },
  earningsLink: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 13,
    color: colors.red,
    backgroundColor: colors.cream,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    overflow: 'hidden',
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
    backgroundColor: colors.red,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  joinBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.onRed,
  },
  requestBox: {
    marginTop: 12,
    backgroundColor: colors.goldPale,
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
    backgroundColor: colors.panel,
  },
  smallBtnPrimary: {
    borderColor: colors.dark,
    backgroundColor: colors.dark,
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
    color: colors.onRed,
  },
  smallBtnTextDanger: {
    color: colors.error,
  },
});
