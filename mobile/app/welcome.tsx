import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Dimensions,
  Image,
  Pressable,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Band from '../components/Band';
import Button from '../components/Button';
import Logo from '../components/Logo';
import { markOnboardingSeen } from '../lib/onboarding';
import { TEACHERS } from '../lib/teachers-data';
import { colors, fonts, radius } from '../lib/theme';
import { useLang, useT, type Lang } from '../lib/i18n';

const { width } = Dimensions.get('window');

const SLIDES = [
  {
    key: 'match',
    title: 'Sana uygun öğretmeni bul.',
    subtitle: 'Hedefine, seviyene ve bütçene göre seçtiğin bir öğretmenle birebir ilerle.',
    kind: 'photos' as const,
  },
  {
    key: 'trial',
    title: 'Önce dene, sonra karar ver.',
    subtitle: 'İlk dersten önce deneme dersiyle uyumu test et — gizli ücret yok.',
    kind: 'icon' as const,
  },
  {
    key: 'progress',
    title: 'Gelişimini gerçekten gör.',
    subtitle: 'Ders geçmişi ve konuşma güveniyle ilerlemeni adım adım takip et.',
    kind: 'icon' as const,
  },
];

function PhotoStack() {
  const photos = TEACHERS.slice(0, 3);
  return (
    <View style={styles.photoStack}>
      {photos.map((t, i) => (
        <Image
          key={t.id}
          source={{ uri: t.photo! }}
          style={[
            styles.photoCard,
            {
              transform: [{ translateX: (i - 1) * 46 }, { rotate: `${(i - 1) * 6}deg` }],
              zIndex: i === 1 ? 2 : 1,
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function Welcome() {
  const t = useT();
  const { lang, setLang } = useLang();
  const [activeIndex, setActiveIndex] = useState(0);

  function handleScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(e.nativeEvent.contentOffset.x / width);
    setActiveIndex(index);
  }

  async function goTo(path: '/(auth)/get-started' | '/(auth)/login') {
    await markOnboardingSeen();
    router.replace(path);
  }

  return (
    <View style={styles.screen}>
      {/* the red band holds the logo and the pictures; the words sit below it */}
      <Band height={175} />
      <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Logo size={22} light />
      </View>

      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScrollEnd}
        style={{ flex: 1 }}
      >
        {SLIDES.map((slide) => (
          <View key={slide.key} style={[styles.slide, { width }]}>
            <View style={styles.visual}>
              {slide.kind === 'photos' ? (
                <PhotoStack />
              ) : (
                <View style={styles.iconCircle}>
                  <Logo size={30} light />
                </View>
              )}
            </View>
            <Text style={[styles.title, lang === 'en' && styles.titleEn]}>{t(slide.title)}</Text>
            <Text style={styles.subtitle}>{t(slide.subtitle)}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots}>
        {SLIDES.map((slide, i) => (
          <View key={slide.key} style={[styles.dot, i === activeIndex && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.footer}>
        {/* the language, chosen before signing up or in (design 4) */}
        <Text style={styles.langLabel}>DİL · LANGUAGE</Text>
        <View style={styles.langRow} accessibilityRole="radiogroup">
          {(
            [
              ['tr', 'TR', 'Türkçe'],
              ['en', 'EN', 'English'],
            ] as [Lang, string, string][]
          ).map(([code, short, name]) => {
            const on = lang === code;
            return (
              <Pressable
                key={code}
                onPress={() => setLang(code)}
                style={({ pressed }) => [styles.langBtn, on && styles.langBtnOn, pressed && { opacity: 0.85 }]}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={name}
              >
                <Text style={[styles.langCode, on && { color: colors.red }]}>{short}</Text>
                <Text style={[styles.langName, on && { color: colors.red }]}>{name}</Text>
                {on && <Ionicons name="checkmark-circle" size={16} color={colors.red} />}
              </Pressable>
            );
          })}
        </View>
        <Button label={t("Başla")} onPress={() => goTo('/(auth)/get-started')} />
        <Text style={styles.signInRow}>
          {t("Zaten hesabın var mı?")}{' '}
          <Text style={styles.signInLink} onPress={() => goTo('/(auth)/login')}>
            {t("Giriş yap")}</Text>
        </Text>
      </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  slide: {
    paddingHorizontal: 28,
    paddingTop: 12,
    alignItems: 'center',
  },
  visual: {
    height: 170,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  photoStack: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoCard: {
    width: 108,
    height: 140,
    borderRadius: radius.lg,
    borderWidth: 3,
    borderColor: colors.cream,
    backgroundColor: colors.panel2,
  },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(250,245,226,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(250,245,226,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.displayBlack,
    fontSize: 44,
    lineHeight: 48,
    color: colors.ink,
    textAlign: 'center',
    letterSpacing: -1,
    marginBottom: 16,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 15.5,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 7,
    marginTop: 8,
    marginBottom: 20,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotActive: {
    width: 20,
    backgroundColor: colors.red,
  },
  footer: {
    paddingHorizontal: 28,
    paddingBottom: 20,
  },
  // English runs longer: one step smaller, so the title keeps to three lines
  titleEn: { fontSize: 36, lineHeight: 40 },
  langLabel: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 8,
  },
  langRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  langBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  langBtnOn: { borderColor: colors.red, backgroundColor: colors.redSoft },
  langCode: { fontFamily: fonts.bodyExtraBold, fontSize: 11.5, color: colors.faint },
  langName: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.ink },
  signInRow: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 18,
  },
  signInLink: {
    fontFamily: fonts.bodyBold,
    color: colors.goldText,
  },
});
