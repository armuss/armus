import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';

import Button from '../../components/Button';
import { shortDisplayName } from '../../lib/displayName';
import { createPayment } from '../../lib/payments';
import { findMarketplaceTeacher } from '../../lib/teachers';
import type { Teacher } from '../../lib/teachers-data';
import { colors, fonts, radius } from '../../lib/theme';

const WEEKS_PER_PACKAGE = 4;

type PackageOption = {
  lessonsPerWeek: number;
  totalLessons: number;
  totalPrice: number;
};

function buildOptions(pricePerLesson: number): PackageOption[] {
  return [1, 2, 3, 4, 5].map((lessonsPerWeek) => {
    const totalLessons = lessonsPerWeek * WEEKS_PER_PACKAGE;
    return { lessonsPerWeek, totalLessons, totalPrice: totalLessons * pricePerLesson };
  });
}

type Phase = 'options' | 'confirm' | 'checkout' | 'success';

export default function PackageOffer() {
  const { teacherId } = useLocalSearchParams<{ teacherId: string }>();
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>('options');
  const [selected, setSelected] = useState<PackageOption | null>(null);
  const [phone, setPhone] = useState('');
  const [identityNumber, setIdentityNumber] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    findMarketplaceTeacher(teacherId).then((t) => {
      if (active) {
        setTeacher(t);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [teacherId]);

  function close() {
    router.replace('/(tabs)/lessons');
  }

  function pickOption(option: PackageOption) {
    setSelected(option);
    setError('');
    setPhase('confirm');
  }

  async function handleConfirm() {
    if (!teacher || !selected || submitting) return;

    if (phone.replace(/\D/g, '').length < 10) {
      setError('Lütfen geçerli bir telefon numarası gir.');
      return;
    }
    if (!/^[1-9][0-9]{10}$/.test(identityNumber)) {
      setError('Lütfen geçerli bir T.C. kimlik numarası gir (11 haneli).');
      return;
    }

    setError('');
    setSubmitting(true);
    const result = await createPayment({
      teacherId: teacher.id,
      teacherName: teacher.name,
      type: 'package',
      quantity: selected.totalLessons,
      price: selected.totalPrice,
      phone,
      identityNumber,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.bookedDirectly) {
      setPhase('success');
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
          <Pressable onPress={() => setPhase('confirm')} style={styles.iconBtn}>
            <Text style={styles.iconBtnText}>← Vazgeç</Text>
          </Pressable>
          <Text style={styles.checkoutTitle}>Güvenli ödeme</Text>
        </View>
        <WebView
          source={{ uri: checkoutUrl }}
          startInLoadingState
          renderLoading={() => <ActivityIndicator color={colors.gold3} style={{ marginTop: 40 }} />}
          onNavigationStateChange={(navState) => {
            if (navState.url.includes('payment=success')) {
              setPhase('success');
            } else if (navState.url.includes('payment=failed')) {
              setPhase('confirm');
              setError('Ödeme tamamlanmadı ya da iptal edildi.');
            } else if (navState.url.includes('payment=error')) {
              setError('Ödemen alındı ama paket tanımlanırken bir sorun çıktı. Lütfen bizimle iletişime geç.');
              setPhase('confirm');
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
        <Text style={styles.successTitle}>Paketin hazır!</Text>
        <Text style={styles.successSubtitle}>
          {selected?.totalLessons} ders hakkın {shortDisplayName(teacher.name)} için tanımlandı — istediğin zaman
          rezervasyon yapabilirsin.
        </Text>
        <View style={{ width: '100%', marginTop: 28 }}>
          <Button label="Derslerime Git" onPress={close} />
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'confirm' && selected) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => setPhase('options')} style={styles.iconBtn}>
            <Text style={styles.iconBtnText}>← Geri</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.sectionTitle}>Özet</Text>
          <View style={styles.confirmBox}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Öğretmen</Text>
              <Text style={styles.summaryValue}>{shortDisplayName(teacher.name)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Paket</Text>
              <Text style={styles.summaryValue}>{selected.lessonsPerWeek} ders / hafta</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Toplam ders</Text>
              <Text style={styles.summaryValue}>{selected.totalLessons}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Tutar</Text>
              <Text style={styles.summaryValue}>₺{selected.totalPrice.toFixed(2)}</Text>
            </View>

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

            {!!error && <Text style={styles.error}>{error}</Text>}

            <Button
              label={submitting ? 'Yönlendiriliyor…' : 'Ödemeye Geç'}
              onPress={handleConfirm}
              loading={submitting}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const options = buildOptions(teacher.price);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.hero}>
        <View style={styles.heroTopBar}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn}>
            <Text style={styles.iconBtnTextLight}>←</Text>
          </Pressable>
          <Pressable onPress={close} style={styles.iconBtn}>
            <Text style={styles.iconBtnTextLight}>✕</Text>
          </Pressable>
        </View>
        <Text style={styles.heroIcon}>📘</Text>
        <Text style={styles.heroTitle}>Gelişimin burada başlıyor!</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>
          {shortDisplayName(teacher.name)} ile haftalık ders paketini seç. Fiyatlar 50 dakikalık standart dersi
          kapsar — tüm ders hakların istediğin zaman kullanılabilir, otomatik yenilenmez.
        </Text>

        {options.map((option) => (
          <Pressable key={option.lessonsPerWeek} onPress={() => pickOption(option)} style={styles.optionCard}>
            <Text style={styles.optionTitle}>
              {option.lessonsPerWeek} ders <Text style={styles.optionTitleUnit}>/ hafta</Text>
            </Text>
            <Text style={styles.optionMeta}>
              {option.totalLessons} ders x ₺{teacher.price} · {WEEKS_PER_PACKAGE} haftada bir{' '}
              <Text style={styles.optionMetaBold}>₺{option.totalPrice.toFixed(2)}</Text>
            </Text>
            {option.lessonsPerWeek === 3 && (
              <View style={styles.popularBadge}>
                <Text style={styles.popularBadgeText}>Popüler</Text>
              </View>
            )}
          </Pressable>
        ))}
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
  hero: {
    backgroundColor: '#fff8e6',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 24,
  },
  heroTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  iconBtn: {
    padding: 4,
  },
  iconBtnText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13.5,
    color: colors.muted,
  },
  iconBtnTextLight: {
    fontSize: 20,
    color: colors.ink,
  },
  heroIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  heroTitle: {
    fontFamily: fonts.displayBlack,
    fontSize: 28,
    lineHeight: 33,
    color: colors.ink,
    letterSpacing: -0.5,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: 20,
  },
  optionCard: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 18,
    marginBottom: 14,
  },
  optionTitle: {
    fontFamily: fonts.displayBlack,
    fontSize: 20,
    color: colors.ink,
  },
  optionTitleUnit: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.muted,
  },
  optionMeta: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.muted,
    marginTop: 8,
  },
  optionMetaBold: {
    fontFamily: fonts.bodyExtraBold,
    color: colors.ink,
  },
  popularBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.gold3,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 12,
  },
  popularBadgeText: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.onGold,
  },
  topBar: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  sectionTitle: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 12,
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
