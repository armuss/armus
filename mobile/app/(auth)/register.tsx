import { Link, router, useLocalSearchParams } from 'expo-router';
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

type Role = 'student' | 'teacher';

export default function Register() {
  const params = useLocalSearchParams<{ role?: string }>();
  const [role, setRole] = useState<Role>(params.role === 'teacher' ? 'teacher' : 'student');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    setError('');
    if (!name || !email || !password) {
      setError('Ad, e-posta ve şifre zorunlu.');
      return;
    }
    if (password.length < 6) {
      setError('Şifre en az 6 karakter olmalı.');
      return;
    }
    if (password !== password2) {
      setError('Şifreler eşleşmiyor.');
      return;
    }
    setLoading(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, role, city: city || null } },
    });
    setLoading(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    router.replace('/(tabs)');
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Logo size={30} />
          <Text style={styles.title}>Hesap oluştur</Text>
          <Text style={styles.subtitle}>Hedefine uygun öğretmeni bulmaya başla.</Text>

          <View style={styles.roleRow}>
            <Pressable
              onPress={() => setRole('student')}
              style={[styles.roleOption, role === 'student' && styles.roleOptionActive]}
            >
              <Text style={[styles.roleText, role === 'student' && styles.roleTextActive]}>Öğrenci olarak</Text>
            </Pressable>
            <Pressable
              onPress={() => setRole('teacher')}
              style={[styles.roleOption, role === 'teacher' && styles.roleOptionActive]}
            >
              <Text style={[styles.roleText, role === 'teacher' && styles.roleTextActive]}>Öğretmen olarak</Text>
            </Pressable>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Ad Soyad</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Adın Soyadın"
              placeholderTextColor={colors.faint}
              autoComplete="name"
              style={styles.input}
            />
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
            <Text style={styles.label}>
              Şehir <Text style={styles.optional}>(opsiyonel)</Text>
            </Text>
            <TextInput
              value={city}
              onChangeText={setCity}
              placeholder="İstanbul"
              placeholderTextColor={colors.faint}
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Şifre</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="En az 6 karakter"
              placeholderTextColor={colors.faint}
              secureTextEntry
              autoComplete="new-password"
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Şifre (tekrar)</Text>
            <TextInput
              value={password2}
              onChangeText={setPassword2}
              placeholder="Şifreni tekrar yaz"
              placeholderTextColor={colors.faint}
              secureTextEntry
              autoComplete="new-password"
              style={styles.input}
            />
          </View>

          {!!error && <Text style={styles.error}>{error}</Text>}

          <View style={{ marginTop: 8 }}>
            <Button label="Kayıt Ol" onPress={handleRegister} loading={loading} />
          </View>

          <Text style={styles.switchRow}>
            Zaten hesabın var mı?{' '}
            <Link href="/(auth)/login" style={styles.switchLink}>
              Giriş yap
            </Link>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: 28,
    paddingTop: 40,
    paddingBottom: 40,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.ink,
    marginTop: 28,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: colors.muted,
    marginTop: 8,
    marginBottom: 24,
  },
  roleRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  roleOption: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleOptionActive: {
    borderColor: colors.gold3,
    backgroundColor: '#fff8e6',
  },
  roleText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13.5,
    color: colors.muted,
  },
  roleTextActive: {
    color: colors.goldText,
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
  optional: {
    fontFamily: fonts.body,
    color: colors.muted,
    fontWeight: '400',
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
