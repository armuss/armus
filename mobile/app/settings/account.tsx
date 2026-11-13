import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScrollBand } from '../../components/Band';
import Button from '../../components/Button';
import { SettingsGroup, SettingsRow } from '../../components/SettingsRow';
import SimpleHeader from '../../components/SimpleHeader';
import { useAuth } from '../../lib/auth';
import { SITE_URL } from '../../lib/referrals';
import { colors, fonts, radius } from '../../lib/theme';
import { useT } from '../../lib/i18n';

// the word typed to unlock the final delete button ("sil", "SİL" and an
// English-keyboard "SIL" all count)
const CONFIRM_WORD = 'SİL';
const confirmed = (text: string) => ['SİL', 'SIL'].includes(text.trim().toLocaleUpperCase('tr-TR'));

/**
 * Hesap ve güvenlik: the settings that are hard to undo, one step away
 * from Profil so none of them is a single stray tap - the sign-in email
 * (shown, can't be changed), the password, and deleting the account,
 * which also asks for "SİL" to be typed before it can go ahead. Mirrors
 * the website's settings page, where these sit on their own tabs.
 */
export default function AccountSecurity() {
  const t = useT();
  const { profile, deleteAccount } = useAuth();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const open = (path: string) => Linking.openURL(`${SITE_URL}${path}`);

  function explainEmailLock() {
    Alert.alert(
      t("E-posta adresi değiştirilemez"),
      t("E-posta adresin hesabına bağlıdır. Yanlış bir adresle kaydolduysan ya da bu adrese artık erişemiyorsan bize ulaş."),
      [
        { text: t("Tamam"), style: 'cancel' },
        { text: t("Bize ulaş"), onPress: () => open('/iletisim') },
      ]
    );
  }

  function openDelete() {
    setTyped('');
    setError('');
    setDeleteOpen(true);
  }

  async function reallyDelete() {
    if (!confirmed(typed) || deleting) return;
    setDeleting(true);
    setError('');
    const result = await deleteAccount();
    setDeleting(false);
    if (!result.ok) {
      setError(result.error || t("Bir şeyler ters gitti. Lütfen tekrar dene."));
      return;
    }
    setDeleteOpen(false);
    router.replace('/welcome');
  }

  return (
    <SafeAreaView style={styles.safeRed} edges={['top']}>
      <SimpleHeader title={t("Hesap ve güvenlik")} />
      <ScrollView style={styles.list} contentContainerStyle={styles.content}>
        <ScrollBand height={30} />

        <Text style={styles.intro}>{t("Giriş bilgilerin ve hesabınla ilgili geri alınamayan işlemler burada.")}</Text>
        <SettingsGroup style={{ marginTop: 6 }}>
          {/* shown only: the sign-in email can't be changed (migration_117.sql) */}
          <SettingsRow icon="mail-outline" label={t("E-posta")} value={profile?.email} locked onPress={explainEmailLock} />
          <SettingsRow icon="lock-closed-outline" label={t("Şifre değiştir")} onPress={() => router.push('/settings/password')} last />
        </SettingsGroup>
        <Text style={styles.note}>{t("E-posta adresin hesabına bağlıdır ve değiştirilemez.")}</Text>

        <Text style={styles.dangerLabel}>{t("HESABI SİL")}</Text>
        <View style={styles.dangerBox}>
          <View style={styles.dangerHead}>
            <View style={styles.dangerIcon}>
              <Ionicons name="warning-outline" size={18} color={colors.error} />
            </View>
            <Text style={styles.dangerTitle}>{t("Hesabını kalıcı olarak sil")}</Text>
          </View>
          <Text style={styles.dangerText}>
            {t("Profilin, rezervasyonların, mesajların ve tüm verilerin kalıcı olarak silinir. Bu işlem geri alınamaz.")}</Text>
          <Pressable onPress={openDelete} style={({ pressed }) => [styles.dangerBtn, pressed && { opacity: 0.8 }]} accessibilityRole="button">
            <Ionicons name="trash-outline" size={16} color={colors.error} />
            <Text style={styles.dangerBtnText}>{t("Hesabımı sil")}</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal visible={deleteOpen} transparent animationType="slide" onRequestClose={() => {
          if (!deleting) setDeleteOpen(false);
        }}>
        <Pressable
          style={styles.shade}
          onPress={() => {
            if (!deleting) setDeleteOpen(false);
          }}
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.grab} />
            <Text style={styles.sheetTitle}>{t("Hesabını silmek istediğine emin misin?")}</Text>
            <Text style={styles.sheetText}>
              {t("Profilin, rezervasyonların, mesajların ve tüm verilerin kalıcı olarak silinir. Bu işlem geri alınamaz.")}</Text>
            <Text style={styles.sheetLabel}>
              {t("Onaylamak için ")}<Text style={styles.word}>{CONFIRM_WORD}</Text> {t(" yaz")}</Text>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              placeholder={CONFIRM_WORD}
              placeholderTextColor={colors.faint}
              autoCapitalize="characters"
              autoCorrect={false}
              style={[styles.input, confirmed(typed) && styles.inputOk]}
              editable={!deleting}
            />
            {!!error && <Text style={styles.error}>{error}</Text>}
            <View style={styles.actions}>
              <View style={{ flex: 1 }}>
                <Button label={t("Vazgeç")} variant="outline" onPress={() => setDeleteOpen(false)} disabled={deleting} />
              </View>
              <View style={{ flex: 1 }}>
                <Pressable
                  onPress={reallyDelete}
                  disabled={!confirmed(typed) || deleting}
                  style={({ pressed }) => [styles.finalBtn, (!confirmed(typed) || deleting) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !confirmed(typed) || deleting }}
                >
                  <Text style={styles.finalBtnText}>{deleting ? t("Siliniyor…") : t("Hesabımı Sil")}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeRed: { flex: 1, backgroundColor: colors.red },
  list: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  intro: { fontFamily: fonts.bodyMedium, fontSize: 13.5, lineHeight: 19, color: 'rgba(250,245,226,0.9)', marginTop: 4, marginBottom: 6, paddingHorizontal: 4 },
  note: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.muted, marginTop: 8, marginHorizontal: 6 },

  dangerLabel: { fontFamily: fonts.bodyExtraBold, fontSize: 11, letterSpacing: 1, color: colors.error, marginTop: 34, marginBottom: 8, marginLeft: 6 },
  dangerBox: { backgroundColor: colors.panel, borderRadius: 18, borderWidth: 1, borderColor: '#efcfcc', padding: 16, gap: 10 },
  dangerHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dangerIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fbeceb' },
  dangerTitle: { fontFamily: fonts.bodyExtraBold, fontSize: 14.5, color: colors.ink },
  dangerText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.muted },
  dangerBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.error,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginTop: 2,
  },
  dangerBtnText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.error },

  shade: { flex: 1, backgroundColor: 'rgba(10,10,10,0.45)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 34 },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 16 },
  sheetTitle: { fontFamily: fonts.display, fontSize: 19, lineHeight: 25, color: colors.ink, letterSpacing: -0.3 },
  sheetText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted, marginTop: 8 },
  sheetLabel: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.ink, marginTop: 18, marginBottom: 8 },
  word: { fontFamily: fonts.bodyExtraBold, color: colors.error, letterSpacing: 1 },
  input: {
    height: 50,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    paddingHorizontal: 15,
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    letterSpacing: 2,
    color: colors.ink,
  },
  inputOk: { borderColor: colors.error },
  error: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18, color: colors.error, marginTop: 10 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  finalBtn: { height: 52, borderRadius: radius.md, backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center' },
  finalBtnText: { fontFamily: fonts.bodyExtraBold, fontSize: 15, color: '#fff' },
});
