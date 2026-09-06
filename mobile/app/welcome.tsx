import { router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../components/Button';
import Logo from '../components/Logo';
import { markOnboardingSeen } from '../lib/onboarding';
import { TEACHERS } from '../lib/teachers-data';
import { colors, fonts, radius } from '../lib/theme';

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
    icon: '🤝',
  },
  {
    key: 'progress',
    title: 'Gelişimini gerçekten gör.',
    subtitle: 'Ders geçmişi ve konuşma güveniyle ilerlemeni adım adım takip et.',
    kind: 'icon' as const,
    icon: '📈',
  },
];

function PhotoStack() {
  const photos = TEACHERS.slice(0, 3);
  return (
    <View style={styles.photoStack}>
      {photos.map((t, i) => (
        <Image
          key={t.id}
          source={{ uri: t.photo }}
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
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  function handleScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(e.nativeEvent.contentOffset.x / width);
    setActiveIndex(index);
  }

  async function goTo(path: '/(auth)/register' | '/(auth)/login') {
    await markOnboardingSeen();
    router.replace(path);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Logo size={22} />
      </View>

      <ScrollView
        ref={scrollRef}
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
                  <Text style={styles.iconText}>{slide.icon}</Text>
                </View>
              )}
            </View>
            <Text style={styles.title}>{slide.title}</Text>
            <Text style={styles.subtitle}>{slide.subtitle}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots}>
        {SLIDES.map((slide, i) => (
          <View key={slide.key} style={[styles.dot, i === activeIndex && styles.dotActive]} />
        ))}
      </View>

      <View style={styles.footer}>
        <Button label="Başla" onPress={() => goTo('/(auth)/register')} />
        <Text style={styles.signInRow}>
          Zaten hesabın var mı?{' '}
          <Text style={styles.signInLink} onPress={() => goTo('/(auth)/login')}>
            Giriş yap
          </Text>
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
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
    borderColor: colors.bg,
    backgroundColor: colors.panel2,
  },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: colors.panel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 60,
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
    backgroundColor: colors.gold3,
  },
  footer: {
    paddingHorizontal: 28,
    paddingBottom: 20,
  },
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
