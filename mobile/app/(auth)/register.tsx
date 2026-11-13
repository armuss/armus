import { Link, router } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScrollBand } from '../../components/Band';
import Button from '../../components/Button';
import Logo from '../../components/Logo';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius } from '../../lib/theme';

// Teacher applications only go through the website's full form (photo,
// certificate, video, availability...) - the app only ever creates
// student accounts. An existing teacher account (approved via the site)
// still logs in and uses the app's teacher screens just fine.
const TEACHER_APPLY_URL = 'https://armus.com.tr/apply-teacher.html';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  // the website's signup rules (register.html), word for word
  async function handleRegister() {
    setError('');
    setNotice('');
    const cleanName = name.trim();
    const cleanEmail = email.trim();
    // at least two letter-only words: first name and last name
    if (!/^\p{L}+(?:['-]\p{L}+)*(?:\s+\p{L}+(?:['-]\p{L}+)*)+$/u.test(cleanName)) {
      setError('Lütfen adını ve soyadını yaz (tek bir kelime yeterli değil).');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Geçerli bir e-posta adresi gir.');
      return;
    }
    if (password.length < 6) {
      setError('Şifre en az 6 karakter olmalı.');
      return;
    }
    if (password !== password2) {
      setError('Şifreler birbiriyle eşleşmiyor.');
      return;
    }
    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: { data: { name: cleanName, role: 'student', city: city.trim() || null } },
    });
    setLoading(false);
    if (signUpError) {
      // the same message whether or not the email already has an account,
      // like the website - no "this email is registered" oracle
      setError('Hesap oluşturulamadı. Bilgilerini kontrol et, ya da zaten bir hesabın varsa giriş yapmayı dene.');
      return;
    }
    if (!data.session) {
      setNotice(`Hesabın oluşturuldu! ${cleanEmail} adresine gönderdiğimiz onay bağlantısına tıklayıp giriş yapabilirsin.`);
      return;
    }
    // the last step, like the website: the 6-digit email code
    router.replace('/verify-email');
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={styles.list} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* the logo and the greeting on the red band; the form below it */}
          <ScrollBand height={150} inset={28} fade={80} />
          <View style={styles.brandBlock}>
            <Logo size={32} light />
            <Text style={styles.title}>Hesap oluştur</Text>
            <Text style={styles.subtitle}>Hedefine uygun öğretmeni bulmaya başla.</Text>
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
          {!!notice && <Text style={styles.notice}>{notice}</Text>}

          <View style={{ marginTop: 8 }}>
            <Button label="Kayıt Ol" onPress={handleRegister} loading={loading} />
          </View>

          <Text style={styles.switchRow}>
            Zaten hesabın var mı?{' '}
            <Link href="/(auth)/login" style={styles.switchLink}>
              Giriş yap
            </Link>
          </Text>

          <Text style={styles.teacherNote}>
            Öğretmen olarak katılmak mı istiyorsun?{' '}
            <Text style={styles.switchLink} onPress={() => Linking.openURL(TEACHER_APPLY_URL)}>
              Web sitemizden başvur
            </Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // the status bar area is plain red; the scroll view paints the ground and carries the band
  screen: {
    flex: 1,
    backgroundColor: colors.red,
  },
  list: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 40,
  },
  brandBlock: {
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.onRed,
    marginTop: 24,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: 'rgba(250,245,226,0.85)',
    marginTop: 8,
    marginBottom: 64,
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
  notice: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.petrol,
    marginBottom: 14,
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
  teacherNote: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 14,
  },
});
