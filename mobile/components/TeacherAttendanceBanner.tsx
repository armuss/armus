import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  ATTENDANCE_RULES_TEXT,
  getLatestOwnAttendanceReport,
  selfUnhideFromNewStudents,
  submitAttendanceExplanation,
  type AttendanceReport,
} from '../lib/attendance';
import { useAuth, type Profile } from '../lib/auth';
import { notify } from '../lib/dialogs';
import { supabase } from '../lib/supabase';
import { colors, fonts, radius } from '../lib/theme';
import Button from './Button';
import { getLocale, useT } from '../lib/i18n';

/**
 * The teacher panel's attendance banner (dashboard.html
 * renderAttendanceBanner / openAttendanceModal): shown while the teacher
 * is hidden or banned, or a student's report is waiting for their one
 * explanation. Tapping it opens the same details - write the explanation,
 * see it under review, make the profile visible again after a trial
 * no-show hide, or read why it's hidden.
 */
export default function TeacherAttendanceBanner({ reloadKey }: { reloadKey?: number }) {
  const t = useT();
  const { profile: signedIn, refreshProfile } = useAuth();
  // the hide / ban flags are re-read on every refresh (an admin may have
  // changed them since sign-in)
  const [fresh, setFresh] = useState<Partial<Profile> | null>(null);
  const profile = signedIn ? ({ ...signedIn, ...(fresh || {}) } as Profile) : null;
  const [report, setReport] = useState<AttendanceReport | null>(null);
  const [open, setOpen] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);

  const userId = signedIn?.role === 'teacher' ? signedIn.id : null;
  const load = useCallback(async () => {
    if (!userId) return;
    const [latest, flags] = await Promise.all([
      getLatestOwnAttendanceReport(userId),
      supabase
        .from('profiles')
        .select(
          'is_banned, hidden_from_new_students, hidden_until, hidden_reason, penalty_hide_reason, trial_hidden_tier, trial_noshow_count, trial_unhide_eligible_at, trial_unhide_requires_ack'
        )
        .eq('id', userId)
        .maybeSingle(),
    ]);
    setReport(latest);
    if (flags.data) setFresh(flags.data as Partial<Profile>);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  if (!profile || profile.role !== 'teacher') return null;

  const hiddenUntilActive = !!profile.hidden_until && new Date(profile.hidden_until) > new Date();
  const isHidden = !!profile.is_banned || !!profile.hidden_from_new_students || hiddenUntilActive;
  const hasOpenReport = report?.status === 'open';
  if (!isHidden && !hasOpenReport) return null;

  const title = profile.is_banned
    ? t("Hesabın kapatıldı")
    : isHidden
      ? t("Profilin yeni öğrencilerden gizli")
      : t("Bir dersinle ilgili bildirim var");
  const sub = profile.is_banned
    ? t("Detaylar için tıkla")
    : hasOpenReport
      ? t("Bir öğrenci bir şey bildirdi - açıklamak için tıkla")
      : t("Detaylar için tıkla");

  async function sendExplanation() {
    const text = explanation.trim();
    if (!text || !report) return;
    setBusy(true);
    const result = await submitAttendanceExplanation(report.id, text);
    setBusy(false);
    if (!result) {
      notify(t("Gönderilemedi"), t("Gönderilemedi. Lütfen tekrar dene."));
      return;
    }
    setOpen(false);
    setExplanation('');
    setReport(result);
  }

  async function makeVisible(requiresAck: boolean) {
    setBusy(true);
    const result = await selfUnhideFromNewStudents(requiresAck);
    setBusy(false);
    if (result !== 'ok') {
      notify(t("İşlem başarısız"), t("İşlem başarısız oldu. Lütfen tekrar dene."));
      return;
    }
    setOpen(false);
    await refreshProfile();
    await load();
  }

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={({ pressed }) => [styles.banner, { opacity: pressed ? 0.9 : 1 }]}>
        <Ionicons name="warning-outline" size={20} color={colors.error} />
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>{title}</Text>
          <Text style={styles.bannerSub}>{sub}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.faint} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.shade} onPress={() => setOpen(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.grab} />
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Details
                profile={profile}
                report={report}
                explanation={explanation}
                setExplanation={setExplanation}
                busy={busy}
                ack={ack}
                setAck={setAck}
                onExplain={sendExplanation}
                onMakeVisible={makeVisible}
                onClose={() => setOpen(false)}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function Details({
  profile,
  report,
  explanation,
  setExplanation,
  busy,
  ack,
  setAck,
  onExplain,
  onMakeVisible,
  onClose,
}: {
  profile: Profile;
  report: AttendanceReport | null;
  explanation: string;
  setExplanation: (t: string) => void;
  busy: boolean;
  ack: boolean;
  setAck: (v: boolean) => void;
  onExplain: () => void;
  onMakeVisible: (requiresAck: boolean) => void;
  onClose: () => void;
}) {
  const t = useT();
  const contact = <Button label={t("Bize Ulaş")} variant="gold" onPress={() => Linking.openURL('https://armus.com.tr/iletisim')} />;
  const close = <Button label={t("Kapat")} variant="outline" onPress={onClose} />;

  const typeLabel =
    report?.type === 'no_show'
      ? t("derse gelmedin")
      : report?.type === 'technical'
        ? t("senin tarafında teknik bir sorun yaşandığını")
        : t("derse geç kaldın");

  if (profile.is_banned) {
    return (
      <>
        <Text style={styles.title}>{t("Hesabın kapatıldı")}</Text>
        <Text style={styles.text}>
          {t("Tekrarlanan, doğrulanmış devamsızlık nedeniyle hesabın kalıcı olarak kapatıldı. İtiraz etmek istersen bizimle iletişime geç.")}</Text>
        <View style={styles.actions}>{contact}</View>
      </>
    );
  }

  if (report?.status === 'open') {
    return (
      <>
        <Text style={styles.title}>{t("Bir öğrenci bir şey bildirdi")}</Text>
        <Text style={styles.text}>
          {report.type === 'no_show'
            ? t("Bir öğrenci {0} bildirdi. Bu yüzden profilin şu anda yeni öğrencilerin aramasından gizli.", typeLabel)
            : t("Bir öğrenci {0} bildirdi. Profilin gizlenmedi; ekibimiz inceleyecek. İstersen açıklamanı yaz.", typeLabel)}
        </Text>
        <Text style={styles.rules}>{t(ATTENDANCE_RULES_TEXT)}</Text>
        <TextInput
          value={explanation}
          onChangeText={setExplanation}
          placeholder={t("Ne oldu? Kısaca açıkla...")}
          placeholderTextColor={colors.faint}
          multiline
          style={styles.input}
        />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>{close}</View>
          <View style={{ flex: 1 }}>
            <Button label={t("Açıklamayı Gönder")} onPress={onExplain} loading={busy} disabled={!explanation.trim()} />
          </View>
        </View>
      </>
    );
  }

  if (report?.status === 'explained') {
    return (
      <>
        <Text style={styles.title}>{t("Açıklaman inceleniyor")}</Text>
        <Text style={styles.text}>
          {t("Açıklamanı gönderdin, ekibimiz inceliyor. Profilin bu süreç tamamlanana kadar yeni öğrencilerin aramasından gizli kalır.")}</Text>
        {!!report.teacherExplanation && <Text style={styles.rules}>{report.teacherExplanation}</Text>}
        <View style={styles.actions}>{close}</View>
      </>
    );
  }

  if (profile.hidden_reason === 'trial_no_show' && (profile.trial_hidden_tier || 0) > 0) {
    const tier = profile.trial_hidden_tier || 0;
    const eligibleAt = profile.trial_unhide_eligible_at ? new Date(profile.trial_unhide_eligible_at) : null;
    const eligible = !!eligibleAt && eligibleAt <= new Date();
    const requiresAck = !!profile.trial_unhide_requires_ack;
    return (
      <>
        <Text style={styles.title}>{t("Profilin yeni öğrencilerden gizli (Deneme Dersi) — Seviye {0}/5", tier)}</Text>
        <Text style={styles.text}>
          {t("Bu, doğrulanmış {0}. deneme dersine gelmeme bildirimin. Her tekrar, profilinin yeni öğrencilerden daha uzun süre gizlenmesine yol açar - mevcut öğrencilerin seni görmeye devam eder.", profile.trial_noshow_count || tier)}</Text>
        {!eligible ? (
          <Text style={styles.rules}>
            {eligibleAt ? eligibleAt.toLocaleDateString(getLocale()) : ''} {t(" tarihinden sonra profilini tekrar görünür yapabilirsin.")}</Text>
        ) : (
          <>
            {requiresAck && (
              <Pressable onPress={() => setAck(!ack)} style={styles.ackRow}>
                <View style={[styles.box, ack && styles.boxOn]}>{ack && <Ionicons name="checkmark" size={14} color={colors.onRed} />}</View>
                <Text style={styles.ackText}>{t("Kurallarımızı okudum ve bundan sonra derslerime zamanında katılacağıma söz veriyorum.")}</Text>
              </Pressable>
            )}
            <View style={styles.actions}>
              <Button label={t("Profilimi Görünür Yap")} onPress={() => onMakeVisible(requiresAck)} loading={busy} disabled={requiresAck && !ack} />
            </View>
          </>
        )}
        <View style={styles.actions}>{close}</View>
      </>
    );
  }

  const hiddenUntilActive = !!profile.hidden_until && new Date(profile.hidden_until) > new Date();
  if ((profile.penalty_hide_reason === 'no_show' || profile.penalty_hide_reason === 'late') && !hiddenUntilActive) {
    const penaltyType = profile.penalty_hide_reason === 'no_show' ? t("derse gelmeme") : t("derse geç kalma");
    return (
      <>
        <Text style={styles.title}>{t("Profilin yeni öğrencilerden gizli")}</Text>
        <Text style={styles.text}>
          {t("Hakkındaki bir {0} bildirimi ekibimiz tarafından doğrulandı. Bu yüzden profilin yeni öğrencilerin aramasından gizli - mevcut öğrencilerin seni görmeye ve ders almaya devam ediyor. Bu gizlilik ekibimiz kaldırana kadar sürer; itiraz etmek ya da durumu konuşmak istersen bize ulaş.", penaltyType)}</Text>
        <Text style={styles.rules}>{t(ATTENDANCE_RULES_TEXT)}</Text>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>{contact}</View>
          <View style={{ flex: 1 }}>{close}</View>
        </View>
      </>
    );
  }

  return (
    <>
      <Text style={styles.title}>{t("Profilin geçici olarak gizli")}</Text>
      <Text style={styles.text}>
        {t("Tekrarlanan, doğrulanmış devamsızlık/geç kalma bildirimleri nedeniyle profilin bir süreliğine herkesten (yeni ve mevcut öğrencilerden) gizlendi.")}</Text>
      <Text style={styles.rules}>{t(ATTENDANCE_RULES_TEXT)}</Text>
      <View style={styles.actions}>{close}</View>
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    borderWidth: 1.5,
    borderColor: colors.error,
  },
  bannerTitle: { fontFamily: fonts.bodyExtraBold, fontSize: 14, color: colors.ink },
  bannerSub: { fontFamily: fonts.body, fontSize: 12.5, color: colors.muted, marginTop: 2 },
  shade: { flex: 1, backgroundColor: 'rgba(10,10,10,0.45)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 34,
    maxHeight: '88%',
  },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 16 },
  title: { fontFamily: fonts.display, fontSize: 19, lineHeight: 25, color: colors.ink, letterSpacing: -0.3 },
  text: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.ink, marginTop: 8 },
  rules: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    lineHeight: 19,
    color: colors.muted,
    marginTop: 12,
    padding: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.panel2,
  },
  input: {
    minHeight: 96,
    marginTop: 12,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    padding: 12,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  row: { flexDirection: 'row', gap: 10, marginTop: 16 },
  actions: { marginTop: 14 },
  ackRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 14 },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: colors.red, borderColor: colors.red },
  ackText: { flex: 1, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.ink },
});
