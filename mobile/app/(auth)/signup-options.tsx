import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts, radius } from '../../lib/theme';

function OptionButton({
  icon,
  iconColor,
  label,
  onPress,
}: {
  icon: string;
  iconColor?: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.option, { opacity: pressed ? 0.6 : 1 }]}>
      <Text style={[styles.optionIcon, iconColor ? { color: iconColor } : null]}>{icon}</Text>
      <Text style={styles.optionLabel}>{label}</Text>
    </Pressable>
  );
}

export default function SignupOptions() {
  const [notice, setNotice] = useState('');

  function comingSoon(provider: string) {
    setNotice(`${provider} ile kayıt yakında geliyor — şimdilik e-posta ile devam edebilirsin.`);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
        <Text style={styles.backArrow}>←</Text>
      </Pressable>

      <View style={styles.content}>
        <Text style={styles.title}>Sana uygun{'\n'}öğretmeni bulmak{'\n'}için kaydol</Text>
        <Text style={styles.subtitle}>500'den fazla onaylı öğretmene anında eriş</Text>

        <View style={styles.options}>
          <OptionButton icon="✉" label="E-posta ile kaydol" onPress={() => router.push('/(auth)/register')} />
          <OptionButton
            icon="G"
            iconColor="#4285F4"
            label="Google ile kaydol"
            onPress={() => comingSoon('Google')}
          />
          {Platform.OS === 'ios' && (
            <OptionButton icon="" label="Apple ile kaydol" onPress={() => comingSoon('Apple')} />
          )}
          <OptionButton
            icon="f"
            iconColor="#1877F2"
            label="Facebook ile kaydol"
            onPress={() => comingSoon('Facebook')}
          />
        </View>

        {!!notice && <Text style={styles.notice}>{notice}</Text>}

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
  options: {
    gap: 14,
  },
  option: {
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.ink,
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
  notice: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.goldText,
    backgroundColor: '#fff8e6',
    borderRadius: radius.md,
    padding: 12,
    marginTop: 20,
    textAlign: 'center',
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
    color: colors.ink,
    textAlign: 'center',
    textDecorationLine: 'underline',
    paddingVertical: 24,
  },
});
