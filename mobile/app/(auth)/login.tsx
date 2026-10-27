import { Link, router } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../../components/Button';
import Logo from '../../components/Logo';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius } from '../../lib/theme';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  const [resetting, setResetting] = useState(false);

  // Same as the site's "Şifremi unuttum" (auth.js armusRequestPasswordReset):
  // the email's link opens armus.com.tr/sifre-sifirla, where the new
  // password is set - then the student signs in here with it.
  async function handleForgotPassword() {
    setError('');
    setResetMessage('');
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Şifreni sıfırlamak için önce e-posta adresini yaz.');
      return;
    }
    setResetting(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: 'https://armus.com.tr/sifre-sifirla',
    });
    setResetting(false);
    if (resetError) {
      setError('Sıfırlama e-postası gönderilemedi. Lütfen biraz sonra tekrar dene.');
      return;
    }
    setResetMessage('Şifre sıfırlama bağlantısını e-postana gönderdik. Bağlantıdan yeni şifreni belirleyip buradan giriş yapabilirsin.');
  }

  async function handleLogin() {
    setError('');
    if (!email || !password) {
      setError('E-posta ve şifreni gir.');
      return;
    }
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) {
      setError('E-posta veya şifre hatalı.');
      return;
    }
    router.replace('/(tabs)');
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brandBlock}>
            <Logo size={32} />
            <Text style={styles.title}>Tekrar hoş geldin</Text>
            <Text style={styles.subtitle}>Öğretmeninle devam etmek için giriş yap.</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>E-posta</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="ornek@eposta.com"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Şifre</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Şifren"
              placeholderTextColor={colors.faint}
              secureTextEntry
              autoComplete="current-password"
              style={styles.input}
            />
          </View>

          <Pressable onPress={handleForgotPassword} disabled={resetting} hitSlop={8} style={styles.forgotRow}>
            <Text style={styles.forgotText}>{resetting ? 'Gönderiliyor…' : 'Şifremi unuttum'}</Text>
          </Pressable>

          {!!error && <Text style={styles.error}>{error}</Text>}
          {!!resetMessage && <Text style={styles.resetMessage}>{resetMessage}</Text>}

          <View style={{ marginTop: 8 }}>
            <Button label="Giriş Yap" onPress={handleLogin} loading={loading} />
          </View>

          <Text style={styles.switchRow}>
            Hesabın yok mu?{' '}
            <Link href="/(auth)/signup-options" style={styles.switchLink}>
              Kayıt ol
            </Link>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  forgotRow: {
    alignSelf: 'flex-end',
    marginTop: -6,
    marginBottom: 12,
  },
  forgotText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13,
    color: colors.goldText,
  },
  resetMessage: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    lineHeight: 19,
    color: colors.success,
    marginBottom: 12,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: 28,
    paddingTop: 40,
    paddingBottom: 40,
  },
  brandBlock: {
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.ink,
    marginTop: 28,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: colors.muted,
    marginTop: 8,
    marginBottom: 32,
    textAlign: 'center',
  },
  field: {
    marginBottom: 18,
  },
  label: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13,
    color: colors.ink,
    marginBottom: 8,
  },
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 16,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.panel,
  },
  error: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.error,
    marginBottom: 14,
  },
  switchRow: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 24,
  },
  switchLink: {
    fontFamily: fonts.bodyBold,
    color: colors.goldText,
  },
});
