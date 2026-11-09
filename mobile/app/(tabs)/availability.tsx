import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { allTimeSlots } from '../../lib/bookings';
import { useAuth } from '../../lib/auth';
import { confirmAsync } from '../../lib/dialogs';
import { updateOwnProfile } from '../../lib/profile';
import { supabase } from '../../lib/supabase';
import { colors, fonts } from '../../lib/theme';

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
const WEEKDAYS = [1, 2, 3, 4, 5];

export default function Availability() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
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
          setDirty(false);
          setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [profile])
  );

  function edit(updater: (prev: Record<number, string[]>) => Record<number, string[]>) {
    setStatus('');
    setDirty(true);
    setWeekSlots(updater);
  }

  function toggleSlot(day: number, time: string) {
    edit((prev) => {
      const current = prev[day] || [];
      const next = current.includes(time) ? current.filter((t) => t !== time) : [...current, time].sort();
      return { ...prev, [day]: next };
    });
  }

  // a preset adds its hours to the days it covers (nothing is removed)
  function applyPreset(days: number[], from: string, lastStart: string) {
    const add = ALL_SLOTS.filter((t) => t >= from && t <= lastStart);
    edit((prev) => {
      const next = { ...prev };
      days.forEach((d) => {
        next[d] = Array.from(new Set([...(prev[d] || []), ...add])).sort();
      });
      return next;
    });
  }

  async function clearAll() {
    if (!(await confirmAsync('Programı temizle', 'Bütün günlerdeki saatler kaldırılsın mı? Kaydetmeden önce geri alabilirsin.', 'Temizle', true))) return;
    edit(() => Object.fromEntries(DAY_COLUMNS.map(([, d]) => [d, []])));
  }

  async function handleSave() {
    setSaving(true);
    // _set:true marks this as a real, deliberate save - without it, a
    // teacher who manages their schedule only from the app would have it
    // silently ignored everywhere availability is read (both here and on
    // the web app), which checks this same sentinel rather than just
    // "does the object have any keys" (availability_dates defaults to
    // '{}' for every profile, so an empty save and "never touched" are
    // otherwise indistinguishable - see bookings.js's armusSlotsForDate
    // for the full history of that bug). Mirrors dashboard.html's save
    // handler exactly.
    const cleaned: Record<string, string[] | boolean> = { _set: true };
    DAY_COLUMNS.forEach(([, dayIdx]) => {
      const slots = weekSlots[dayIdx] || [];
      if (slots.length) cleaned[String(dayIdx)] = slots;
    });

    const ok = await updateOwnProfile({ availability_dates: cleaned });
    setSaving(false);
    if (ok) setDirty(false);
    setStatus(ok ? 'Kaydedildi' : 'Kaydedilemedi, tekrar dene');
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.ink} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Programım</Text>
        <Text style={styles.subtitle}>Öğrenciler sadece buradaki saatlerde ders alabilir. Program her hafta tekrarlanır.</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presets} contentContainerStyle={styles.presetsInner}>
          <Pressable onPress={() => applyPreset(WEEKDAYS, '19:00', '21:00')} style={styles.preset}>
            <Text style={styles.presetText}>+ Akşamlar 19–22</Text>
          </Pressable>
          <Pressable onPress={() => applyPreset(WEEKDAYS, '09:00', '11:00')} style={styles.preset}>
            <Text style={styles.presetText}>+ Hafta içi 9–12</Text>
          </Pressable>
          <Pressable onPress={() => applyPreset([6, 0], '10:00', '17:00')} style={styles.preset}>
            <Text style={styles.presetText}>+ Hafta sonu 10–18</Text>
          </Pressable>
          <Pressable onPress={clearAll} style={[styles.preset, styles.presetClear]}>
            <Text style={[styles.presetText, { color: colors.error }]}>Temizle</Text>
          </Pressable>
        </ScrollView>

        <View style={styles.table}>
          {DAY_COLUMNS.map(([label, dayIdx], i) => {
            const slots = weekSlots[dayIdx] || [];
            const open = openDay === dayIdx;
            return (
              <View key={dayIdx} style={[styles.row, i === DAY_COLUMNS.length - 1 && !open && { borderBottomWidth: 0 }]}>
                <Pressable onPress={() => setOpenDay(open ? null : dayIdx)} style={styles.rowHead}>
                  <Text style={styles.dayName}>{label}</Text>
                  <Text style={[styles.dayValue, slots.length === 0 && styles.dayValueOff]} numberOfLines={2}>
                    {slots.length === 0 ? 'Kapalı' : summarize(slots)}
                  </Text>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-forward'} size={18} color={colors.faint} />
                </Pressable>
                {open && (
                  <View style={styles.editor}>
                    <Text style={styles.editorHint}>Ders başlangıç saatlerine dokun. Her ders 50 dakika sürer.</Text>
                    <View style={styles.grid}>
                      {ALL_SLOTS.map((time) => {
                        const on = slots.includes(time);
                        return (
                          <Pressable key={time} onPress={() => toggleSlot(dayIdx, time)} style={[styles.cell, on && styles.cellOn]}>
                            <Text style={[styles.cellText, on && styles.cellTextOn]}>{time}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {slots.length > 0 && (
                      <Pressable onPress={() => edit((prev) => ({ ...prev, [dayIdx]: [] }))} style={styles.dayClear}>
                        <Text style={styles.dayClearText}>{label} gününü kapat</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {!!status && !dirty && (
          <View style={styles.statusRow}>
            <Ionicons name={status === 'Kaydedildi' ? 'checkmark-circle' : 'alert-circle'} size={16} color={status === 'Kaydedildi' ? colors.success : colors.error} />
            <Text style={styles.status}>{status}</Text>
          </View>
        )}
      </ScrollView>

      {dirty && (
        <View style={styles.bar}>
          {!!status && <Text style={[styles.status, { color: colors.error, marginBottom: 6 }]}>{status}</Text>}
          <Pressable onPress={handleSave} disabled={saving} style={({ pressed }) => [styles.save, { opacity: saving ? 0.7 : pressed ? 0.88 : 1 }]}>
            {saving ? <ActivityIndicator color={colors.gold2} /> : <Text style={styles.saveText}>Değişiklikleri kaydet</Text>}
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

// "19:00","20:00","21:00" → "19:00–21:50": starts up to an hour apart read as one
// stretch, from the first start to the last lesson's end
function summarize(slots: string[]) {
  const mins = slots.map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))).sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const m of mins) {
    const last = runs[runs.length - 1];
    if (last && m - last[1] <= 60) last[1] = m;
    else runs.push([m, m]);
  }
  const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return runs.map(([a, b]) => `${hhmm(a)}–${hhmm(b + 50)}`).join(' · ');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 24 },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.ink, letterSpacing: -0.5 },
  subtitle: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 19, color: colors.faint, marginTop: 4 },
  presets: { marginHorizontal: -16, marginTop: 14, marginBottom: 12 },
  presetsInner: { paddingHorizontal: 16, gap: 8 },
  preset: { borderWidth: 1, borderColor: '#e3e3e3', borderRadius: 12, paddingHorizontal: 13, paddingVertical: 9 },
  presetClear: { borderColor: '#f3c9c6' },
  presetText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink },
  table: { borderWidth: 1, borderColor: colors.border, borderRadius: 18, overflow: 'hidden' },
  row: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  dayName: { width: 40, fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.ink },
  dayValue: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 14, color: '#444' },
  dayValueOff: { color: '#b5b5b5' },
  editor: { paddingHorizontal: 14, paddingBottom: 14 },
  editorHint: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.faint, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cell: { width: '23.5%', alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: colors.panel2 },
  cellOn: { backgroundColor: colors.dark },
  cellText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.muted, fontVariant: ['tabular-nums'] },
  cellTextOn: { color: colors.gold2 },
  dayClear: { alignSelf: 'flex-start', marginTop: 12 },
  dayClearText: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.error },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  status: { fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.muted },
  bar: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6, backgroundColor: colors.bg },
  save: { height: 54, borderRadius: 18, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: fonts.bodyExtraBold, fontSize: 15, color: '#fff' },
});
