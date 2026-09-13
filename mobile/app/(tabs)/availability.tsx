import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { allTimeSlots, formatTimeRange } from '../../lib/bookings';
import { useAuth } from '../../lib/auth';
import { updateOwnProfile } from '../../lib/profile';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius } from '../../lib/theme';

// [label, JS getDay() index] - Monday-first for display, but keyed by the
// real day-of-week index everywhere else (booking.html, marketplace.js).
const DAY_COLUMNS: [string, number][] = [
  ['Pzt', 1],
  ['Sal', 2],
  ['Çar', 3],
  ['Per', 4],
  ['Cum', 5],
  ['Cmt', 6],
  ['Paz', 0],
];

const ALL_SLOTS = allTimeSlots();

export default function Availability() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [activeDay, setActiveDay] = useState(1);
  const [weekSlots, setWeekSlots] = useState<Record<number, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useFocusEffect(
    useCallback(() => {
      if (!profile) return;
      let active = true;
      setLoading(true);
      supabase
        .from('profiles')
        .select('availability_dates')
        .eq('id', profile.id)
        .single()
        .then(({ data }) => {
          if (!active) return;
          const raw = (data?.availability_dates as Record<string, string[]> | null) || {};
          const next: Record<number, string[]> = {};
          DAY_COLUMNS.forEach(([, dayIdx]) => {
            next[dayIdx] = Array.isArray(raw[String(dayIdx)]) ? raw[String(dayIdx)] : [];
          });
          setWeekSlots(next);
          setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [profile])
  );

  function toggleSlot(time: string) {
    setStatus('');
    setWeekSlots((prev) => {
      const current = prev[activeDay] || [];
      const next = current.includes(time) ? current.filter((t) => t !== time) : [...current, time].sort();
      return { ...prev, [activeDay]: next };
    });
  }

  async function handleSave() {
    setSaving(true);
    const cleaned: Record<string, string[]> = {};
    DAY_COLUMNS.forEach(([, dayIdx]) => {
      const slots = weekSlots[dayIdx] || [];
      if (slots.length) cleaned[String(dayIdx)] = slots;
    });

    const ok = await updateOwnProfile({ availability_dates: cleaned });
    setSaving(false);
    setStatus(ok ? 'Kaydedildi ✓' : 'Kaydedilemedi ✕');
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.gold3} />
      </SafeAreaView>
    );
  }

  const activeSlots = weekSlots[activeDay] || [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.headerBlock}>
        <Text style={styles.title}>Programım</Text>
        <Text style={styles.subtitle}>Öğrencilerin rezervasyon yapabileceği saatleri seç.</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
        {DAY_COLUMNS.map(([label, dayIdx]) => {
          const count = (weekSlots[dayIdx] || []).length;
          return (
            <Pressable
              key={dayIdx}
              onPress={() => setActiveDay(dayIdx)}
              style={[styles.dayPill, activeDay === dayIdx && styles.dayPillActive]}
            >
              <Text style={[styles.dayLabel, activeDay === dayIdx && styles.dayLabelActive]}>{label}</Text>
              <Text style={[styles.dayCount, activeDay === dayIdx && styles.dayLabelActive]}>{count}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.slotContent} showsVerticalScrollIndicator={false}>
        <View style={styles.slotGrid}>
          {ALL_SLOTS.map((time) => {
            const selected = activeSlots.includes(time);
            return (
              <Pressable
                key={time}
                onPress={() => toggleSlot(time)}
                style={[styles.slot, selected && styles.slotSelected]}
              >
                <Text style={[styles.slotText, selected && styles.slotTextSelected]}>{formatTimeRange(time)}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {!!status && <Text style={styles.status}>{status}</Text>}
        <Pressable onPress={handleSave} disabled={saving} style={[styles.saveBtn, saving && styles.saveBtnDisabled]}>
          <Text style={styles.saveBtnText}>{saving ? 'Kaydediliyor…' : 'Kaydet'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBlock: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.ink,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
  },
  dayRow: {
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  dayPill: {
    width: 52,
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dayPillActive: {
    borderColor: colors.gold3,
    backgroundColor: colors.gold3,
  },
  dayLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: colors.ink,
  },
  dayCount: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10.5,
    color: colors.muted,
  },
  dayLabelActive: {
    color: colors.onGold,
  },
  slotContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  slotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  slot: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  slotSelected: {
    borderColor: colors.gold3,
    backgroundColor: colors.gold3,
  },
  slotText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 12.5,
    color: colors.ink,
  },
  slotTextSelected: {
    color: colors.onGold,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    backgroundColor: colors.panel,
  },
  status: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12.5,
    color: colors.muted,
  },
  saveBtn: {
    backgroundColor: colors.gold3,
    borderRadius: radius.md,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.onGold,
  },
});
