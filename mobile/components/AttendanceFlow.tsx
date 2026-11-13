import { Ionicons } from '@expo/vector-icons';
import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  LATE_WARNING_MINUTES,
  TECH_REFUND_MINUTES,
  reportAttendanceIssue,
  type AttendanceReport,
  type AttendanceType,
} from '../lib/attendance';
import { colors, fonts, radius } from '../lib/theme';
import Button from './Button';
import { useT } from '../lib/i18n';

type Step =
  | { kind: 'main' }
  | { kind: 'late' }
  | { kind: 'lateChoice'; minutes: number }
  | { kind: 'noShow' }
  | { kind: 'technical' }
  | { kind: 'techMinutes'; side: 'teacher' | 'student' }
  | { kind: 'sending' }
  | { kind: 'failed'; retry: () => void };

type Fields = {
  type: AttendanceType;
  lateMinutes?: number;
  note?: string;
  techSide?: 'teacher' | 'student';
  minutesHeld?: number;
};

type Props = {
  booking: { id: string; teacherId: string };
  studentId: string;
  /** a "didn't show up" report opens 10 minutes after the start */
  noShowReady?: boolean;
  /** also offer "yes, it happened" */
  askHappened?: boolean;
  onHappened?: () => void;
  onFiled: (report: AttendanceReport, message: string) => void;
  onCancel?: () => void;
};

/**
 * The website's shared "what went wrong with this lesson" flow
 * (attendance.js armusRenderAttendanceFlow), step for step: late (how
 * many minutes - up to 15 is a warning, more and the student picks
 * "held" or "not held"), the teacher never came, or a technical problem
 * (whose side, how many minutes were held - under 25 on the teacher's
 * side gives the lesson back).
 */
export default function AttendanceFlow({ booking, studentId, noShowReady = true, askHappened, onHappened, onFiled, onCancel }: Props) {
  const t = useT();
  const [step, setStep] = useState<Step>({ kind: 'main' });
  const [minutesText, setMinutesText] = useState('');
  const [inputError, setInputError] = useState(false);

  function go(next: Step) {
    setMinutesText('');
    setInputError(false);
    setStep(next);
  }

  function readMinutes(min: number, max: number): number | null {
    const raw = minutesText.trim();
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  async function submit(fields: Fields, message: string) {
    setStep({ kind: 'sending' });
    const report = await reportAttendanceIssue({ bookingId: booking.id, teacherId: booking.teacherId, studentId, ...fields });
    if (!report) {
      setStep({ kind: 'failed', retry: () => submit(fields, message) });
      return;
    }
    onFiled(report, message);
  }

  const back = <Button label={t("← Geri")} variant="outline" onPress={() => go({ kind: 'main' })} />;

  if (step.kind === 'sending') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.red} />
        <Text style={styles.text}>{t("Gönderiliyor...")}</Text>
      </View>
    );
  }

  if (step.kind === 'failed') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.text}>
          {t("Bildirim gönderilemedi. Ders bitiminden sonraki 24 saat içinde ve sadece bir kez bildirim yapılabilir - lütfen tekrar dene.")}</Text>
        <View style={styles.actions}>
          <View style={styles.flex}>{back}</View>
          <View style={styles.flex}>
            <Button label={t("Tekrar dene")} onPress={step.retry} />
          </View>
        </View>
      </View>
    );
  }

  if (step.kind === 'late') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.text}>{t("Öğretmen kaç dakika geç geldi?")}</Text>
        <MinutesInput value={minutesText} onChange={setMinutesText} placeholder={t("Örn. 10")} error={inputError} />
        <View style={styles.actions}>
          <View style={styles.flex}>{back}</View>
          <View style={styles.flex}>
            <Button
              label={t("Devam Et")}
              onPress={() => {
                const minutes = readMinutes(1, 50);
                if (!minutes) {
                  setInputError(true);
                  return;
                }
                if (minutes <= LATE_WARNING_MINUTES) {
                  submit(
                    { type: 'late', lateMinutes: minutes },
                    t("Bildirimin alındı. 15 dakikaya kadar gecikmeler öğretmene uyarı olarak iletilir.")
                  );
                } else {
                  go({ kind: 'lateChoice', minutes });
                }
              }}
            />
          </View>
        </View>
      </View>
    );
  }

  if (step.kind === 'lateChoice') {
    const minutes = step.minutes;
    return (
      <View style={styles.wrap}>
        <Text style={styles.text}>
          {t("Öğretmen {0} dakika geç geldi. 15 dakikadan uzun gecikmelerde ne olacağına sen karar verirsin:", minutes)}</Text>
        <Choice
          label={t("Ders kalan sürede yapıldı")}
          onPress={() => submit({ type: 'late', lateMinutes: minutes }, t("Bildirimin alındı ve öğretmene uyarı olarak iletildi."))}
        />
        <Choice
          label={t("Ders yapılmamış sayılsın (ders hakkım iade edilsin)")}
          onPress={() =>
            submit(
              {
                type: 'no_show',
                lateMinutes: minutes,
                note: `Öğretmen ${minutes} dakika geç geldi; öğrenci dersin yapılmamış sayılmasını seçti.`,
              },
              t("Bildirimin alındı. Ekibimiz ders kayıtlarını inceleyecek; doğrulanırsa ders hakkın iade edilir.")
            )
          }
        />
        <View style={styles.actions}>
          <View style={styles.flex}>{back}</View>
        </View>
      </View>
    );
  }

  if (step.kind === 'noShow') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.text}>
          {t("Öğretmen derse hiç girmedi mi? Ekibimiz ders kayıtlarına (kimin derse ne zaman girdiğine) bakarak inceleyecek; doğrulanırsa ders hakkın iade edilir. Asılsız bildirimler uyarı alır, 3 asılsız bildirimde hesap kapatılır.")}</Text>
        <View style={styles.actions}>
          <View style={styles.flex}>{back}</View>
          <View style={styles.flex}>
            <Button
              label={t("Öğretmen Gelmedi")}
              onPress={() =>
                submit({ type: 'no_show' }, t("Bildirimin alındı. Ekibimiz ders kayıtlarını inceleyecek; doğrulanırsa ders hakkın iade edilir."))
              }
            />
          </View>
        </View>
      </View>
    );
  }

  if (step.kind === 'technical') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.text}>{t("Sorun kimin tarafındaydı?")}</Text>
        <Choice
          label={t("Öğretmenin tarafında (bağlantısı koptu, sesi ya da görüntüsü gelmedi)")}
          onPress={() => go({ kind: 'techMinutes', side: 'teacher' })}
        />
        <Choice label={t("Benim tarafımda")} onPress={() => go({ kind: 'techMinutes', side: 'student' })} />
        <View style={styles.actions}>
          <View style={styles.flex}>{back}</View>
        </View>
      </View>
    );
  }

  if (step.kind === 'techMinutes') {
    const side = step.side;
    return (
      <View style={styles.wrap}>
        <Text style={styles.text}>{t("Ders kaç dakika yapılabildi?")}</Text>
        <MinutesInput value={minutesText} onChange={setMinutesText} placeholder={t("Örn. 20")} error={inputError} />
        <Text style={styles.rule}>
          {side === 'teacher'
            ? t("Öğretmen tarafındaki bir sorun yüzünden ders 25 dakikadan az yapılabildiyse, inceleme sonunda ders hakkın iade edilir.")
            : t("Senin tarafındaki teknik sorunlarda ders iadesi yapılmaz, ama bildirimin kayda geçer.")}
        </Text>
        <View style={styles.actions}>
          <View style={styles.flex}>{back}</View>
          <View style={styles.flex}>
            <Button
              label={t("Gönder")}
              onPress={() => {
                const minutes = readMinutes(0, 50);
                if (minutes === null) {
                  setInputError(true);
                  return;
                }
                const message =
                  side === 'student'
                    ? t("Bildirimin kayda geçti. Senin tarafındaki teknik sorunlarda ders iadesi yapılmaz.")
                    : minutes < TECH_REFUND_MINUTES
                      ? t("Bildirimin alındı. İnceleme sonunda doğrulanırsa ders hakkın iade edilir.")
                      : t("Bildirimin alındı. Ders 25 dakika ya da daha uzun yapılabildiği için iade yapılmaz.");
                submit({ type: 'technical', techSide: side, minutesHeld: minutes }, message);
              }}
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {askHappened && <Choice icon="checkmark-circle-outline" label={t("Evet, ders yapıldı")} onPress={() => onHappened?.()} strong />}
      <Choice icon="time-outline" label={t("Öğretmen geç geldi")} onPress={() => go({ kind: 'late' })} />
      <Choice icon="warning-outline" label={t("Öğretmen derse gelmedi")} onPress={() => go({ kind: 'noShow' })} disabled={!noShowReady} />
      <Choice icon="wifi-outline" label={t("Teknik bir sorun yaşandı")} onPress={() => go({ kind: 'technical' })} />
      {!noShowReady && <Text style={styles.rule}>{t("Öğretmen hâlâ gelmediyse birkaç dakika sonra tekrar dene.")}</Text>}
      {onCancel && (
        <View style={styles.actions}>
          <View style={styles.flex}>
            <Button label={t("İptal")} variant="outline" onPress={onCancel} />
          </View>
        </View>
      )}
    </View>
  );
}

function Choice({
  label,
  onPress,
  icon,
  disabled,
  strong,
}: {
  label: string;
  onPress: () => void;
  icon?: ComponentProps<typeof Ionicons>['name'];
  disabled?: boolean;
  strong?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.choice, strong && styles.choiceStrong, { opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }]}
    >
      {icon && <Ionicons name={icon} size={19} color={strong ? colors.onRed : colors.red} />}
      <Text style={[styles.choiceText, strong && styles.choiceTextStrong]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={strong ? colors.onRed : colors.faint} />
    </Pressable>
  );
}

function MinutesInput({ value, onChange, placeholder, error }: { value: string; onChange: (t: string) => void; placeholder: string; error: boolean }) {
  const t = useT();
  return (
    <View style={[styles.inputRow, error && { borderColor: colors.error }]}>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 2))}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        keyboardType="number-pad"
        style={styles.input}
        maxLength={2}
        autoFocus
      />
      <Text style={styles.unit}>{t("dakika")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: 10 },
  center: { alignItems: 'center', gap: 10, paddingVertical: 16 },
  flex: { flex: 1 },
  text: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, color: colors.ink },
  rule: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.muted },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  choiceStrong: { backgroundColor: colors.red, borderColor: colors.red },
  choiceText: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 14, lineHeight: 19, color: colors.ink },
  choiceTextStrong: { color: colors.onRed },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    paddingHorizontal: 14,
  },
  input: { flex: 1, minWidth: 0, width: '100%', fontFamily: fonts.displayBold, fontSize: 20, color: colors.ink },
  unit: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.muted },
});
