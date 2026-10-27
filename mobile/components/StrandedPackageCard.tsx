import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatMoney, refundStrandedPackage, transferStrandedPackage, type StrandedPackage } from '../lib/credits';
import { confirmAsync } from '../lib/dialogs';
import { shortDisplayName } from '../lib/displayName';
import { getMarketplaceTeachers } from '../lib/teachers';
import type { Teacher } from '../lib/teachers-data';
import { colors, fonts, radius } from '../lib/theme';
import Button from './Button';

// Package lessons whose teacher can't teach this student anymore (banned,
// blocking them, account closed - migration_110.sql): get them refunded to
// the card, or move them to another teacher (package-credits Edge
// Function). Mirrors my-lessons.html's package notice.
export default function StrandedPackageCard({ pkg, onDone }: { pkg: StrandedPackage; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [teachers, setTeachers] = useState<Teacher[] | null>(null);
  const [chosen, setChosen] = useState<Teacher | null>(null);

  const perLesson = pkg.lessons ? pkg.totalValue / pkg.lessons : 0;

  async function refund() {
    const ok = await confirmAsync(
      'Paramı iade et',
      `${formatMoney(pkg.totalValue)} ödeme yaptığın karta iade edilecek ve bu ${pkg.lessons} ders bakiyenden silinecek. Onaylıyor musun?`,
      'İade Et'
    );
    if (!ok) return;
    setBusy(true);
    setError('');
    const r = await refundStrandedPackage(pkg.teacherId);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setResult(
      `${r.refundedLessons} dersin ücreti (${formatMoney(r.refundedAmount)}) kartına iade edildi. Tutarın hesabına geçmesi bankana göre birkaç iş günü sürebilir.`
    );
    onDone();
  }

  async function openPicker() {
    setPickerOpen(true);
    setChosen(null);
    if (!teachers) {
      const list = await getMarketplaceTeachers();
      // demo teachers can't take a moved package - only real accounts
      setTeachers(list.filter((t) => t.isRegistered && t.id !== pkg.teacherId && Number(t.price) > 0));
    }
  }

  async function transfer() {
    if (!chosen) return;
    setBusy(true);
    setError('');
    const r = await transferStrandedPackage(pkg.teacherId, chosen.id);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setPickerOpen(false);
    setResult(`${r.transferred} dersin ${r.teacherName || shortDisplayName(chosen.name)} ile kullanılabilir. Rezervasyonu öğretmenin profilinden yapabilirsin.`);
    onDone();
  }

  function hintFor(t: Teacher) {
    const diff = Math.round((Number(t.price) - perLesson) * 100) / 100;
    if (diff >= 1) {
      return `Her dersin ${formatMoney(perLesson)} değerinde, bu öğretmenin ders ücreti ${formatMoney(t.price)}. Her derste aradaki ${formatMoney(diff)} farkı kartla ödersin.`;
    }
    if (diff <= -1) {
      return `Her dersin ${formatMoney(perLesson)} değerinde, bu öğretmenin ders ücreti ${formatMoney(t.price)}. Her ders tamamen karşılanır; aradaki ${formatMoney(-diff)} iade edilmez.`;
    }
    return 'Her dersin bu öğretmenle tamamen karşılanır.';
  }

  if (result) {
    return (
      <View style={styles.card}>
        <Text style={styles.result}>{result}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{shortDisplayName(pkg.teacherName)} artık sana ders veremiyor</Text>
      <Text style={styles.text}>
        Paketinden {pkg.lessons} ders kaldı ({formatMoney(pkg.totalValue)}). Bu dersleri kartına iade ettirebilir ya da başka bir
        öğretmene aktarabilirsin.
      </Text>
      <View style={styles.actions}>
        {pkg.refundable && (
          <Pressable onPress={refund} disabled={busy} style={[styles.btn, styles.btnPrimary, busy && styles.disabled]}>
            <Text style={[styles.btnText, styles.btnTextPrimary]}>Paramı İade Et ({formatMoney(pkg.totalValue)})</Text>
          </Pressable>
        )}
        <Pressable onPress={openPicker} disabled={busy} style={[styles.btn, busy && styles.disabled]}>
          <Text style={styles.btnText}>Başka Öğretmene Aktar</Text>
        </Pressable>
      </View>
      {!pkg.refundable && (
        <Text style={styles.text}>Bu paketin iadesi otomatik yapılamıyor - iade istersen destek ekibimize yaz.</Text>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Paketini hangi öğretmenle kullanmak istersin?</Text>
            <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: 8 }}>
              {teachers === null ? (
                <Text style={styles.text}>Yükleniyor…</Text>
              ) : teachers.length === 0 ? (
                <Text style={styles.text}>Şu anda listelenecek öğretmen yok.</Text>
              ) : (
                teachers.map((t) => (
                  <Pressable key={t.id} onPress={() => setChosen(t)} style={[styles.teacherRow, chosen?.id === t.id && styles.teacherRowSelected]}>
                    <Text style={styles.teacherName}>{shortDisplayName(t.name)}</Text>
                    <Text style={styles.teacherPrice}>{formatMoney(t.price)}</Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
            {chosen && <Text style={[styles.text, { marginTop: 12 }]}>{hintFor(chosen)}</Text>}
            {!!error && <Text style={styles.error}>{error}</Text>}
            <View style={styles.sheetActions}>
              <View style={{ flex: 1 }}>
                <Button label="Vazgeç" variant="outline" onPress={() => setPickerOpen(false)} />
              </View>
              <View style={{ flex: 1.3 }}>
                <Button label="Paketi Aktar" disabled={!chosen} loading={busy} onPress={transfer} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel2,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.gold2,
    padding: 16,
    marginBottom: 12,
  },
  title: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 14.5,
    color: colors.ink,
    marginBottom: 6,
  },
  text: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.muted,
  },
  result: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13,
    lineHeight: 19,
    color: colors.goldText,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 12,
  },
  btn: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: colors.bg,
  },
  btnPrimary: {
    borderColor: colors.gold3,
    backgroundColor: colors.gold3,
  },
  btnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.ink,
  },
  btnTextPrimary: {
    color: colors.onGold,
  },
  disabled: {
    opacity: 0.5,
  },
  error: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12.5,
    color: colors.error,
    marginTop: 8,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: 20,
    paddingBottom: 28,
  },
  sheetTitle: {
    fontFamily: fonts.display,
    fontSize: 17,
    color: colors.ink,
    marginBottom: 14,
  },
  teacherRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  teacherRowSelected: {
    borderColor: colors.gold3,
    backgroundColor: '#fff8e6',
  },
  teacherName: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
  },
  teacherPrice: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13,
    color: colors.muted,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
});
