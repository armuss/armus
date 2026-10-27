import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  ANY_TIME_AVAILABILITY,
  DAY_NAMES,
  formatLessonWhenForViewer,
  localDateKey,
  slotsForDate,
  todayIn,
  zonedTimeToUtc,
  type BusyTime,
} from '../lib/bookings';
import { colors, fonts, radius } from '../lib/theme';
import Button from './Button';

const DAYS_SHOWN = 14;

type AvailabilitySource = {
  id: string;
  weeklyAvailability?: string[][] | null;
  availabilityDates?: Record<string, string[] | boolean> | null;
};

// The "pick a new time" sheet for moving a lesson (reschedule-booking,
// migration_107.sql). Mirrors reschedule.js's armusOpenReschedulePicker:
//   - teacher: whose open hours to offer, or null for "any free time"
//     (a teacher proposing a time of their own)
//   - timeZone: the lesson's (teacher's) timezone - dates/times are
//     wall-clock in it, shown in the viewer's own time
//   - busyTimes: already taken; current: the lesson's own slot (never
//     offered, and not blocking its neighbours)
export default function ReschedulePicker({
  visible,
  teacher,
  timeZone,
  busyTimes,
  current,
  title,
  note,
  confirmLabel,
  submitting,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  teacher: AvailabilitySource | null;
  timeZone: string;
  busyTimes: BusyTime[];
  current: { date: string; time: string };
  title: string;
  note: string;
  confirmLabel: string;
  submitting?: boolean;
  onClose: () => void;
  onConfirm: (pick: { date: string; time: string }) => void;
}) {
  const dates = useMemo(() => {
    const today = todayIn(timeZone);
    return Array.from({ length: DAYS_SHOWN }, (_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      return { key: localDateKey(date), day: date.getDay(), num: date.getDate() };
    });
    // re-read on every opening, so "today" is never stale
  }, [timeZone, visible]);

  const [dateKey, setDateKey] = useState(dates[0].key);
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setDateKey(dates[0].key);
      setTime(null);
    }
  }, [visible, dates]);

  const source = teacher || { id: 'any', availabilityDates: ANY_TIME_AVAILABILITY };
  // the lesson's own slot is about to move - it must not block the slots
  // right next to it
  const busy = busyTimes.filter((b) => !(b.date === current.date && b.time === current.time));
  const selectedDay = dates.find((d) => d.key === dateKey) || dates[0];
  const now = Date.now();
  const open = slotsForDate(source, selectedDay.key, selectedDay.day, busy).filter(
    (s) =>
      s.available &&
      !(selectedDay.key === current.date && s.time === current.time) &&
      zonedTimeToUtc(selectedDay.key, s.time, timeZone).getTime() > now
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.note}>{note}</Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateRow}>
            {dates.map((d) => (
              <Pressable
                key={d.key}
                onPress={() => {
                  setDateKey(d.key);
                  setTime(null);
                }}
                style={[styles.datePill, d.key === selectedDay.key && styles.selected]}
              >
                <Text style={[styles.dayName, d.key === selectedDay.key && styles.selectedText]}>{DAY_NAMES[d.day]}</Text>
                <Text style={[styles.dayNum, d.key === selectedDay.key && styles.selectedText]}>{d.num}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <ScrollView style={styles.slotScroll} contentContainerStyle={styles.slotGrid}>
            {open.length === 0 ? (
              <Text style={styles.empty}>Bu tarihte boş saat yok, başka bir gün dene.</Text>
            ) : (
              open.map((s) => (
                <Pressable key={s.time} onPress={() => setTime(s.time)} style={[styles.slot, time === s.time && styles.selected]}>
                  <Text style={[styles.slotText, time === s.time && styles.selectedText]}>
                    {formatLessonWhenForViewer({ date: selectedDay.key, time: s.time, teacherTimezone: timeZone }).timeRange}
                  </Text>
                </Pressable>
              ))
            )}
          </ScrollView>

          <View style={styles.actions}>
            <View style={{ flex: 1 }}>
              <Button label="Vazgeç" variant="outline" onPress={onClose} />
            </View>
            <View style={{ flex: 1.4 }}>
              <Button
                label={confirmLabel}
                disabled={!time}
                loading={submitting}
                onPress={() => time && onConfirm({ date: selectedDay.key, time })}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 28,
    maxHeight: '88%',
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 19,
    color: colors.ink,
    marginBottom: 6,
  },
  note: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
    marginBottom: 14,
  },
  dateRow: {
    gap: 8,
    paddingBottom: 14,
  },
  datePill: {
    width: 52,
    height: 60,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  dayName: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.muted,
  },
  dayNum: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 15,
    color: colors.ink,
  },
  selected: {
    borderColor: colors.gold3,
    backgroundColor: colors.gold3,
  },
  selectedText: {
    color: colors.onGold,
  },
  slotScroll: {
    maxHeight: 280,
  },
  slotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 6,
  },
  slot: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  slotText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13,
    color: colors.ink,
  },
  empty: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    paddingVertical: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
});
