import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScrollBand } from '../components/Band';
import Button from '../components/Button';
import Logo from '../components/Logo';
import { needsEmailVerification, useAuth } from '../lib/auth';
import { invokeEdge } from '../lib/edge';
import { supabase } from '../lib/supabase';
import { colors, fonts, radius } from '../lib/theme';
import { useT } from '../lib/i18n';

const RESEND_COOLDOWN = 45;
// send-verification-email's answer inside its own 45-second cooldown
const RESEND_TOO_SOON = 'Çok sık istek gönderdin, biraz sonra tekrar dene.';

/**
 * "E-postanı doğrula": the website's last signup step (register.html) - a
 * 6-digit code mailed by send-verification-email, checked by
 * verify-email-code. A new account (created from 29 Sep 2026 on) can't use
 * the rest of the app until it's done; the tabs send it back here.
 */
export default function VerifyEmail() {
  const t = useT();
  const { profile, refreshProfile, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const sentOnce = useRef(false);

  async function sendCode(onArrival = false) {
    // one request at a time: quick taps on "Kodu tekrar gönder" each
    // mailed another code (and used up the day's 8)
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError('');
    const res = await invokeEdge('send-verification-email');
    sendingRef.current = false;
    setSending(false);
    if (!res.ok) {
      // reopening the app within 45 seconds of the last code: that code is
      // still on its way and still good - wait it out instead of an error
      if (onArrival && res.body?.error === RESEND_TOO_SOON) {
        setCooldown(RESEND_COOLDOWN);
        return;
      }
      // no cooldown for a send that never went out
      setError(res.error || t("Kod gönderilemedi. \"Kodu tekrar gönder\" ile tekrar dene."));
      return;
    }
    setCooldown(RESEND_COOLDOWN);
  }

  // like register?resume=1: arriving here sends a fresh code
  useEffect(() => {
    if (!profile || sentOnce.current) return;
    if (!needsEmailVerification(profile) && profile.email_verified) {
      router.replace('/(tabs)');
      return;
    }
    sentOnce.current = true;
    sendCode(true);
  }, [profile?.id]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function verify() {
    const value = code.trim();
    if (!value || !profile || verifying) return;
    setError('');
    setVerifying(true);
    const res = await invokeEdge('verify-email-code', { code: value });
    if (!res.ok) {
      setVerifying(false);
      setError(res.error || t("Kod doğrulanamadı. Tekrar dene."));
      return;
    }
    // confirm the flag really flipped before moving on (the website does
    // the same, so a failed write can't bounce the user in a loop)
    const { data } = await supabase.from('profiles').select('email_verified').eq('id', profile.id).maybeSingle();
    setVerifying(false);
    if (!data?.email_verified) {
      setError(t("Kodun doğru görünüyor ama hesabın hâlâ doğrulanmamış görünüyor. Tekrar dene, sorun sürerse \"Kodu tekrar gönder\"i kullan."));
      return;
    }
    await refreshProfile();
    router.replace('/(tabs)');
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={styles.list} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScrollBand height={170} inset={28} fade={80} />
          <View style={styles.brand}>
            <Logo size={28} light />
            <Text style={styles.eyebrow}>{t("SON ADIM")}</Text>
            <Text style={styles.title}>{t("E-postanı doğrula")}</Text>
            <Text style={styles.note}>
              {profile?.email ? t("{0} adresine 6 haneli bir kod gönderdik. Kodu aşağıya gir.", profile.email) : t("6 haneli kodu aşağıya gir.")}
            </Text>
          </View>

          <Text style={styles.label}>{t("Doğrulama kodu")}</Text>
          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
            placeholder={t("6 haneli kod")}
            placeholderTextColor={colors.faint}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            style={styles.input}
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <View style={{ marginTop: 8 }}>
            <Button label={t("Doğrula")} onPress={verify} loading={verifying} disabled={code.length < 6 || !profile} />
          </View>

          <View style={styles.resendRow}>
            <Text style={styles.resendText}>{t("Kod gelmedi mi? ")}</Text>
            <Pressable onPress={() => sendCode()} disabled={cooldown > 0 || sending} hitSlop={8}>
              <Text style={[styles.resendLink, (cooldown > 0 || sending) && styles.resendOff]}>
                {cooldown > 0 ? t("Kodu tekrar gönder ({0})", cooldown) : t("Kodu tekrar gönder")}
              </Text>
            </Pressable>
          </View>

          <Pressable
            onPress={async () => {
              await signOut();
              router.replace('/(auth)/login');
            }}
            style={styles.signOut}
            hitSlop={8}
          >
            <Text style={styles.signOutText}>{t("Farklı bir hesapla giriş yap")}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.red },
  list: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 28, paddingTop: 24, paddingBottom: 40 },
  brand: { alignItems: 'center', marginBottom: 40 },
  eyebrow: { fontFamily: fonts.bodyExtraBold, fontSize: 11, letterSpacing: 1.2, color: 'rgba(250,245,226,0.8)', marginTop: 22 },
  title: { fontFamily: fonts.display, fontSize: 26, color: colors.onRed, marginTop: 6, letterSpacing: -0.5, textAlign: 'center' },
  note: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: 'rgba(250,245,226,0.88)', marginTop: 8, textAlign: 'center' },
  label: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.ink, marginBottom: 8 },
  input: {
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    paddingHorizontal: 16,
    fontFamily: fonts.displayBold,
    fontSize: 22,
    letterSpacing: 6,
    color: colors.ink,
    textAlign: 'center',
  },
  error: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18, color: colors.error, marginTop: 12 },
  resendRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 22, flexWrap: 'wrap' },
  resendText: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  resendLink: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.red },
  resendOff: { color: colors.faint },
  signOut: { alignSelf: 'center', marginTop: 26 },
  signOutText: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: colors.muted, textDecorationLine: 'underline' },
});
