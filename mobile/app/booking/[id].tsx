import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';

import { ScrollBand } from '../../components/Band';
import Button from '../../components/Button';
import PayerConsent from '../../components/PayerConsent';
import WithdrawalConsent from '../../components/WithdrawalConsent';
import { isValidTurkishIdentityNumber, normalizeTurkishPhone } from '../../lib/payer';
import { useAuth } from '../../lib/auth';
import {
  DAY_NAMES,
  MONTH_NAMES,
  formatLessonWhenForViewer,
  getTeacherBusyTimes,
  lessonTypeLabel,
  slotsForDate,
  zonedTimeToUtc,
  type BusyTime,
  type Slot,
} from '../../lib/bookings';
import {
  formatMoney,
  getAvailableCredits,
  hasTakenTrialWith,
  pickCreditForBooking,
  type CreditCoverage,
  type LessonCredit,
} from '../../lib/credits';
import { shortDisplayName } from '../../lib/displayName';
import { createPayment, parsePaymentRedirect } from '../../lib/payments';
import { findMarketplaceTeacher } from '../../lib/teachers';
import type { Teacher } from '../../lib/teachers-data';
import { colors, fonts, radius } from '../../lib/theme';

// getDate()/getMonth()/getFullYear() read the device's own local
// calendar day - date.toISOString() reads the UTC date instead, which
// silently disagrees with the day number/name shown on each pill (built
// from the same local Date with getDate()/getDay() below) for any device
// in a positive-UTC-offset timezone (Turkey is UTC+3) during the few
// hours right after local midnight. Mirrors the identical fix already
// made to booking.html's own toDateKey().
function toDateKey(date: Date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

const DATE_OPTIONS = Array.from({ length: 10 }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() + i);
  return {
    date,
    key: toDateKey(date),
    label: `${date.getDate()} ${MONTH_NAMES[date.getMonth()]}, ${DAY_NAMES[date.getDay()]}`,
  };
});

type Phase = 'picking' | 'checkout' | 'success' | 'error';

export default function Booking() {
  const { id, type: typeParam, date: dateParam } = useLocalSearchParams<{ id: string; type?: string; date?: string }>();
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  // one trial per teacher (migration_110.sql): a student who's had theirs
  // with this teacher is switched to a regular lesson, with a notice
  const [type, setType] = useState<'trial' | 'lesson'>(typeParam === 'lesson' ? 'lesson' : 'trial');
  const [trialTakenNotice, setTrialTakenNotice] = useState(false);

  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [loading, setLoading] = useState(true);
  const [credits, setCredits] = useState<LessonCredit[]>([]);
  const [busyTimes, setBusyTimes] = useState<BusyTime[]>([]);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [identityNumber, setIdentityNumber] = useState('');
  const [payerConsent, setPayerConsent] = useState(false);
  const [withdrawalConsent, setWithdrawalConsent] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [phase, setPhase] = useState<Phase>('picking');
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [creditApplied, setCreditApplied] = useState(false);
  // the red band reaches just past the week strip, wherever a notice puts it
  const [weekBottom, setWeekBottom] = useState(130);

  useEffect(() => {
    let active = true;
    findMarketplaceTeacher(id).then((t) => {
      if (!active) return;
      setTeacher(t);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (!profile || !teacher) return;
    getAvailableCredits(profile.id).then((list) => setCredits(list || []));
    if (type === 'trial') {
      hasTakenTrialWith(profile.id, teacher.id).then((taken) => {
        if (taken) {
          setType('lesson');
          setTrialTakenNotice(true);
        }
      });
    }
  }, [profile, teacher, type]);

  // what a lesson credit covers here (migration_110.sql): all of it, or
  // part of it with the difference by card - create-payment decides the
  // same way
  const coverage: CreditCoverage | null = useMemo(
    () => (teacher ? pickCreditForBooking(credits, teacher.id, type, Number(teacher.price)) : null),
    [credits, teacher, type]
  );
  const coversAll = !!coverage && coverage.topUp === 0;
  const needsCard = !coversAll;

  // Without this, the picker can't tell a slot someone else already took
  // apart from a genuinely open one - it would show as pickable right up
  // until the booking itself fails server-side (bookings_teacher_slot_unique).
  useEffect(() => {
    if (!teacher) return;
    let active = true;
    getTeacherBusyTimes(teacher.id).then((busy) => {
      if (active) setBusyTimes(busy);
    });
    return () => {
      active = false;
    };
  }, [teacher]);

  // re-checked after a slot_taken redirect (below) - the slot that was
  // just lost to another student needs to grey out immediately, not only
  // on the next time this screen happens to remount.
  function refreshBusyTimes() {
    if (teacher) getTeacherBusyTimes(teacher.id).then(setBusyTimes);
  }

  const selectedDateInfo = DATE_OPTIONS.find((d) => d.key === selectedDate) || null;

  const slots: Slot[] = useMemo(() => {
    if (!teacher || !selectedDateInfo) return [];
    // a time that has already started today can't be booked (create-payment
    // refuses it) - grey it out rather than let it fail at "Ödemeye Geç"
    const now = Date.now();
    return slotsForDate(teacher, selectedDateInfo.key, selectedDateInfo.date.getDay(), busyTimes).map((slot) => ({
      ...slot,
      available: slot.available && zonedTimeToUtc(selectedDateInfo.key, slot.time, teacher.timezone).getTime() > now,
    }));
  }, [teacher, selectedDateInfo, busyTimes]);

  // which of the bookable days have at least one open time (calendar dots)
  const openDays = useMemo(() => {
    const out: Record<string, boolean> = {};
    if (!teacher) return out;
    const now = Date.now();
    for (const d of DATE_OPTIONS) {
      out[d.key] = slotsForDate(teacher, d.key, d.date.getDay(), busyTimes).some(
        (slot) => slot.available && zonedTimeToUtc(d.key, slot.time, teacher.timezone).getTime() > now
      );
    }
    return out;
  }, [teacher, busyTimes]);

  // open on the first day that has a free time, so times show right away
  useEffect(() => {
    if (selectedDate || !teacher) return;
    // a day picked on the profile's "Saatler" tab comes along as ?date=
    const first = DATE_OPTIONS.find((d) => d.key === dateParam && openDays[d.key]) ?? DATE_OPTIONS.find((d) => openDays[d.key]);
    if (first) setSelectedDate(first.key);
  }, [openDays, teacher, selectedDate]);

  // Every teacher-local time shown to the student (slot grid, summary,
  // success screen) converts through this - a slot picked in the
  // teacher's own calendar grid, not the viewer's. A slot near midnight
  // could otherwise pair a date read straight off the teacher-local
  // dateKey with a time already converted to the viewer's zone, showing
  // a date/time that don't actually belong to the same real moment -
  // mirrors booking.html's identical fix (armusFormatDateLabelForViewer/
  // armusFormatSlotTimeRangeForViewer, bookings.js) for the same reason.
  function whenForViewer(dateKey: string, time: string) {
    return teacher ? formatLessonWhenForViewer({ date: dateKey, time, teacherTimezone: teacher.timezone }) : null;
  }

  const selectedWhen = selectedDateInfo && selectedTime ? whenForViewer(selectedDateInfo.key, selectedTime) : null;

  function pickDate(key: string) {
    setSelectedDate(key);
    setSelectedTime(null);
    setExpandedGroups([]);
    setError('');
  }

  // A trial that just completed is the moment to offer a real weekly
  // package with this same teacher instead of the plain success screen -
  // matches booking a regular lesson, which still shows the checkmark.
  function finishBooking(creditApplied: boolean) {
    if (type === 'trial' && teacher) {
      router.replace({ pathname: '/package/[teacherId]', params: { teacherId: teacher.id } });
      return;
    }
    setCreditApplied(creditApplied);
    setPhase('success');
  }

  async function handleConfirm() {
    if (!teacher || !profile || !selectedDate || !selectedTime || submitting) return;

    // the credit picture was read when the screen opened - if a credit got
    // used somewhere else since (another device), the card fields may be
    // hidden while the card is now needed. Re-check right before paying.
    const fresh = await getAvailableCredits(profile.id);
    if (fresh) {
      const freshCoverage = pickCreditForBooking(fresh, teacher.id, type, Number(teacher.price));
      const mode = (c: CreditCoverage | null) => (!c ? 'none' : c.topUp > 0 ? `topup-${c.topUp}` : 'full');
      if (mode(freshCoverage) !== mode(coverage)) {
        setCredits(fresh);
        setError('Ders hakkın bu arada kullanıldı. Devam etmek için aşağıdaki bilgileri kontrol et.');
        return;
      }
    }

    if (needsCard) {
      // the website checkout's own checks (lib/payer.ts)
      if (!normalizeTurkishPhone(phone)) {
        setError('Lütfen geçerli bir cep telefonu numarası gir.');
        return;
      }
      if (!isValidTurkishIdentityNumber(identityNumber)) {
        setError('Lütfen geçerli bir T.C. kimlik numarası gir (11 haneli).');
        return;
      }
      if (!payerConsent) {
        setError('Devam etmek için kimlik ve ödeme bilgilerinin işlenmesini kabul etmelisin.');
        return;
      }
      if (!withdrawalConsent) {
        setError('Ödemeye geçmek için cayma hakkıyla ilgili onay kutusunu işaretlemelisin.');
        return;
      }
    }

    setError('');
    setSubmitting(true);
    const result = await createPayment({
      teacherId: teacher.id,
      teacherName: teacher.name,
      type,
      date: selectedDate,
      time: selectedTime,
      price: teacher.price,
      phone: normalizeTurkishPhone(phone) || phone,
      identityNumber: identityNumber.replace(/\D/g, ''),
      withdrawalConsent: needsCard && withdrawalConsent,
    });
    setSubmitting(false);

    if (!result.ok) {
      if (result.trialAlreadyTaken && type === 'trial') {
        setType('lesson');
        setTrialTakenNotice(true);
        setError('');
        return;
      }
      setError(result.error);
      return;
    }

    if (result.bookedDirectly) {
      finishBooking(result.creditApplied);
      return;
    }

    setCheckoutUrl(result.paymentPageUrl);
    setPhase('checkout');
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.red} />
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

  if (phase === 'checkout' && checkoutUrl) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.checkoutHeader}>
          <Pressable onPress={() => setPhase('picking')} style={styles.backBtn}>
            <Text style={styles.backText}>← Vazgeç</Text>
          </Pressable>
          <Text style={styles.checkoutTitle}>Güvenli ödeme</Text>
        </View>
        <WebView
          source={{ uri: checkoutUrl }}
          startInLoadingState
          renderLoading={() => <ActivityIndicator color={colors.ink} style={{ marginTop: 40 }} />}
          onNavigationStateChange={(navState) => {
            const status = parsePaymentRedirect(navState.url);
            if (status === 'success') {
              finishBooking(false);
            } else if (status === 'failed') {
              setPhase('picking');
              setError('Ödeme tamamlanmadı ya da iptal edildi. Rezervasyon oluşturulmadı — istersen tekrar deneyebilirsin.');
            } else if (status === 'slot_taken') {
              setPhase('picking');
              setSelectedTime(null);
              refreshBusyTimes();
              setError(
                'Bu saati sen ödemeni tamamlarken başka bir öğrenci aldı. Ödemen bir ders hakkına çevrildi — aşağıdan başka bir saat seçebilirsin.'
              );
            } else if (status === 'time_passed') {
              setPhase('picking');
              setSelectedTime(null);
              refreshBusyTimes();
              setError(
                'Ödemen tamamlanana kadar seçtiğin ders saati geçti. Ödemen bir ders hakkına çevrildi — aşağıdan başka bir saat seçebilirsin.'
              );
            } else if (status === 'error') {
              setPhase('error');
            }
          }}
        />
      </SafeAreaView>
    );
  }

  if (phase === 'success') {
    return (
      <SafeAreaView style={[styles.screen, styles.centered, { paddingHorizontal: 32 }]}>
        <View style={styles.successIcon}>
          <Text style={styles.successIconText}>✓</Text>
        </View>
        <Text style={styles.successTitle}>Rezervasyon tamamlandı!</Text>
        <Text style={styles.successSubtitle}>
          {shortDisplayName(teacher.name)} ile {selectedWhen?.dateLabel} · {selectedWhen?.timeRange ?? ''}
        </Text>
        {creditApplied && <Text style={styles.creditNote}>Ders hakkınla ödeme yapılmadan tamamlandı.</Text>}
        <View style={{ width: '100%', marginTop: 28 }}>
          <Button label="Derslerime Git" onPress={() => router.replace('/(tabs)/lessons')} />
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'error') {
    return (
      <SafeAreaView style={[styles.screen, styles.centered, { paddingHorizontal: 32 }]}>
        <Text style={styles.successTitle}>Bir sorun çıktı</Text>
        <Text style={styles.successSubtitle}>
          Ödemen alındı ama rezervasyon oluşturulurken bir sorun çıktı. Lütfen bizimle iletişime geç, ödemenle
          ilgileneceğiz.
        </Text>
        <View style={{ width: '100%', marginTop: 28 }}>
          <Button label="Geri Dön" variant="outline" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  // open times of the chosen day, grouped by the viewer's own part of day
  const groups = (() => {
    if (!selectedDateInfo) return [];
    const parts: { key: string; label: string; items: { time: string; start: string; end: string }[] }[] = [
      { key: 'morning', label: 'Öğleden önce', items: [] },
      { key: 'noon', label: 'Öğleden sonra', items: [] },
      { key: 'evening', label: 'Akşam', items: [] },
      { key: 'night', label: 'Gece', items: [] },
    ];
    for (const slot of slots) {
      if (!slot.available) continue;
      const range = whenForViewer(selectedDateInfo.key, slot.time)?.timeRange ?? slot.time;
      const [start, end = ''] = range.split(/\s*[–-]\s*/);
      const hour = Number(start.slice(0, 2));
      const part = hour >= 6 && hour < 12 ? 0 : hour >= 12 && hour < 17 ? 1 : hour >= 17 ? 2 : 3;
      parts[part].items.push({ time: slot.time, start, end });
    }
    return parts.filter((g) => g.items.length > 0);
  })();
  const openCount = groups.reduce((n, g) => n + g.items.length, 0);
  const ctaLabel = coversAll
    ? 'Rezervasyonu tamamla'
    : submitting
      ? 'Yönlendiriliyor…'
      : coverage
        ? `Farkı öde (${formatMoney(coverage.topUp)})`
        : 'Ödemeye geç';

  return (
    <SafeAreaView style={styles.safeRed} edges={['top']}>
      <ScrollView style={styles.list} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <ScrollBand height={weekBottom - 24} fade={64} />
        <View style={styles.head}>
          <Pressable onPress={() => router.back()} style={styles.roundBtn} accessibilityLabel="Geri">
            <Ionicons name="chevron-back" size={20} color={colors.onRed} />
          </Pressable>
          <View style={styles.headText}>
            <Text style={styles.headTitle} numberOfLines={1}>
              {shortDisplayName(teacher.name)} ile ders
            </Text>
            <Text style={styles.headSub}>
              {lessonTypeLabel(type)} · 50 dk · ₺{teacher.price}
            </Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {trialTakenNotice && (
          <Text style={styles.notice}>
            Bu öğretmenle daha önce deneme dersi aldın, bu yüzden bu rezervasyon normal ders olarak yapılacak. Deneme dersi her
            öğretmenle bir kez alınabilir.
          </Text>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.week}
          contentContainerStyle={styles.weekInner}
          onLayout={(e) => setWeekBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
        >
          {DATE_OPTIONS.map(({ date, key }) => {
            const on = selectedDate === key;
            const open = openDays[key];
            return (
              <Pressable
                key={key}
                onPress={() => pickDate(key)}
                style={[styles.day, on && styles.dayOn]}
                accessibilityLabel={`${date.getDate()} ${MONTH_NAMES[date.getMonth()]}, ${DAY_NAMES[date.getDay()]}`}
              >
                <Text style={[styles.dayName, on && styles.dayNameOn]}>{DAY_NAMES[date.getDay()]}</Text>
                <Text style={[styles.dayNum, !open && styles.dayNumClosed, on && styles.dayNumOn]}>{date.getDate()}</Text>
                {open && <View style={styles.dayDot} />}
              </Pressable>
            );
          })}
        </ScrollView>

        {selectedDateInfo && (
          <>
            {groups.length === 0 ? (
              <View style={styles.emptyDay}>
                <Text style={styles.emptyHint}>Bu gün boş saat yok. Altında nokta olan bir gün seç.</Text>
              </View>
            ) : (
              groups.map((g) => {
                const expanded = expandedGroups.includes(g.key);
                const shown = expanded ? g.items : g.items.slice(0, 4);
                return (
                  <View key={g.key}>
                    <View style={styles.per}>
                      <Text style={styles.perText}>{g.label}</Text>
                      <Text style={styles.perText}>{g.items.length} boş saat</Text>
                    </View>
                    {shown.map((it) => {
                      const on = selectedTime === it.time;
                      return (
                        <Pressable
                          key={it.time}
                          onPress={() => {
                            setSelectedTime(it.time);
                            setError('');
                          }}
                          style={[styles.opt, on && styles.optOn]}
                        >
                          {on && (
                            <View style={styles.check}>
                              <Ionicons name="checkmark" size={14} color={colors.gold2} />
                            </View>
                          )}
                          <Text style={styles.optTime}>{it.start}</Text>
                          {!!it.end && <Text style={styles.optEnd}>{it.end} bitiş</Text>}
                        </Pressable>
                      );
                    })}
                    {g.items.length > 4 && (
                      <Pressable
                        onPress={() =>
                          setExpandedGroups((prev) => (expanded ? prev.filter((k) => k !== g.key) : [...prev, g.key]))
                        }
                        style={styles.moreBtn}
                      >
                        <Text style={styles.moreText}>{expanded ? 'Daha az göster' : `${g.items.length - 4} saat daha`}</Text>
                        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color={colors.muted} />
                      </Pressable>
                    )}
                  </View>
                );
              })
            )}
            {openCount > 0 && <Text style={styles.tzHint}>Saatler senin saat dilimine göre.</Text>}
          </>
        )}

        {selectedDate && selectedTime && (
          <View style={styles.confirmBox}>
            <Text style={styles.boxTitle}>Özet</Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Tarih</Text>
              <Text style={styles.summaryValue}>{selectedWhen?.dateLabel}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Saat</Text>
              <Text style={styles.summaryValue}>{selectedWhen?.timeRange}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Ücret</Text>
              <Text style={styles.summaryValue}>₺{teacher.price}</Text>
            </View>
            {coverage && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Ders hakkınla</Text>
                <Text style={[styles.summaryValue, { color: colors.goldText }]}>
                  {coversAll ? 'Ücretsiz' : `−${formatMoney(coverage.credit.value ?? 0)}`}
                </Text>
              </View>
            )}
            {coverage && !coversAll && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Kartla ödenecek fark</Text>
                <Text style={styles.summaryValue}>{formatMoney(coverage.topUp)}</Text>
              </View>
            )}

            {coverage && !coversAll && (
              <Text style={styles.creditNote}>
                Ders hakkın {formatMoney(coverage.credit.value ?? 0)} değerinde, bu ders {formatMoney(teacher.price)}. Ders hakkın{' '}
                {formatMoney(coverage.credit.value ?? 0)} kısmını karşılıyor, kalan {formatMoney(coverage.topUp)} kartla ödenir.
              </Text>
            )}
            {coversAll ? (
              <>
                <Text style={styles.creditNote}>Kart bilgisi gerekmiyor, ders hakkınla rezervasyon tamamlanacak.</Text>
                {!!coverage && coverage.leftover > 0 && (
                  <Text style={styles.creditNote}>
                    Bu ders hakkı {formatMoney(coverage.credit.value ?? 0)} değerinde, bu ders {formatMoney(teacher.price)}. Ders hakkın
                    dersi tamamen karşılıyor; aradaki {formatMoney(coverage.leftover)} iade edilmez.
                  </Text>
                )}
              </>
            ) : (
              <>
                <View style={styles.field}>
                  <Text style={styles.label}>Telefon</Text>
                  <TextInput
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="05XX XXX XX XX"
                    placeholderTextColor={colors.faint}
                    keyboardType="phone-pad"
                    style={styles.input}
                  />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>T.C. Kimlik No</Text>
                  <TextInput
                    value={identityNumber}
                    onChangeText={setIdentityNumber}
                    placeholder="11 haneli kimlik numaran"
                    placeholderTextColor={colors.faint}
                    keyboardType="number-pad"
                    maxLength={11}
                    style={styles.input}
                  />
                </View>
                <PayerConsent checked={payerConsent} onChange={setPayerConsent} />
                <WithdrawalConsent checked={withdrawalConsent} onChange={setWithdrawalConsent} />
              </>
            )}

            {!!error && <Text style={styles.error}>{error}</Text>}
          </View>
        )}
        {!!error && !(selectedDate && selectedTime) && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {selectedDate && selectedTime ? (
          <Pressable
            onPress={handleConfirm}
            disabled={submitting}
            style={({ pressed }) => [styles.go, { opacity: submitting ? 0.7 : pressed ? 0.88 : 1 }]}
          >
            {submitting ? (
              <ActivityIndicator color={colors.gold2} />
            ) : (
              <Text style={styles.goText} numberOfLines={1} adjustsFontSizeToFit>
                {selectedWhen?.dateLabel} · {selectedWhen?.time} · <Text style={styles.goGold}>{ctaLabel}</Text>
              </Text>
            )}
          </Pressable>
        ) : (
          <View style={[styles.go, styles.goIdle]}>
            <Text style={styles.goIdleText}>{openCount > 0 ? 'Bir saat seç' : 'Bir gün seç'}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  // the picker: the status bar area is plain red, the scroll view paints the ground and carries the band
  safeRed: { flex: 1, backgroundColor: colors.red },
  list: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },
  notFound: { fontFamily: fonts.body, color: colors.muted, textAlign: 'center', marginTop: 60 },
  content: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
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
  headText: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  headTitle: { fontFamily: fonts.bodyExtraBold, fontSize: 16, color: colors.onRed },
  headSub: { fontFamily: fonts.bodyMedium, fontSize: 12, color: 'rgba(250,245,226,0.8)', marginTop: 1 },
  backBtn: { paddingVertical: 4 },
  backText: { fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.ink },
  notice: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.goldText,
    backgroundColor: colors.goldSoft,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 12,
    lineHeight: 19,
  },
  week: { marginHorizontal: -16, marginBottom: 6 },
  weekInner: { paddingHorizontal: 16, gap: 6 },
  // white day tiles on the band, the picked day in cream with red figures
  day: { width: 46, alignItems: 'center', paddingTop: 8, paddingBottom: 12, borderRadius: 16, backgroundColor: colors.panel },
  dayOn: { backgroundColor: colors.cream },
  dayName: { fontFamily: fonts.bodySemibold, fontSize: 11.5, color: colors.faint },
  dayNameOn: { color: colors.red },
  dayNum: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.ink, marginTop: 2 },
  dayNumClosed: { color: '#cdbfae' },
  dayNumOn: { color: colors.red },
  dayDot: { position: 'absolute', bottom: 4, width: 5, height: 5, borderRadius: 3, backgroundColor: colors.goldDot },
  per: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, marginBottom: 8 },
  perText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.faint, letterSpacing: 0.5, textTransform: 'uppercase' },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    marginBottom: 8,
  },
  optOn: { borderColor: colors.red, borderWidth: 2, padding: 13, backgroundColor: colors.panel },
  check: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  optTime: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  optEnd: { marginLeft: 'auto', fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.faint },
  moreBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8 },
  moreText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.muted },
  emptyDay: { borderWidth: 1.5, borderColor: colors.champagneDeep, borderStyle: 'dashed', borderRadius: 16, padding: 16, marginTop: 14 },
  emptyHint: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: colors.faint, textAlign: 'center' },
  tzHint: { fontFamily: fonts.body, fontSize: 12, color: colors.faint, marginTop: 6 },
  confirmBox: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, borderRadius: 20, padding: 16, marginTop: 16 },
  boxTitle: { fontFamily: fonts.bodyExtraBold, fontSize: 16, color: colors.ink, marginBottom: 6 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  summaryLabel: { fontFamily: fonts.body, fontSize: 13.5, color: colors.muted },
  summaryValue: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.ink },
  creditNote: { fontFamily: fonts.bodyMedium, fontSize: 12.5, color: colors.goldText, marginTop: 8, lineHeight: 18, textAlign: 'left' },
  field: { marginTop: 14 },
  label: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.ink, marginBottom: 6 },
  input: {
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.panel2,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: colors.ink,
  },
  error: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.error, marginTop: 12, lineHeight: 18 },
  bar: { paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.bg },
  go: { height: 56, borderRadius: 18, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  goText: { fontFamily: fonts.bodyExtraBold, fontSize: 15, color: 'rgba(250,245,226,0.8)' },
  goGold: { color: colors.onRed },
  goIdle: { backgroundColor: colors.panel2 },
  goIdleText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.faint },
  checkoutHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  checkoutTitle: { fontFamily: fonts.bodyExtraBold, fontSize: 16, color: colors.ink },
  successIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.dark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  successIconText: { fontFamily: fonts.bodyExtraBold, fontSize: 34, color: colors.gold2 },
  successTitle: { fontFamily: fonts.display, fontSize: 21, color: colors.ink, textAlign: 'center' },
  successSubtitle: { fontFamily: fonts.body, fontSize: 14.5, color: colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 21 },
});
