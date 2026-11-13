import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScrollBand } from '../../components/Band';
import ReschedulePicker from '../../components/ReschedulePicker';
import StrandedPackageCard from '../../components/StrandedPackageCard';
import { useAuth } from '../../lib/auth';
import {
  DAY_NAMES,
  FREE_CANCEL_HOURS,
  bookingCancellable,
  cancelBooking,
  canJoinLessonNow,
  formatLessonWhenForViewer,
  formatRescheduleSlot,
  formatTimeUntil,
  getBookingsForStudent,
  getPendingRescheduleRequests,
  getRescheduleCounts,
  MAX_STUDENT_MOVES,
  getTeacherBusyTimes,
  hoursUntilLesson,
  isBookingPast,
  lessonTypeLabel,
  lessonWindow,
  localDateKey,
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
  // how many times each lesson has been moved (a lesson moves at most 2 times)
  const [moveCounts, setMoveCounts] = useState<Record<string, { studentMoves: number; teacherProposals: number }>>({});
  const [credits, setCredits] = useState<LessonCredit[]>([]);
  const [stranded, setStranded] = useState<StrandedPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [submittingMove, setSubmittingMove] = useState(false);
  const [mode, setMode] = useState<'agenda' | 'history'>('agenda');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Booking | null>(null);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [photos, setPhotos] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!profile) return;
    const [bookingsData, disputesData, creditData, strandedData] = await Promise.all([
      getBookingsForStudent(profile.id),
      getOwnDisputes(profile.id),
      getAvailableCredits(profile.id),
      getStrandedPackages(),
    ]);
    const openIds = bookingsData.filter(bookingCancellable).map((b) => b.id);
    const [pendingData, countsData] = await Promise.all([getPendingRescheduleRequests(openIds), getRescheduleCounts(openIds)]);
    setBookings(bookingsData);
    setDisputes(disputesData);
    setCredits(creditData || []);
    setStranded(strandedData);
    setPending(pendingData);
    setMoveCounts(countsData);
    setLoading(false);
    // photos for the next-lesson banner (one lookup per teacher)
    Array.from(new Set(bookingsData.map((b) => b.teacherId))).forEach((tid) => {
      findMarketplaceTeacher(tid).then((t) => {
        if (t?.photo) setPhotos((prev) => (prev[tid] ? prev : { ...prev, [tid]: t.photo as string }));
      });
    });
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

  // ---- the agenda: week strip, next-lesson banner, the picked day ----
  const todayKey = localDateKey(new Date());
  const dayKeyOf = (b: Booking) => localDateKey(lessonWindow(b).start);
  const lessonDays = new Set(upcoming.map(dayKeyOf));
  // today through the last upcoming lesson (at least a week, at most two months)
  const lastKey = upcoming.length ? dayKeyOf(upcoming[upcoming.length - 1]) : todayKey;
  const strip: { key: string; date: Date }[] = [];
  for (let i = 0; i < 60; i++) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + i);
    const key = localDateKey(date);
    strip.push({ key, date });
    if (i >= 6 && key >= lastKey) break;
  }
  const dayKey = selectedDay ?? todayKey;
  const dayLessons = upcoming.filter((b) => dayKeyOf(b) === dayKey);
  const next = upcoming.find((b) => b.status !== 'cancelled') ?? null;
  // the rest of the week at a glance, below the picked day
  const laterLessons = upcoming.filter((b) => dayKeyOf(b) !== dayKey && dayKeyOf(b) >= todayKey).slice(0, 6);

  function renderBanner(b: Booking) {
    const when = formatLessonWhenForViewer(b);
    const joinable = canJoinLessonNow(b);
    const started = when.start.getTime() <= Date.now();
    const photo = photos[b.teacherId];
    return (
      <View style={styles.banner}>
        {photo ? (
          <Image source={{ uri: photo }} style={styles.bannerPhoto} />
        ) : (
          <View style={[styles.bannerPhoto, styles.bannerInitial]}>
            <Text style={styles.bannerInitialText}>{shortDisplayName(b.teacherName).charAt(0)}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.bannerName} numberOfLines={1}>
            {shortDisplayName(b.teacherName)}
          </Text>
          <Text style={styles.bannerWhen} numberOfLines={1}>
            {started ? 'Ders başladı' : `${formatTimeUntil(when.start)} sonra`} · {dayKeyOf(b) === todayKey ? when.time : `${when.dateLabel} ${when.time}`}
          </Text>
        </View>
        {joinable ? (
          <Pressable onPress={() => router.push(`/class/${b.id}`)} style={({ pressed }) => [styles.bannerGo, pressed && { opacity: 0.85 }]}>
            <Text style={styles.bannerGoText}>Katıl</Text>
          </Pressable>
        ) : (
          <View style={styles.bannerSoon}>
            <Ionicons name="time-outline" size={14} color="#aaa" />
            <Text style={styles.bannerSoonText}>15 dk önce açılır</Text>
          </View>
        )}
      </View>
    );
  }

  function renderAgendaItem(item: Booking) {
    const when = formatLessonWhenForViewer(item);
    const joinable = canJoinLessonNow(item);
    const request = pending[item.id];
    const busy = actingId === item.id;
    return (
      <View key={item.id} style={styles.ag}>
        <Text style={styles.agHour}>{when.time}</Text>
        <View style={[styles.agCard, item.type === 'trial' ? styles.agCardTrial : null]}>
          <View style={styles.agTop}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.agTitle} numberOfLines={1}>
                {shortDisplayName(item.teacherName)} · {lessonTypeLabel(item.type)}
              </Text>
              <Text style={styles.agSub}>
                {when.timeRange} · ₺{item.price}
              </Text>
            </View>
            <Pressable onPress={() => setSheet(item)} hitSlop={10} style={styles.dots} accessibilityLabel="Ders seçenekleri">
              {busy ? <ActivityIndicator size="small" color={colors.ink} /> : <Ionicons name="ellipsis-horizontal" size={18} color={colors.ink} />}
            </Pressable>
          </View>
          {joinable && (
            <Pressable style={styles.agJoin} onPress={() => router.push(`/class/${item.id}`)}>
              <Ionicons name="videocam" size={16} color={colors.onRed} />
              <Text style={styles.agJoinText}>Derse katıl</Text>
            </Pressable>
          )}
          {bookingCancellable(item) && request && (
            <View style={styles.requestBox}>
              <Text style={styles.requestText}>
                {request.requestedBy === 'teacher' ? 'Öğretmenin yeni bir saat önerdi: ' : 'Saat değişikliği isteğin onay bekliyor: '}
                <Text style={styles.requestSlot}>{formatRescheduleSlot(request.newDate, request.newTime, item.teacherTimezone)}</Text>
              </Text>
              <View style={styles.actionRow}>
                {request.requestedBy === 'teacher' ? (
                  <>
                    <Pressable disabled={busy} onPress={() => act(item.id, () => respondReschedule(request.id, true))} style={[styles.smallBtn, styles.smallBtnPrimary]}>
                      <Text style={[styles.smallBtnText, styles.smallBtnTextPrimary]}>Kabul et</Text>
                    </Pressable>
                    <Pressable disabled={busy} onPress={() => act(item.id, () => respondReschedule(request.id, false))} style={styles.smallBtn}>
                      <Text style={styles.smallBtnText}>Reddet</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable disabled={busy} onPress={() => act(item.id, () => withdrawReschedule(request.id))} style={styles.smallBtn}>
                    <Text style={styles.smallBtnText}>İsteği geri çek</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
        </View>
      </View>
    );
  }

  function renderHistoryItem(item: Booking) {
    const isCancelled = item.status === 'cancelled';
    const when = formatLessonWhenForViewer(item);
    const dispute = disputeByBooking.get(item.id);
    return (
      <View key={item.id} style={styles.hist}>
        <View style={styles.agTop}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.agTitle} numberOfLines={1}>
              {shortDisplayName(item.teacherName)} · {lessonTypeLabel(item.type)}
            </Text>
            <Text style={styles.agSub}>
              {when.dateLabel} · {when.timeRange} · ₺{item.price}
            </Text>
          </View>
          <View style={[styles.statusPill, isCancelled && styles.statusPillCancelled]}>
            <Text style={[styles.statusText, isCancelled && styles.statusTextCancelled]}>{isCancelled ? 'İptal' : 'Tamamlandı'}</Text>
          </View>
        </View>
        {isCancelled && <Text style={styles.cancelLine}>{cancelledLine(item)}</Text>}
        {dispute ? (
          <View style={styles.disputeSubmitted}>
            <Text style={styles.disputeStatus}>⚑ {DISPUTE_STATUS_LABELS[dispute.status] || dispute.status}</Text>
            <Text style={styles.disputeSubjectText}>{dispute.subject}</Text>
          </View>
        ) : (
          !isCancelled && (
            <Pressable onPress={() => setSheet(item)} style={styles.disputePromptBtn}>
              <Text style={styles.disputePromptText}>⚑ Bir sorun bildir</Text>
            </Pressable>
          )
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
  const shownCredits = creditGroups.filter(([teacherId]) => !strandedIds.has(teacherId));
  const creditTotal = shownCredits.reduce((n, [, g]) => n + g.count, 0);

  const sheetBooking = sheet ? bookings.find((b) => b.id === sheet.id) ?? sheet : null;
  const sheetRequest = sheetBooking ? pending[sheetBooking.id] : undefined;
  const sheetLate = sheetBooking ? hoursUntilLesson(sheetBooking) < FREE_CANCEL_HOURS : false;
  // migration_112.sql: a lesson can be moved at most 2 times (like my-lessons)
  const sheetMoveLimit = sheetBooking ? (moveCounts[sheetBooking.id]?.studentMoves || 0) >= MAX_STUDENT_MOVES : false;

  return (
    // the title row is fixed on plain red; the band under it scrolls with
    // the content, reaching under the week (design A)
    <SafeAreaView style={styles.safeRed} edges={['top']}>
      <View style={styles.head}>
        <Text style={styles.title}>Derslerim</Text>
        <View style={styles.seg}>
          {(
            [
              ['agenda', 'Yaklaşan'],
              ['history', 'Geçmiş'],
            ] as const
          ).map(([key, label]) => (
            <Pressable key={key} onPress={() => setMode(key)} style={[styles.segItem, mode === key && styles.segItemOn]}>
              <Text style={[styles.segText, mode === key && styles.segTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.list}>
          <ScrollBand height={0} />
          <ActivityIndicator color={colors.red} style={{ marginTop: 60 }} />
        </View>
      ) : (
        <ScrollView
          style={styles.list}
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
        >
          <ScrollBand height={mode === 'agenda' ? 80 : 0} />
          {mode === 'agenda' ? (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.week} contentContainerStyle={styles.weekInner}>
                {strip.map(({ key, date }) => {
                  const on = key === dayKey;
                  return (
                    <Pressable key={key} onPress={() => setSelectedDay(key)} style={[styles.day, on && styles.dayOn]}>
                      <Text style={[styles.dayName, on && styles.dayNameOn]}>{DAY_NAMES[date.getDay()]}</Text>
                      <Text style={[styles.dayNum, on && styles.dayNumOn]}>{date.getDate()}</Text>
                      {lessonDays.has(key) && <View style={styles.dayDot} />}
                    </Pressable>
                  );
                })}
              </ScrollView>

              {next ? (
                renderBanner(next)
              ) : (
                <View style={styles.emptyBanner}>
                  <Text style={styles.emptyBannerTitle}>Planlanmış dersin yok</Text>
                  <Text style={styles.emptyBannerText}>Bir öğretmen seç, deneme dersiyle başla.</Text>
                  <Pressable onPress={() => router.push('/(tabs)')} style={styles.emptyBannerBtn}>
                    <Text style={styles.emptyBannerBtnText}>Öğretmen bul</Text>
                  </Pressable>
                </View>
              )}

              {stranded.map((pkg) => (
                <StrandedPackageCard key={pkg.teacherId} pkg={pkg} onDone={load} />
              ))}

              {shownCredits.length > 0 && (
                <Pressable onPress={() => setCreditsOpen((v) => !v)} style={styles.credits}>
                  <View style={styles.creditsRow}>
                    <Ionicons name="gift-outline" size={18} color={colors.ink} />
                    <Text style={styles.creditsTitle}>{creditTotal} ders hakkın var</Text>
                    <Ionicons name={creditsOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} />
                  </View>
                  {creditsOpen && (
                    <>
                      {shownCredits.map(([teacherId, g]) => (
                        <Text key={teacherId} style={styles.creditsLine}>
                          {shortDisplayName(g.name)} · {g.count} ders hakkı
                          {g.values.length ? ` (her biri ${formatMoney(Math.min(...g.values))}${Math.max(...g.values) !== Math.min(...g.values) ? `–${formatMoney(Math.max(...g.values))}` : ''})` : ''}
                        </Text>
                      ))}
                      <Text style={styles.creditsHint}>
                        Bir ders hakkı aynı öğretmenle her ders için, başka bir öğretmenle sadece deneme dersi için kullanılabilir.
                        Rezervasyon sırasında otomatik uygulanır.
                      </Text>
                    </>
                  )}
                </Pressable>
              )}

              {dayLessons.length > 0 ? (
                dayLessons.map(renderAgendaItem)
              ) : (
                <View style={styles.agEmpty}>
                  <Text style={styles.agEmptyText}>{dayKey === todayKey ? 'Bugün dersin yok' : 'Bu gün dersin yok'}</Text>
                </View>
              )}

              {laterLessons.length > 0 && (
                <>
                  <Text style={styles.laterTitle}>Sonraki dersler</Text>
                  {laterLessons.map((b) => {
                    const when = formatLessonWhenForViewer(b);
                    return (
                      <Pressable key={b.id} onPress={() => setSelectedDay(dayKeyOf(b))} style={styles.later}>
                        <View style={styles.laterDate}>
                          <Text style={styles.laterDay}>{DAY_NAMES[when.start.getDay()]}</Text>
                          <Text style={styles.laterNum}>{when.start.getDate()}</Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.laterName} numberOfLines={1}>
                            {shortDisplayName(b.teacherName)} · {lessonTypeLabel(b.type)}
                          </Text>
                          <Text style={styles.laterTime}>{when.timeRange}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={17} color={colors.faint} />
                      </Pressable>
                    );
                  })}
                </>
              )}
            </>
          ) : history.length > 0 ? (
            history.map(renderHistoryItem)
          ) : (
            <View style={styles.agEmpty}>
              <Text style={styles.agEmptyText}>Geçmiş derslerin burada görünecek</Text>
            </View>
          )}
        </ScrollView>
      )}

      <Modal visible={!!sheetBooking} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <Pressable style={styles.sheetShade} onPress={() => setSheet(null)} />
        {sheetBooking && (
          <View style={styles.sheet}>
            <View style={styles.grab} />
            <Text style={styles.sheetTitle}>
              {shortDisplayName(sheetBooking.teacherName)} · {lessonTypeLabel(sheetBooking.type)}
            </Text>
            <Text style={styles.sheetSub}>
              {formatLessonWhenForViewer(sheetBooking).dateLabel} · {formatLessonWhenForViewer(sheetBooking).timeRange}
            </Text>

            {bookingCancellable(sheetBooking) && (
              <>
                {!(sheetRequest && sheetRequest.requestedBy === 'teacher') && !sheetMoveLimit && (
                  <Pressable
                    onPress={() => {
                      const b = sheetBooking;
                      setSheet(null);
                      openReschedule(b);
                    }}
                    style={styles.sheetRow}
                  >
                    <Ionicons name="swap-horizontal" size={20} color={colors.ink} />
                    <Text style={styles.sheetRowText}>Saati değiştir</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => {
                    const b = sheetBooking;
                    setSheet(null);
                    handleCancel(b);
                  }}
                  style={styles.sheetRow}
                >
                  <Ionicons name="close-circle-outline" size={20} color={colors.error} />
                  <Text style={[styles.sheetRowText, { color: colors.error }]}>Dersi iptal et</Text>
                </Pressable>
                {sheetMoveLimit && <Text style={styles.sheetHint}>Bu ders 2 kez taşındı - bir ders en fazla 2 kez taşınabilir.</Text>}
                <Text style={styles.sheetHint}>
                  {!sheetLate
                    ? 'Derse 12 saatten fazla var: iptal edersen ders bakiyene geri eklenir. Saati değiştirirsen ders hemen yeni saate taşınır.'
                    : sheetBooking.type === 'trial'
                      ? 'Derse 12 saatten az kaldı: iptal edersen deneme dersi bakiyene geri eklenmez. Saat değişikliği öğretmen onayına gider.'
                      : 'Derse 12 saatten az kaldı: iptal edersen ders hakkı iade edilmez ve ücret öğretmene ödenir. Saat değişikliği öğretmen onayına gider.'}
                </Text>
              </>
            )}

            {sheetBooking.status !== 'cancelled' && profile && (
              <DisputeSection
                booking={sheetBooking}
                reporterId={profile.id}
                reporterName={profile.name}
                existingDispute={disputeByBooking.get(sheetBooking.id)}
                onCreated={(d) => setDisputes((prev) => [d, ...prev])}
              />
            )}
          </View>
        )}
      </Modal>

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
  screen: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1, backgroundColor: 'transparent' },
  // the status bar and title row are plain red; the list paints the ground and carries the band
  safeRed: { flex: 1, backgroundColor: colors.red },
  list: { flex: 1, backgroundColor: colors.bg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12 },
  title: { fontFamily: fonts.display, fontSize: 26, color: colors.onRed, letterSpacing: -0.8 },
  // on the red band: a see-through cream switch, the open side in cream
  seg: {
    flexDirection: 'row',
    backgroundColor: 'rgba(250,245,226,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(250,245,226,0.28)',
    borderRadius: 13,
    padding: 3,
  },
  segItem: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10 },
  segItemOn: { backgroundColor: colors.cream },
  segText: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.onRed },
  segTextOn: { color: colors.red },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  week: { marginHorizontal: -16, marginBottom: 14 },
  weekInner: { paddingHorizontal: 16, gap: 6 },
  // white day tiles on the band, today / the picked day in cream
  day: { width: 46, alignItems: 'center', paddingTop: 8, paddingBottom: 12, borderRadius: 16, backgroundColor: colors.panel },
  dayOn: { backgroundColor: colors.cream },
  dayName: { fontFamily: fonts.bodySemibold, fontSize: 11.5, color: colors.faint },
  dayNameOn: { color: colors.red },
  dayNum: { fontFamily: fonts.display, fontSize: 16, color: colors.ink, marginTop: 2 },
  dayNumOn: { color: colors.red },
  dayDot: { position: 'absolute', bottom: 4, width: 5, height: 5, borderRadius: 3, backgroundColor: colors.goldDot },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.dark,
    borderRadius: 20,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 12,
    marginBottom: 14,
  },
  bannerPhoto: { width: 44, height: 44, borderRadius: 13, backgroundColor: colors.dark2 },
  bannerInitial: { alignItems: 'center', justifyContent: 'center' },
  bannerInitialText: { fontFamily: fonts.bodyExtraBold, fontSize: 17, color: colors.gold2 },
  bannerName: { fontFamily: fonts.bodyExtraBold, fontSize: 15, color: '#fff' },
  bannerWhen: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.gold2, marginTop: 1 },
  bannerGo: { backgroundColor: colors.cream, borderRadius: 13, paddingHorizontal: 16, paddingVertical: 11 },
  bannerGoText: { fontFamily: fonts.bodyExtraBold, fontSize: 13.5, color: colors.red },
  bannerSoon: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 92 },
  bannerSoonText: { fontFamily: fonts.bodySemibold, fontSize: 11, color: 'rgba(250,245,226,0.78)' },
  emptyBanner: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, borderRadius: 20, padding: 16, marginBottom: 14 },
  emptyBannerTitle: { fontFamily: fonts.bodyExtraBold, fontSize: 16, color: colors.ink },
  emptyBannerText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.muted, marginTop: 3 },
  emptyBannerBtn: { alignSelf: 'flex-start', backgroundColor: colors.red, borderRadius: 13, paddingHorizontal: 16, paddingVertical: 11, marginTop: 12 },
  emptyBannerBtnText: { fontFamily: fonts.bodyExtraBold, fontSize: 13.5, color: colors.onRed },
  credits: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14, gap: 4 },
  creditsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  creditsTitle: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  creditsLine: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.ink, marginTop: 4 },
  creditsHint: { fontFamily: fonts.body, fontSize: 11.5, lineHeight: 16, color: colors.muted, marginTop: 4 },
  ag: { flexDirection: 'row', gap: 12, marginBottom: 10 },
  agHour: { width: 46, fontFamily: fonts.bodyBold, fontSize: 13, color: colors.faint, paddingTop: 13 },
  // a regular lesson is champagne, a trial petrol - the website's colours
  agCard: { flex: 1, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, borderLeftColor: colors.champagneDeep },
  agCardTrial: { backgroundColor: '#eef5f4', borderColor: '#cfe3e0', borderLeftColor: colors.petrol },
  agTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  agTitle: { fontFamily: fonts.bodyExtraBold, fontSize: 15, color: colors.ink },
  agSub: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.muted, marginTop: 2 },
  dots: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.8)', alignItems: 'center', justifyContent: 'center' },
  agJoin: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.red,
    borderRadius: 12,
    paddingVertical: 10,
    marginTop: 10,
  },
  agJoinText: { fontFamily: fonts.bodyExtraBold, fontSize: 13.5, color: colors.onRed },
  agEmpty: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.champagneDeep, borderRadius: 18, padding: 16, alignItems: 'center' },
  agEmptyText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: '#9a9a9a' },
  laterTitle: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.faint, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 22, marginBottom: 8 },
  later: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 10, marginBottom: 8 },
  laterDate: { width: 44, alignItems: 'center', backgroundColor: colors.panel2, borderRadius: 12, paddingVertical: 5 },
  laterDay: { fontFamily: fonts.bodySemibold, fontSize: 11, color: colors.faint },
  laterNum: { fontFamily: fonts.bodyExtraBold, fontSize: 16, color: colors.ink },
  laterName: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.ink },
  laterTime: { fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.muted, marginTop: 1 },
  hist: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 14, marginBottom: 10 },
  statusPill: { backgroundColor: colors.panel2, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  statusPillCancelled: { backgroundColor: '#fbeceb' },
  statusText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.muted },
  statusTextCancelled: { color: colors.error },
  cancelLine: { fontFamily: fonts.bodySemibold, fontSize: 12.5, lineHeight: 18, color: colors.error, marginTop: 8 },
  requestBox: { marginTop: 10, backgroundColor: '#fff', borderRadius: 12, padding: 10, gap: 8 },
  requestText: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.ink },
  requestSlot: { fontFamily: fonts.bodyBold },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  smallBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.panel },
  smallBtnPrimary: { borderColor: colors.dark, backgroundColor: colors.dark },
  smallBtnText: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.ink },
  smallBtnTextPrimary: { color: colors.onRed },
  sheetShade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 34 },
  grab: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#ddd', alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { fontFamily: fonts.bodyExtraBold, fontSize: 17, color: colors.ink },
  sheetSub: { fontFamily: fonts.bodyMedium, fontSize: 13.5, color: colors.muted, marginTop: 2, marginBottom: 10 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  sheetRowText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  sheetHint: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.faint, marginTop: 10 },
  disputePromptBtn: { marginTop: 10, alignSelf: 'flex-start' },
  disputePromptText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.muted },
  disputeSubmitted: { marginTop: 10, backgroundColor: colors.panel2, borderRadius: 12, padding: 10 },
  disputeStatus: { fontFamily: fonts.bodyBold, fontSize: 11.5, color: colors.goldText },
  disputeSubjectText: { fontFamily: fonts.body, fontSize: 12.5, color: colors.muted, marginTop: 3 },
  disputeForm: { marginTop: 12, gap: 8 },
  disputeSubjectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  disputeChip: { backgroundColor: colors.panel2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  disputeChipActive: { backgroundColor: colors.dark },
  disputeChipText: { fontFamily: fonts.bodySemibold, fontSize: 12, color: colors.ink },
  disputeChipTextActive: { color: '#fff' },
  disputeInput: {
    minHeight: 72,
    borderRadius: 14,
    backgroundColor: colors.panel2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  disputeError: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.error },
  disputeSubmitBtn: { alignSelf: 'flex-start', backgroundColor: colors.dark, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 },
  disputeSubmitBtnDisabled: { opacity: 0.6 },
  disputeSubmitText: { fontFamily: fonts.bodyBold, fontSize: 13, color: '#fff' },
});
