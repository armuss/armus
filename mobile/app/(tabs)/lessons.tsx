import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../../components/Button';
import ReschedulePicker from '../../components/ReschedulePicker';
import StrandedPackageCard from '../../components/StrandedPackageCard';
import { useAuth } from '../../lib/auth';
import {
  FREE_CANCEL_HOURS,
  bookingCancellable,
  cancelBooking,
  canJoinLessonNow,
  formatLessonWhenForViewer,
  formatRescheduleSlot,
  getBookingsForStudent,
  getPendingRescheduleRequests,
  getTeacherBusyTimes,
  hoursUntilLesson,
  isBookingPast,
  isBookingToday,
  lessonTypeLabel,
  lessonWindow,
  rescheduleBooking,
  respondReschedule,
  withdrawReschedule,
  type Booking,
  type BusyTime,
  type RescheduleRequest,
} from '../../lib/bookings';
import { formatMoney, getAvailableCredits, getStrandedPackages, type LessonCredit, type StrandedPackage } from '../../lib/credits';
import { confirmAsync, notify } from '../../lib/dialogs';
import { shortDisplayName } from '../../lib/displayName';
import { createDispute, getOwnDisputes, type Dispute } from '../../lib/disputes';
import { findMarketplaceTeacher } from '../../lib/teachers';
import type { Teacher } from '../../lib/teachers-data';
import { colors, fonts, radius } from '../../lib/theme';

const DISPUTE_SUBJECTS = [
  'Öğretmen derse gelmedi',
  'Ders kalitesiyle ilgili bir sorun',
  'İletişim / uygunsuz davranış',
  'Ödeme ile ilgili bir sorun',
  'Diğer',
];

const DISPUTE_STATUS_LABELS: Record<string, string> = {
  open: 'Bildirdin, inceleniyor',
  in_progress: 'İnceleniyor',
  resolved: 'Çözüldü',
};

function DisputeSection({
  booking,
  reporterId,
  reporterName,
  existingDispute,
  onCreated,
}: {
  booking: Booking;
  reporterId: string;
  reporterName: string;
  existingDispute?: Dispute;
  onCreated: (d: Dispute) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [subject, setSubject] = useState(DISPUTE_SUBJECTS[0]);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (existingDispute) {
    return (
      <View style={styles.disputeSubmitted}>
        <Text style={styles.disputeStatus}>⚑ {DISPUTE_STATUS_LABELS[existingDispute.status] || existingDispute.status}</Text>
        <Text style={styles.disputeSubjectText}>{existingDispute.subject}</Text>
      </View>
    );
  }

  if (!expanded) {
    return (
      <Pressable onPress={() => setExpanded(true)} style={styles.disputePromptBtn}>
        <Text style={styles.disputePromptText}>⚑ Bir sorun bildir</Text>
      </Pressable>
    );
  }

  async function handleSubmit() {
    if (!description.trim()) {
      setError('Lütfen ne olduğunu kısaca yaz.');
      return;
    }
    setError('');
    setSubmitting(true);
    const created = await createDispute({
      bookingId: booking.id,
      reporterId,
      reporterName,
      reporterRole: 'student',
      otherPartyName: booking.teacherName,
      subject,
      description: description.trim(),
    });
    setSubmitting(false);
    if (!created) {
      setError('Bildirilemedi. Lütfen tekrar dene.');
      return;
    }
    onCreated(created);
  }

  return (
    <View style={styles.disputeForm}>
      <View style={styles.disputeSubjectRow}>
        {DISPUTE_SUBJECTS.map((s) => (
          <Pressable
            key={s}
            onPress={() => setSubject(s)}
            style={[styles.disputeChip, subject === s && styles.disputeChipActive]}
          >
            <Text style={[styles.disputeChipText, subject === s && styles.disputeChipTextActive]}>{s}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="Ne oldu, kısaca anlat..."
        placeholderTextColor={colors.faint}
        style={styles.disputeInput}
        multiline
      />
      {!!error && <Text style={styles.disputeError}>{error}</Text>}
      <Pressable onPress={handleSubmit} disabled={submitting} style={[styles.disputeSubmitBtn, submitting && styles.disputeSubmitBtnDisabled]}>
        <Text style={styles.disputeSubmitText}>{submitting ? 'Gönderiliyor…' : 'Gönder'}</Text>
      </Pressable>
    </View>
  );
}

// what a cancelled lesson's card says (mirrors my-lessons.html)
function cancelledLine(b: Booking) {
  if (b.teacherNoShow) return `Öğretmen derse gelmedi${b.refunded ? ' · Ders hakkın iade edildi' : ''}`;
  if (b.lateCancel) {
    return b.type === 'trial'
      ? 'İptal edildi ve ücretlendirildi · derse 12 saatten az kala iptal edildi'
      : 'İptal edildi ve ücretlendirildi · derse 12 saatten az kala iptal edildiği için ders hakkı iade edilmedi';
  }
  if (b.refunded) return 'İptal edildi · Ders hakkın eklendi';
  return b.cancelledBy === 'student' ? 'İptal edildi · Ders hakkı eklenmedi' : 'İptal edildi';
}

type Row = { kind: 'heading'; key: string; title: string } | { kind: 'lesson'; key: string; booking: Booking };

type PickerState = {
  booking: Booking;
  teacher: Teacher;
  busy: BusyTime[];
  late: boolean;
};

export default function Lessons() {
  const { profile } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [pending, setPending] = useState<Record<string, RescheduleRequest>>({});
  const [credits, setCredits] = useState<LessonCredit[]>([]);
  const [stranded, setStranded] = useState<StrandedPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [submittingMove, setSubmittingMove] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    const [bookingsData, disputesData, creditData, strandedData] = await Promise.all([
      getBookingsForStudent(profile.id),
      getOwnDisputes(profile.id),
      getAvailableCredits(profile.id),
      getStrandedPackages(),
    ]);
    const pendingData = await getPendingRescheduleRequests(bookingsData.filter(bookingCancellable).map((b) => b.id));
    setBookings(bookingsData);
    setDisputes(disputesData);
    setCredits(creditData || []);
    setStranded(strandedData);
    setPending(pendingData);
    setLoading(false);
    setRefreshing(false);
  }, [profile]);

  const disputeByBooking = new Map(disputes.filter((d) => d.bookingId).map((d) => [d.bookingId, d]));

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // not-yet-past lessons first (soonest first), then history (most recent
  // first) - a cancelled lesson goes to history even while its date is
  // still ahead. Mirrors my-lessons.html.
  const inHistory = (b: Booking) => b.status === 'cancelled' || (isBookingPast(b) && !canJoinLessonNow(b));
  const startOf = (b: Booking) => lessonWindow(b).start.getTime();
  const upcoming = bookings.filter((b) => !inHistory(b)).sort((a, b) => startOf(a) - startOf(b));
  const history = bookings.filter(inHistory).sort((a, b) => startOf(b) - startOf(a));
  const rows: Row[] = [
    ...(upcoming.length ? [{ kind: 'heading' as const, key: 'h-up', title: 'Yaklaşan dersler' }] : []),
    ...upcoming.map((b) => ({ kind: 'lesson' as const, key: b.id, booking: b })),
    ...(history.length ? [{ kind: 'heading' as const, key: 'h-past', title: 'Geçmiş' }] : []),
    ...history.map((b) => ({ kind: 'lesson' as const, key: b.id, booking: b })),
  ];

  async function handleCancel(b: Booking) {
    const when = formatLessonWhenForViewer(b);
    // re-checked at tap time - the screen may have stayed open across the
    // 12-hour line
    const late = hoursUntilLesson(b) < FREE_CANCEL_HOURS;
    let message = `${shortDisplayName(b.teacherName)} ile ${when.dateLabel}, ${when.timeRange} dersini iptal etmek istediğine emin misin?`;
    if (late) {
      message +=
        b.type === 'trial'
          ? '\n\nDikkat: derse 12 saatten az kaldı, deneme dersi bakiyene geri eklenmez.'
          : '\n\nDikkat: derse 12 saatten az kaldı, ders hakkı iade edilmez ve ücret öğretmene ödenir (saati senin için ayrılmıştı).';
    }
    if (!(await confirmAsync('Dersi iptal et', message, 'İptal Et', true))) return;
    setActingId(b.id);
    const result = await cancelBooking(b.id);
    setActingId(null);
    if (!result.ok) {
      notify('İptal edilemedi', result.error);
      return;
    }
    notify(
      'Ders iptal edildi',
      result.lateCancel
        ? 'Derse 12 saatten az kaldığı için ders hakkı iade edilmedi.'
        : result.refunded
          ? 'Ders, ders hakkı olarak bakiyene geri eklendi.'
          : ''
    );
    load();
  }

  async function openReschedule(b: Booking) {
    setActingId(b.id);
    const [teacher, busy] = await Promise.all([findMarketplaceTeacher(b.teacherId), getTeacherBusyTimes(b.teacherId)]);
    setActingId(null);
    if (!teacher) {
      notify('Saat değiştirilemiyor', 'Bu öğretmenin müsait saatleri şu anda görüntülenemiyor. Dersi iptal edebilir ya da öğretmenine mesaj atabilirsin.');
      return;
    }
    setPicker({ booking: b, teacher, busy, late: hoursUntilLesson(b) < FREE_CANCEL_HOURS });
  }

  async function confirmReschedule(pick: { date: string; time: string }) {
    if (!picker) return;
    setSubmittingMove(true);
    const result = await rescheduleBooking(picker.booking.id, pick.date, pick.time);
    setSubmittingMove(false);
    if (!result.ok) {
      notify('Saat değiştirilemedi', result.error);
      return;
    }
    setPicker(null);
    notify(
      result.applied ? 'Dersin yeni saate taşındı' : 'İsteğin gönderildi',
      result.applied
        ? 'Öğretmenine e-posta ile haber verildi. Ücret değişmedi.'
        : 'Öğretmenin onaylarsa ders yeni saate taşınır. Ders başlayana kadar onaylamazsa ders eski saatinde kalır.'
    );
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

  function renderLesson(item: Booking) {
    const isCancelled = item.status === 'cancelled';
    const isPast = isBookingPast(item);
    const joinable = !isCancelled && canJoinLessonNow(item);
    const showHint = !isCancelled && !isPast && !joinable && isBookingToday(item);
    const cancellable = bookingCancellable(item);
    const when = formatLessonWhenForViewer(item);
    const request = pending[item.id];
    const busy = actingId === item.id;
    const late = hoursUntilLesson(item) < FREE_CANCEL_HOURS;

    return (
      <View style={[styles.card, (isCancelled || (isPast && !joinable)) && styles.cardMuted]}>
        <View style={styles.cardHeader}>
          <Text style={styles.teacherName}>{shortDisplayName(item.teacherName)}</Text>
          <View style={[styles.statusPill, isCancelled ? styles.statusPillCancelled : isPast && !joinable && styles.statusPillDone]}>
            <Text style={[styles.statusText, isCancelled ? styles.statusTextCancelled : isPast && !joinable && styles.statusTextDone]}>
              {isCancelled ? 'İptal edildi' : isPast && !joinable ? 'Tamamlandı' : 'Onaylı'}
            </Text>
          </View>
        </View>
        <Text style={styles.type}>{lessonTypeLabel(item.type)}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{when.dateLabel}</Text>
          <Text style={styles.meta}>{when.timeRange}</Text>
          <Text style={styles.meta}>₺{item.price}</Text>
        </View>

        {isCancelled && <Text style={styles.cancelLine}>⊘ {cancelledLine(item)}</Text>}

        {joinable && (
          <Pressable style={styles.joinBtn} onPress={() => router.push(`/class/${item.id}`)}>
            <Text style={styles.joinBtnText}>🎥 Derse Katıl</Text>
          </Pressable>
        )}
        {showHint && <Text style={styles.joinHint}>Ders saatinde bu kart üzerinden odaya katılabileceksin.</Text>}

        {cancellable && request && (
          <View style={styles.requestBox}>
            <Text style={styles.requestText}>
              {request.requestedBy === 'teacher'
                ? 'Öğretmenin bu ders için yeni bir saat önerdi: '
                : 'Saat değişikliği isteğin öğretmen onayı bekliyor: '}
              <Text style={styles.requestSlot}>{formatRescheduleSlot(request.newDate, request.newTime, item.teacherTimezone)}</Text>
            </Text>
            <View style={styles.actionRow}>
              {request.requestedBy === 'teacher' ? (
                <>
                  <Pressable disabled={busy} onPress={() => act(item.id, () => respondReschedule(request.id, true))} style={[styles.smallBtn, styles.smallBtnPrimary]}>
                    <Text style={[styles.smallBtnText, styles.smallBtnTextPrimary]}>Kabul Et</Text>
                  </Pressable>
                  <Pressable disabled={busy} onPress={() => act(item.id, () => respondReschedule(request.id, false))} style={styles.smallBtn}>
                    <Text style={styles.smallBtnText}>Reddet</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable disabled={busy} onPress={() => act(item.id, () => withdrawReschedule(request.id))} style={styles.smallBtn}>
                  <Text style={styles.smallBtnText}>İsteği Geri Çek</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {cancellable && (
          <View style={styles.manageBox}>
            <View style={styles.actionRow}>
              {!(request && request.requestedBy === 'teacher') && (
                <Pressable disabled={busy} onPress={() => openReschedule(item)} style={styles.smallBtn}>
                  <Text style={styles.smallBtnText}>{busy ? '…' : 'Saati Değiştir'}</Text>
                </Pressable>
              )}
              <Pressable disabled={busy} onPress={() => handleCancel(item)} style={[styles.smallBtn, styles.smallBtnDanger]}>
                <Text style={[styles.smallBtnText, styles.smallBtnTextDanger]}>Dersi İptal Et</Text>
              </Pressable>
            </View>
            <Text style={styles.manageHint}>
              {!late
                ? 'Derse 12 saatten fazla var: iptal edersen ders bakiyene geri eklenir. Saati değiştirirsen ders hemen yeni saate taşınır.'
                : item.type === 'trial'
                  ? 'Derse 12 saatten az kaldı: iptal edersen deneme dersi bakiyene geri eklenmez. Saat değişikliği öğretmen onayına gider.'
                  : 'Derse 12 saatten az kaldı: iptal edersen ders hakkı iade edilmez ve ücret öğretmene ödenir. Saat değişikliği öğretmen onayına gider.'}
            </Text>
          </View>
        )}

        {!isCancelled && profile && (
          <DisputeSection
            booking={item}
            reporterId={profile.id}
            reporterName={profile.name}
            existingDispute={disputeByBooking.get(item.id)}
            onCreated={(d) => setDisputes((prev) => [d, ...prev])}
          />
        )}
      </View>
    );
  }

  // lesson credits on the balance, grouped by teacher
  const creditGroups = Array.from(
    credits.reduce((map, c) => {
      const entry = map.get(c.teacher_id) || { name: c.teacher_name, count: 0, values: [] as number[] };
      entry.count += 1;
      if (c.value !== null && c.value !== undefined) entry.values.push(Number(c.value));
      map.set(c.teacher_id, entry);
      return map;
    }, new Map<string, { name: string; count: number; values: number[] }>())
  );
  const strandedIds = new Set(stranded.map((p) => p.teacherId));

  const listHeader = (
    <View>
      {stranded.map((pkg) => (
        <StrandedPackageCard key={pkg.teacherId} pkg={pkg} onDone={load} />
      ))}
      {creditGroups.filter(([teacherId]) => !strandedIds.has(teacherId)).length > 0 && (
        <View style={styles.creditsCard}>
          <Text style={styles.creditsTitle}>🎁 Ders hakların</Text>
          {creditGroups
            .filter(([teacherId]) => !strandedIds.has(teacherId))
            .map(([teacherId, g]) => (
              <Text key={teacherId} style={styles.creditsLine}>
                {shortDisplayName(g.name)} · {g.count} ders hakkı
                {g.values.length ? ` (her biri ${formatMoney(Math.min(...g.values))}${Math.max(...g.values) !== Math.min(...g.values) ? `–${formatMoney(Math.max(...g.values))}` : ''})` : ''}
              </Text>
            ))}
          <Text style={styles.creditsHint}>
            Bir ders hakkı aynı öğretmenle her ders için, başka bir öğretmenle sadece deneme dersi için kullanılabilir. Rezervasyon
            sırasında otomatik uygulanır.
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.headerBlock}>
        <Text style={styles.title}>Derslerim</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.gold3} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={listHeader}
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
          renderItem={({ item: row }) =>
            row.kind === 'heading' ? <Text style={styles.sectionTitle}>{row.title}</Text> : renderLesson(row.booking)
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Ders programın burada görünecek</Text>
              <Text style={styles.emptyText}>
                Ders programın başarıya giden yol - başlamak için bir deneme dersi ayarla.
              </Text>
              <View style={styles.emptyBtn}>
                <Button label="Öğretmen bul" onPress={() => router.push('/(tabs)')} />
              </View>
            </View>
          }
        />
      )}

      {picker && (
        <ReschedulePicker
          visible
          teacher={picker.teacher}
          timeZone={picker.booking.teacherTimezone || picker.teacher.timezone}
          busyTimes={picker.busy}
          current={{ date: picker.booking.date, time: picker.booking.time }}
          title="Dersin için yeni bir saat seç"
          note={
            picker.late
              ? 'Derse 12 saatten az kaldı: seçtiğin saat öğretmenin onayına gönderilir. Ders başlayana kadar onaylamazsa ders eski saatinde kalır.'
              : 'Dersin hemen yeni saate taşınır - ücret değişmez, öğretmenine e-posta ile haber verilir.'
          }
          confirmLabel={picker.late ? 'Öğretmene İstek Gönder' : 'Dersi Bu Saate Taşı'}
          submitting={submittingMove}
          onClose={() => setPicker(null)}
          onConfirm={confirmReschedule}
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
  headerBlock: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.ink,
    letterSpacing: -0.5,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  teacherName: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 15.5,
    color: colors.ink,
  },
  statusPill: {
    backgroundColor: '#e9f7ef',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusPillCancelled: {
    backgroundColor: '#fbeceb',
  },
  statusText: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.success,
  },
  statusTextCancelled: {
    color: colors.error,
  },
  statusPillDone: {
    backgroundColor: colors.panel2,
  },
  statusTextDone: {
    color: colors.muted,
  },
  cardMuted: {
    backgroundColor: '#fcfcfc',
  },
  sectionTitle: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 13,
    letterSpacing: 0.4,
    color: colors.muted,
    marginTop: 10,
    marginBottom: 10,
  },
  cancelLine: {
    fontFamily: fonts.bodySemibold,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.error,
    marginTop: 10,
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
  manageBox: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    gap: 8,
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
  manageHint: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.faint,
  },
  creditsCard: {
    backgroundColor: '#fff8e6',
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 14,
    gap: 4,
  },
  creditsTitle: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 14,
    color: colors.ink,
    marginBottom: 2,
  },
  creditsLine: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13,
    color: colors.ink,
  },
  creditsHint: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.muted,
    marginTop: 4,
  },
  type: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 12,
  },
  meta: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12.5,
    color: colors.ink,
  },
  joinBtn: {
    marginTop: 14,
    backgroundColor: colors.gold3,
    borderRadius: radius.md,
    paddingVertical: 11,
    alignItems: 'center',
  },
  joinBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.onGold,
  },
  joinHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.faint,
    marginTop: 12,
  },
  disputePromptBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  disputePromptText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 12.5,
    color: colors.muted,
  },
  disputeSubmitted: {
    marginTop: 12,
    backgroundColor: colors.panel2,
    borderRadius: radius.md,
    padding: 10,
  },
  disputeStatus: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    color: colors.goldText,
  },
  disputeSubjectText: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 3,
  },
  disputeForm: {
    marginTop: 12,
    gap: 8,
  },
  disputeSubjectRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  disputeChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  disputeChipActive: {
    borderColor: colors.gold3,
    backgroundColor: '#fff8e6',
  },
  disputeChipText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11.5,
    color: colors.muted,
  },
  disputeChipTextActive: {
    color: colors.goldText,
  },
  disputeInput: {
    minHeight: 64,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  disputeError: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.error,
  },
  disputeSubmitBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  disputeSubmitBtnDisabled: {
    opacity: 0.6,
  },
  disputeSubmitText: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: '#fff',
  },
  empty: {
    alignItems: 'flex-start',
    marginTop: 20,
  },
  emptyTitle: {
    fontFamily: fonts.displayBlack,
    fontSize: 22,
    color: colors.ink,
    marginBottom: 10,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: 22,
  },
  emptyBtn: {
    width: '100%',
  },
});
