import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Band from '../../components/Band';
import { colors, fonts } from '../../lib/theme';

function PrimaryOption({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.option, { backgroundColor: colors.dark, opacity: pressed ? 0.86 : 1 }]}>
      <Ionicons name={icon} size={19} color={colors.gold2} style={{ marginRight: 10 }} />
      <Text style={[styles.optionLabel, { color: colors.onRed }]}>{label}</Text>
    </Pressable>
  );
}

export default function SignupOptions() {
  return (
    <View style={styles.screen}>
      <Band height={240} />
      <SafeAreaView style={styles.safe}>
      <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
        <Text style={styles.backArrow}>←</Text>
      </Pressable>

      <View style={styles.content}>
        <Text style={styles.title}>Sana uygun{'\n'}öğretmeni bulmak{'\n'}için kaydol</Text>
        <Text style={styles.subtitle}>
          <Text style={styles.subtitleAccent}>500'den fazla</Text> onaylı öğretmene anında eriş
        </Text>

        <View style={styles.options}>
          <PrimaryOption icon="mail-outline" label="E-posta ile kaydol" onPress={() => router.push('/(auth)/register')} />
        </View>

        <Text style={styles.legal}>
          Kaydol'a tıklayarak, ARMUS'un Hizmet Koşullarını ve Gizlilik Politikasını kabul etmiş sayılırsın.
        </Text>
      </View>

      <Link href="/(auth)/login" style={styles.loginLink}>
        Hesabıma giriş yap
      </Link>
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
    color: colors.onRed,
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
    color: colors.onRed,
    letterSpacing: -1,
    marginBottom: 14,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 15.5,
    color: 'rgba(250,245,226,0.85)',
    marginBottom: 44,
  },
  subtitleAccent: {
    fontFamily: fonts.bodyBold,
    color: colors.onRed,
  },
  options: {
    gap: 14,
  },
  option: {
    height: 56,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 15.5,
    color: colors.ink,
  },
  legal: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.muted,
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
