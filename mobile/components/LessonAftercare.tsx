import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { REPORT_WINDOW_HOURS, type AttendanceReport } from '../lib/attendance';
import { lessonWindow, type Booking } from '../lib/bookings';
import { notify } from '../lib/dialogs';
import { shortDisplayName } from '../lib/displayName';
import { addReview, type Review } from '../lib/reviews';
import { colors, fonts, radius } from '../lib/theme';
import AttendanceFlow from './AttendanceFlow';
import { tr, useT } from '../lib/i18n';

// What a finished lesson's card carries on the website (my-lessons.html):
// the "did this lesson happen?" check-in for 24 hours after it ends, the
// student's report and its status once one is filed, and the star rating.

export const CHECKIN_OK_KEY = (id: string) => `armus_checkin_ok_${id}`;

/** from the end of the lesson until 24 hours after, unless the student already said yes */
export function checkinOpen(booking: Booking, saidYes: boolean) {
  const end = lessonWindow(booking).end.getTime();
  const now = Date.now();
  if (now < end || now > end + REPORT_WINDOW_HOURS * 3_600_000) return false;
  return !saidYes;
}

const TYPE_LABEL = (r: AttendanceReport) =>
  r.type === 'no_show'
    ? tr("Öğretmen gelmedi")
    : r.type === 'late'
      ? tr("Öğretmen geç geldi{0}", r.lateMinutes ? tr(" ({0} dk)", r.lateMinutes) : '')
      : r.type === 'technical'
        ? tr("Teknik sorun")
        : r.type;

const STATUS_LABEL = (r: AttendanceReport) => (r.status === 'upheld' ? tr("Doğrulandı") : r.status === 'dismissed' ? tr("Reddedildi") : tr("İnceleniyor"));

export function ReportStatus({ report, message }: { report: AttendanceReport; message?: string }) {
  const t = useT();
  return (
    <View style={styles.statusBox}>
      <Text style={styles.statusText}>
        {t("Bildirimin: ")}<Text style={styles.strong}>{TYPE_LABEL(report)}</Text> · {STATUS_LABEL(report)}
      </Text>
      {!!message && <Text style={styles.statusNote}>{message}</Text>}
    </View>
  );
}

export function CheckinBox({
  booking,
  studentId,
  onSaidYes,
  onFiled,
}: {
  booking: Booking;
  studentId: string;
  onSaidYes: () => void;
  onFiled: (report: AttendanceReport, message: string) => void;
}) {
  const t = useT();
  return (
    <View style={styles.checkin}>
      <Text style={styles.checkinTitle}>{t("Bu ders gerçekleşti mi?")}</Text>
      <Text style={styles.checkinText}>
        {t("Bir sorun olduysa dersten sonraki 24 saat içinde bildirebilirsin. Bildirim gelmezse ders yapılmış sayılır ve ücreti öğretmene ödenir.")}</Text>
      <AttendanceFlow
        booking={booking}
        studentId={studentId}
        askHappened
        onHappened={() => {
          AsyncStorage.setItem(CHECKIN_OK_KEY(booking.id), '1').catch(() => {});
          onSaidYes();
        }}
        onFiled={onFiled}
      />
    </View>
  );
}

export function ReviewBlock({
  booking,
  student,
  review,
  onSaved,
}: {
  booking: Booking;
  student: { id: string; name: string };
  review?: Review;
  onSaved: (r: Review) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  if (review) {
    return (
      <View style={styles.reviewDone}>
        <Text style={styles.reviewStars}>
          {'★'.repeat(review.stars)}
          <Text style={{ color: colors.border }}>{'★'.repeat(5 - review.stars)}</Text>
          <Text style={styles.reviewDoneLabel}> {t(" Değerlendirdin")}</Text>
        </Text>
        {!!review.text && <Text style={styles.reviewText}>{review.text}</Text>}
      </View>
    );
  }

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} style={styles.reviewPrompt}>
        <Text style={styles.reviewPromptText}>{t("★ Bu dersi değerlendir")}</Text>
      </Pressable>
    );
  }

  async function submit() {
    if (saving) return;
    if (stars === 0) {
      notify(t("Puan seç"), t("Lütfen bir puan seç."));
      return;
    }
    setSaving(true);
    const saved = await addReview({
      bookingId: booking.id,
      teacherId: booking.teacherId,
      studentId: student.id,
      studentName: student.name,
      stars,
      text: text.trim(),
    });
    setSaving(false);
    if (!saved) {
      notify(t("Kaydedilemedi"), t("Değerlendirme kaydedilemedi."));
      return;
    }
    onSaved(saved);
  }

  return (
    <View style={styles.reviewForm}>
      <View style={styles.starRow} accessibilityRole="radiogroup" accessibilityLabel={t("Puan ver")}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setStars(n)} hitSlop={4} accessibilityRole="radio" accessibilityLabel={t("{0} yıldız", n)} accessibilityState={{ checked: stars === n }}>
            <Text style={[styles.star, n <= stars && styles.starOn]}>★</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={t("{0} ile dersin nasıldı?", shortDisplayName(booking.teacherName))}
        placeholderTextColor={colors.faint}
        multiline
        style={styles.reviewInput}
      />
      <Pressable onPress={submit} disabled={saving} style={[styles.reviewSend, saving && { opacity: 0.6 }]}>
        <Text style={styles.reviewSendText}>{saving ? t("Gönderiliyor…") : t("Gönder")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  strong: { fontFamily: fonts.bodyBold, color: colors.ink },
  statusBox: { marginTop: 12, padding: 12, borderRadius: radius.sm, backgroundColor: colors.panel2, gap: 4 },
  statusText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.muted },
  statusNote: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.muted },
  checkin: { marginTop: 12, padding: 14, borderRadius: radius.md, backgroundColor: colors.wash, borderWidth: 1, borderColor: colors.champagneDeep, gap: 8 },
  checkinTitle: { fontFamily: fonts.bodyExtraBold, fontSize: 14.5, color: colors.ink },
  checkinText: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.muted, marginBottom: 4 },
  reviewDone: { marginTop: 12, gap: 4 },
  reviewStars: { fontSize: 15, color: colors.red, letterSpacing: 1 },
  reviewDoneLabel: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: colors.muted, letterSpacing: 0 },
  reviewText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.ink },
  reviewPrompt: { marginTop: 12, alignSelf: 'flex-start' },
  reviewPromptText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.red },
  reviewForm: { marginTop: 12, gap: 10 },
  starRow: { flexDirection: 'row', gap: 6 },
  star: { fontSize: 28, color: colors.border },
  starOn: { color: colors.red },
  reviewInput: {
    minHeight: 72,
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
  reviewSend: { alignSelf: 'flex-start', backgroundColor: colors.red, borderRadius: radius.sm, paddingHorizontal: 18, paddingVertical: 10 },
  reviewSendText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.onRed },
});
