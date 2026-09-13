import { LinearGradient } from 'expo-linear-gradient';
import { Link, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts, goldGradient, radius } from '../../lib/theme';

function PrimaryOption({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}>
      <LinearGradient colors={goldGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.option}>
        <Text style={[styles.optionIcon, { color: colors.onGold }]}>{icon}</Text>
        <Text style={[styles.optionLabel, { color: colors.onGold }]}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

export default function SignupOptions() {
  return (
    <SafeAreaView style={styles.screen}>
      <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
        <Text style={styles.backArrow}>←</Text>
      </Pressable>

      <View style={styles.content}>
        <Text style={styles.title}>Sana uygun{'\n'}öğretmeni bulmak{'\n'}için kaydol</Text>
        <Text style={styles.subtitle}>
          <Text style={styles.subtitleAccent}>500'den fazla</Text> onaylı öğretmene anında eriş
        </Text>

        <View style={styles.options}>
          <PrimaryOption icon="✉" label="E-posta ile kaydol" onPress={() => router.push('/(auth)/register')} />
        </View>

        <Text style={styles.legal}>
          Kaydol'a tıklayarak, ARMUS'un Hizmet Koşullarını ve Gizlilik Politikasını kabul etmiş sayılırsın.
        </Text>
      </View>

      <Link href="/(auth)/login" style={styles.loginLink}>
        Hesabıma giriş yap
      </Link>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  backBtn: {
    marginLeft: 24,
    marginTop: 8,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: {
    fontSize: 22,
    color: colors.ink,
  },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 12,
  },
  title: {
    fontFamily: fonts.displayBlack,
    fontSize: 38,
    lineHeight: 42,
    color: colors.ink,
    letterSpacing: -1,
    marginBottom: 14,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 15.5,
    color: colors.muted,
    marginBottom: 36,
  },
  subtitleAccent: {
    fontFamily: fonts.bodyBold,
    color: colors.goldText,
  },
  options: {
    gap: 14,
  },
  option: {
    height: 56,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIcon: {
    fontSize: 19,
    fontWeight: '700',
    color: colors.ink,
    marginRight: 10,
    width: 22,
    textAlign: 'center',
  },
  optionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 15.5,
    color: colors.ink,
  },
  legal: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.faint,
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 18,
  },
  loginLink: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.goldText,
    textAlign: 'center',
    textDecorationLine: 'underline',
    paddingVertical: 24,
  },
});
