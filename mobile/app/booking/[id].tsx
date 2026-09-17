import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';

import Button from '../../components/Button';
import { useAuth } from '../../lib/auth';
import { DAY_NAMES, MONTH_NAMES, formatTimeRange, slotsForDate, type Slot } from '../../lib/bookings';
import { shortDisplayName } from '../../lib/displayName';
import { createPayment, hasCoveringCredit, parsePaymentRedirect } from '../../lib/payments';
import { findMarketplaceTeacher } from '../../lib/teachers';
import type { Teacher } from '../../lib/teachers-data';
import { colors, fonts, radius } from '../../lib/theme';

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
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
  const { id, type: typeParam } = useLocalSearchParams<{ id: string; type?: string }>();
  const type = typeParam === 'lesson' ? 'lesson' : 'trial';
  const { profile } = useAuth();

  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasCredit, setHasCredit] = useState(false);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [identityNumber, setIdentityNumber] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [phase, setPhase] = useState<Phase>('picking');
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [creditApplied, setCreditApplied] = useState(false);

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
    hasCoveringCredit(profile.id, teacher.id, type === 'trial').then(setHasCredit);
  }, [profile, teacher, type]);

  const selectedDateInfo = DATE_OPTIONS.find((d) => d.key === selectedDate) || null;

  const slots: Slot[] = useMemo(() => {
    if (!teacher || !selectedDateInfo) return [];
    return slotsForDate(teacher, selectedDateInfo.key, selectedDateInfo.date.getDay());
  }, [teacher, selectedDateInfo]);

  function pickDate(key: string) {
    setSelectedDate(key);
    setSelectedTime(null);
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

    const needsCard = !hasCredit;
    if (needsCard) {
      if (phone.replace(/\D/g, '').length < 10) {
        setError('Lütfen geçerli bir telefon numarası gir.');
        return;
      }
      if (!/^[1-9][0-9]{10}$/.test(identityNumber)) {
        setError('Lütfen geçerli bir T.C. kimlik numarası gir (11 haneli).');
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
      phone,
      identityNumber,
    });
    setSubmitting(false);

    if (!result.ok) {
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
        <ActivityIndicator color={colors.gold3} />
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
          renderLoading={() => <ActivityIndicator color={colors.gold3} style={{ marginTop: 40 }} />}
          onNavigationStateChange={(navState) => {
            const status = parsePaymentRedirect(navState.url);
            if (status === 'success') {
              finishBooking(false);
            } else if (status === 'failed') {
              setPhase('picking');
              setError('Ödeme tamamlanmadı ya da iptal edildi. Rezervasyon oluşturulmadı — istersen tekrar deneyebilirsin.');
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
          {shortDisplayName(teacher.name)} ile {selectedDateInfo?.label} · {selectedTime ? formatTimeRange(selectedTime) : ''}
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

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Geri</Text>
        </Pressable>

        <View style={styles.teacherRow}>
          {teacher.photo ? (
            <Image source={{ uri: teacher.photo }} style={styles.teacherPhoto} />
          ) : (
            <View style={[styles.teacherPhoto, styles.teacherPhotoFallback]}>
              <Text style={styles.teacherPhotoText}>{teacher.initials}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.teacherName}>{shortDisplayName(teacher.name)}</Text>
            <Text style={styles.teacherRole}>{teacher.role}</Text>
          </View>
          <Text style={styles.price}>₺{teacher.price}</Text>
        </View>

        <Text style={styles.sectionTitle}>Tarih seç</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateRow}>
          {DATE_OPTIONS.map((d) => (
            <Pressable
              key={d.key}
              onPress={() => pickDate(d.key)}
              style={[styles.datePill, selectedDate === d.key && styles.datePillSelected]}
            >
              <Text style={[styles.dayName, selectedDate === d.key && styles.dateTextSelected]}>
                {DAY_NAMES[d.date.getDay()]}
              </Text>
              <Text style={[styles.dayNum, selectedDate === d.key && styles.dateTextSelected]}>
                {d.date.getDate()}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {selectedDate && (
          <>
            <Text style={styles.sectionTitle}>Saat seç</Text>
            {slots.some((s) => s.available) ? (
              <View style={styles.slotGrid}>
                {slots.map((slot) => (
                  <Pressable
                    key={slot.time}
                    disabled={!slot.available}
                    onPress={() => {
                      setSelectedTime(slot.time);
                      setError('');
                    }}
                    style={[
                      styles.slot,
                      !slot.available && styles.slotUnavailable,
                      selectedTime === slot.time && styles.slotSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.slotText,
                        !slot.available && styles.slotTextUnavailable,
                        selectedTime === slot.time && styles.slotTextSelected,
                      ]}
                    >
                      {formatTimeRange(slot.time)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyHint}>Bu tarihte boş saat yok, başka bir gün dene.</Text>
            )}
          </>
        )}

        {selectedDate && selectedTime && (
          <View style={styles.confirmBox}>
            <Text style={styles.sectionTitle}>Özet</Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Öğretmen</Text>
              <Text style={styles.summaryValue}>{shortDisplayName(teacher.name)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Tarih</Text>
              <Text style={styles.summaryValue}>{selectedDateInfo?.label}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Saat</Text>
              <Text style={styles.summaryValue}>{formatTimeRange(selectedTime)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{hasCredit ? 'Ders hakkı' : 'Ücret'}</Text>
              <Text style={styles.summaryValue}>{hasCredit ? 'Uygulanacak' : `₺${teacher.price}`}</Text>
            </View>

            {hasCredit ? (
              <Text style={styles.creditNote}>Kart bilgisi gerekmiyor, ders hakkınla rezervasyon tamamlanacak.</Text>
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
              </>
            )}

            {!!error && <Text style={styles.error}>{error}</Text>}

            <Button
              label={hasCredit ? 'Rezervasyonu Tamamla' : submitting ? 'Yönlendiriliyor…' : 'Ödemeye Geç'}
              onPress={handleConfirm}
              loading={submitting}
            />
          </View>
        )}
      </ScrollView>
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
  notFound: {
    fontFamily: fonts.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 60,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },
  backBtn: {
    marginBottom: 12,
  },
  backText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13.5,
    color: colors.muted,
  },
  teacherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 26,
  },
  teacherPhoto: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.panel2,
  },
  teacherPhotoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  teacherPhotoText: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 16,
    color: colors.muted,
  },
  teacherName: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 16,
    color: colors.ink,
  },
  teacherRole: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 2,
  },
  price: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 17,
    color: colors.ink,
  },
  sectionTitle: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 12,
  },
  dateRow: {
    gap: 10,
    paddingBottom: 24,
  },
  datePill: {
    width: 54,
    height: 64,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  datePillSelected: {
    borderColor: colors.gold3,
    backgroundColor: colors.gold3,
  },
  dayName: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.muted,
  },
  dayNum: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 16,
    color: colors.ink,
  },
  dateTextSelected: {
    color: colors.onGold,
  },
  slotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
  },
  slot: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  slotUnavailable: {
    borderColor: colors.borderSoft,
    backgroundColor: colors.panel2,
  },
  slotSelected: {
    borderColor: colors.gold3,
    backgroundColor: colors.gold3,
  },
  slotText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13,
    color: colors.ink,
  },
  slotTextUnavailable: {
    color: colors.faint,
  },
  slotTextSelected: {
    color: colors.onGold,
  },
  emptyHint: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.muted,
    marginBottom: 24,
  },
  confirmBox: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
  },
  summaryLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13.5,
    color: colors.muted,
  },
  summaryValue: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13.5,
    color: colors.ink,
  },
  creditNote: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12.5,
    color: colors.goldText,
    backgroundColor: '#fff8e6',
    borderRadius: radius.md,
    padding: 10,
    marginTop: 10,
    marginBottom: 14,
  },
  field: {
    marginTop: 14,
    marginBottom: 4,
  },
  label: {
    fontFamily: fonts.bodySemibold,
    fontSize: 12.5,
    color: colors.ink,
    marginBottom: 8,
  },
  input: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: colors.ink,
    backgroundColor: colors.bg,
  },
  error: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12.5,
    color: colors.error,
    marginTop: 14,
    marginBottom: 4,
  },
  checkoutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  checkoutTitle: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 15,
    color: colors.ink,
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.gold3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  successIconText: {
    fontSize: 32,
    color: colors.onGold,
    fontFamily: fonts.bodyExtraBold,
  },
  successTitle: {
    fontFamily: fonts.displayBlack,
    fontSize: 22,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 10,
  },
  successSubtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
});
