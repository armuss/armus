import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../components/Button';
import { useAuth } from '../lib/auth';
import { MONTH_NAMES, getBookingsForTeacher } from '../lib/bookings';
import { formatMoney } from '../lib/credits';
import {
  PAYOUT_HOLD_DAYS,
  createWithdrawalRequest,
  getTeacherCredits,
  getWithdrawalRequests,
  isValidTurkishIban,
  normalizeIban,
  summarizeEarnings,
  type EarningsSummary,
  type WithdrawalRequest,
} from '../lib/earnings';
import { colors, fonts, radius } from '../lib/theme';

const STATUS_LABELS: Record<string, string> = { pending: 'Beklemede', paid: 'Ödendi', rejected: 'Reddedildi' };

function monthLabel(key: string) {
  const [year, month] = key.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

// A teacher's earnings and withdrawal requests - the app's version of
// dashboard.html's "Finansal" tab. Earnings are an estimate at the current
// commission tier; a lesson's share becomes withdrawable 7 days after it
// ends; a request is checked and paid by hand by the ARMUS team.
export default function Earnings() {
  const { profile } = useAuth();
  const timeZone = profile?.timezone || 'Europe/Istanbul';
  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [requests, setRequests] = useState<WithdrawalRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const [amount, setAmount] = useState('');
  const [iban, setIban] = useState('');
  const [ibanName, setIbanName] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    const [bookings, credits, withdrawals] = await Promise.all([
      getBookingsForTeacher(profile.id),
      getTeacherCredits(profile.id),
      getWithdrawalRequests(profile.id),
    ]);
    setSummary(summarizeEarnings(bookings, credits, withdrawals, timeZone));
    setRequests(withdrawals);
    setLoading(false);
  }, [profile, timeZone]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    if (!profile || !summary) return;
    const value = Number(amount.replace(',', '.'));
    const cleanIban = normalizeIban(iban);
    if (!value || value <= 0) return setStatus({ text: 'Geçerli bir tutar gir.', error: true });
    if (value > summary.withdrawableBalance) return setStatus({ text: 'Bu tutar çekilebilir bakiyenden fazla.', error: true });
    if (!isValidTurkishIban(cleanIban)) return setStatus({ text: 'Geçerli bir IBAN gir (TR ile başlayan 26 karakter).', error: true });
    if (!ibanName.trim()) return setStatus({ text: 'Hesap sahibinin adını gir.', error: true });

    setSending(true);
    const created = await createWithdrawalRequest({ teacherId: profile.id, amount: value, iban: cleanIban, ibanName: ibanName.trim(), note: note.trim() });
    setSending(false);
    if (!created) return setStatus({ text: 'Talep gönderilemedi. Lütfen tekrar dene.', error: true });
    setStatus({ text: 'Talebin gönderildi ✓', error: false });
    setAmount('');
    setNote('');
    load();
  }

  if (loading || !summary) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.gold3} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} style={{ marginBottom: 12 }}>
          <Text style={styles.back}>← Geri</Text>
        </Pressable>
        <Text style={styles.title}>Kazançlarım</Text>

        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{formatMoney(summary.netThisMonth)}</Text>
            <Text style={styles.statLabel}>Bu ay (tahmini)</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>%{summary.rate}</Text>
            <Text style={styles.statLabel}>Komisyon · {summary.range}</Text>
          </View>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Çekilebilir bakiye (tahmini)</Text>
          <Text style={styles.balanceValue}>{formatMoney(summary.withdrawableBalance)}</Text>
          {summary.heldNet > 0 && (
            <Text style={styles.held}>
              Bekleyen: {formatMoney(summary.heldNet)}. Son {PAYOUT_HOLD_DAYS} günün derslerinden gelir, her dersin ücreti dersten{' '}
              {PAYOUT_HOLD_DAYS} gün sonra çekilebilir olur
              {summary.nextReleaseAt
                ? ` (sıradaki: ${summary.nextReleaseAt.getDate()} ${MONTH_NAMES[summary.nextReleaseAt.getMonth()]})`
                : ''}
              .
            </Text>
          )}
          <Text style={styles.hint}>
            Bu rakam, tamamlanan derslerinden şu anki komisyon oranınla hesaplanan bir tahmindir; kesin tutarı ARMUS ekibi talebini
            incelerken doğrular.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Para çekme talebi</Text>
        <Text style={styles.hint}>
          Kazandığın parayı IBAN'ına çekmek için bir talep gönder. ARMUS ekibi talebini inceleyip ödemeyi elden gönderir, bu yüzden
          işlem birkaç gün sürebilir.
        </Text>
        <Text style={styles.label}>Çekmek istediğin tutar (₺)</Text>
        <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.faint} style={styles.input} />
        <Text style={styles.label}>IBAN</Text>
        <TextInput value={iban} onChangeText={setIban} autoCapitalize="characters" placeholder="TR.." placeholderTextColor={colors.faint} style={styles.input} />
        <Text style={styles.label}>Hesap sahibinin adı soyadı</Text>
        <TextInput value={ibanName} onChangeText={setIbanName} placeholder="Ad Soyad" placeholderTextColor={colors.faint} style={styles.input} />
        <Text style={styles.label}>Not (isteğe bağlı)</Text>
        <TextInput value={note} onChangeText={setNote} placeholder="" placeholderTextColor={colors.faint} style={styles.input} />
        {status && <Text style={[styles.status, status.error && { color: colors.error }]}>{status.text}</Text>}
        <View style={{ marginTop: 14 }}>
          <Button label="Talep Gönder" onPress={submit} loading={sending} disabled={summary.withdrawableBalance <= 0} />
        </View>

        <Text style={styles.sectionTitle}>Geçmiş talepler</Text>
        {requests.length === 0 ? (
          <Text style={styles.hint}>Henüz bir para çekme talebin yok.</Text>
        ) : (
          requests.map((r) => (
            <View key={r.id} style={styles.row}>
              <Text style={styles.rowText}>{new Date(r.requested_at).toLocaleDateString('tr-TR')}</Text>
              <Text style={styles.rowStrong}>{formatMoney(r.amount)}</Text>
              <Text style={[styles.badge, r.status === 'paid' && styles.badgePaid, r.status === 'rejected' && styles.badgeRejected]}>
                {STATUS_LABELS[r.status] || r.status}
              </Text>
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>Aylık kazanç</Text>
        {summary.months.length === 0 ? (
          <Text style={styles.hint}>Tamamlanan dersin olduğunda burada aylara göre görünecek.</Text>
        ) : (
          summary.months.map((m) => (
            <View key={m.key} style={styles.row}>
              <Text style={styles.rowText}>{monthLabel(m.key)}</Text>
              <Text style={styles.rowText}>{m.count} ders</Text>
              <Text style={styles.rowStrong}>{formatMoney(m.net)}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
  back: { fontFamily: fonts.bodySemibold, fontSize: 13.5, color: colors.muted },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.ink, letterSpacing: -0.5, marginBottom: 16 },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statCard: {
    flex: 1,
    backgroundColor: colors.panel,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  statValue: { fontFamily: fonts.bodyExtraBold, fontSize: 18, color: colors.ink },
  statLabel: { fontFamily: fonts.body, fontSize: 11, color: colors.muted, marginTop: 3, textAlign: 'center' },
  balanceCard: { backgroundColor: '#fff8e6', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.gold2, padding: 16, gap: 6 },
  balanceLabel: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: colors.muted },
  balanceValue: { fontFamily: fonts.display, fontSize: 28, color: colors.ink },
  held: { fontFamily: fonts.bodySemibold, fontSize: 12.5, lineHeight: 18, color: colors.goldText },
  hint: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.muted },
  sectionTitle: { fontFamily: fonts.bodyExtraBold, fontSize: 16, color: colors.ink, marginTop: 26, marginBottom: 8 },
  label: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: colors.ink, marginTop: 14, marginBottom: 6 },
  input: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: colors.ink,
  },
  status: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: colors.success, marginTop: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    gap: 10,
  },
  rowText: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  rowStrong: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.ink },
  badge: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.goldText,
    backgroundColor: '#fff8e6',
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  badgePaid: { color: colors.success, backgroundColor: '#e9f7ef' },
  badgeRejected: { color: colors.error, backgroundColor: '#fbeceb' },
});
