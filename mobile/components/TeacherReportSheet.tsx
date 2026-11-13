import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { TEACHER_REPORT_REASONS, reportTeacher } from '../lib/attendance';
import { colors, fonts, radius } from '../lib/theme';
import Button from './Button';

type Props = {
  visible: boolean;
  teacherId: string;
  teacherName: string;
  reporterId: string;
  bookingId?: string;
  onClose: () => void;
};

/**
 * "Öğretmeni şikayet et" - the website's report modal (attendance.js
 * armusOpenTeacherReportModal): a reason, an optional note, and it goes
 * only to the ARMUS team. teacher_reports' insert policy is the real
 * check (a lesson or a conversation with the teacher, one open report
 * per teacher).
 */
export default function TeacherReportSheet({ visible, teacherId, teacherName, reporterId, bookingId, onClose }: Props) {
  const [reason, setReason] = useState(TEACHER_REPORT_REASONS[0].value);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setReason(TEACHER_REPORT_REASONS[0].value);
    setNote('');
    setError('');
    setSent(false);
  }, [visible]);

  async function send() {
    setSending(true);
    setError('');
    const result = await reportTeacher({ teacherId, reporterId, bookingId, reason, note: note.trim() });
    setSending(false);
    if (result === true) {
      setSent(true);
      return;
    }
    setError(
      result === 'duplicate'
        ? 'Bu öğretmen hakkında incelenmeyi bekleyen bir şikayetin zaten var.'
        : 'Şikayet gönderilemedi. Bu öğretmenle bir dersin ya da yazışman olmalı.'
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.shade} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <View style={styles.grab} />
          {sent ? (
            <>
              <View style={styles.sentIcon}>
                <Ionicons name="checkmark" size={26} color={colors.onRed} />
              </View>
              <Text style={styles.title}>Şikayetin alındı</Text>
              <Text style={styles.text}>
                Ekibimiz inceleyecek ve gerekirse seninle iletişime geçecek. Acil bir durum varsa destek ekibimize de yazabilirsin.
              </Text>
              <View style={{ marginTop: 16 }}>
                <Button label="Kapat" onPress={onClose} />
              </View>
            </>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.title}>{teacherName} hakkında şikayet</Text>
              <Text style={styles.text}>Şikayetin sadece ARMUS ekibine gider, öğretmen kimin bildirdiğini görmez.</Text>

              <Text style={styles.label}>Sebep</Text>
              <View style={{ gap: 8 }}>
                {TEACHER_REPORT_REASONS.map((r) => {
                  const on = r.value === reason;
                  return (
                    <Pressable key={r.value} onPress={() => setReason(r.value)} style={[styles.reason, on && styles.reasonOn]}>
                      <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.radioDot} />}</View>
                      <Text style={[styles.reasonText, on && { color: colors.red }]}>{r.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.label}>Ne oldu? (isteğe bağlı)</Text>
              <TextInput
                value={note}
                onChangeText={(t) => setNote(t.slice(0, 2000))}
                multiline
                style={styles.note}
                placeholderTextColor={colors.faint}
                maxLength={2000}
              />
              {!!error && <Text style={styles.error}>{error}</Text>}

              <View style={styles.actions}>
                <View style={{ flex: 1 }}>
                  <Button label="İptal" variant="outline" onPress={onClose} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="Şikayeti Gönder" onPress={send} loading={sending} />
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  sentIcon: {
    alignSelf: 'center',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink, letterSpacing: -0.3 },
  text: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 20, color: colors.muted, marginTop: 6 },
  label: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.ink, marginTop: 18, marginBottom: 8 },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  reasonOn: { borderColor: colors.red, backgroundColor: colors.redSoft },
  reasonText: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.ink },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.red },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.red },
  note: {
    minHeight: 90,
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
  error: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18, color: colors.error, marginTop: 10 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
});
