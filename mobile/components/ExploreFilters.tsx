import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../lib/i18n';
import type { Teacher } from '../lib/teachers-data';
import { colors, fonts, radius } from '../lib/theme';

/**
 * Keşfet's search and filters (design A): a search bar that is always
 * there, and one chip per filter - tapping a chip opens its own sheet.
 * The filters and the way they match are the website's (teachers.html):
 * price range, lesson times (time blocks + days, read from the teacher's
 * own availability grid), level, lesson type, the languages the teacher
 * speaks, and the sort order.
 */

export type Sort = 'default' | 'priceLow' | 'priceHigh' | 'rating';

export type Filters = {
  query: string;
  priceMin: number;
  priceMax: number; // PRICE_TOP means "and above"
  blocks: string[]; // "18:00-21:00"
  days: number[]; // 0 = Sunday
  levels: string[];
  tags: string[];
  langs: string[];
  sort: Sort;
  favoritesOnly: boolean;
};

export const PRICE_TOP = 1000;
const PRICE_STEP = 50;

export const EMPTY_FILTERS: Filters = {
  query: '',
  priceMin: 0,
  priceMax: PRICE_TOP,
  blocks: [],
  days: [],
  levels: [],
  tags: [],
  langs: [],
  sort: 'default',
  favoritesOnly: false,
};

const TIME_GROUPS: { label: string; blocks: [string, string, ComponentProps<typeof Ionicons>['name']][] }[] = [
  {
    label: 'Gündüz',
    blocks: [
      ['09:00', '12:00', 'sunny-outline'],
      ['12:00', '15:00', 'sunny'],
      ['15:00', '18:00', 'partly-sunny-outline'],
    ],
  },
  {
    label: 'Akşam ve gece',
    blocks: [
      ['18:00', '21:00', 'cloudy-night-outline'],
      ['21:00', '24:00', 'moon-outline'],
      ['00:00', '03:00', 'moon'],
    ],
  },
  {
    label: 'Sabah',
    blocks: [
      ['03:00', '06:00', 'star-outline'],
      ['06:00', '09:00', 'sunny-outline'],
    ],
  },
];
// Monday first, like the website
const DAYS: [number, string][] = [
  [1, 'Pzt'],
  [2, 'Sal'],
  [3, 'Çar'],
  [4, 'Per'],
  [5, 'Cum'],
  [6, 'Cmt'],
  [0, 'Paz'],
];
const LEVELS: [string, string][] = [
  ['Başlangıç', 'A1–A2'],
  ['Orta', 'B1–B2'],
  ['İleri', 'C1–C2'],
];
const TAGS = ['Konuşma', 'IELTS', 'TOEFL', 'YDS', 'İş İngilizcesi'];
// a language and the ways a teacher's profile may write it
const LANGS: [string, string[]][] = [
  ['İngilizce', ['ingilizce', 'english']],
  ['Türkçe', ['türkçe', 'turkce', 'turkish']],
  ['Almanca', ['almanca', 'german', 'deutsch']],
  ['Fransızca', ['fransızca', 'french', 'français', 'francais']],
  ['İspanyolca', ['ispanyolca', 'spanish', 'español', 'espanol']],
];
const SORTS: [Sort, string][] = [
  ['default', 'Önerilen'],
  ['priceLow', 'En düşük fiyat'],
  ['priceHigh', 'En yüksek fiyat'],
  ['rating', 'En yüksek puan'],
];

const blockKey = (start: string, end: string) => `${start}-${end}`;
const blockLabel = (key: string) => key.split('-').map((x) => String(Number(x.slice(0, 2)))).join('-');

// teachers.html teacherMatchesDayBlock: null when the teacher has no grid
// to check (demo teachers, a new teacher) - they're not hidden over it
function matchesDayBlock(t: Teacher, day: number, start: string, end: string): boolean | null {
  let slots: string[];
  const dates = t.availabilityDates as any;
  if (dates && dates._set === true) slots = dates[String(day)] || [];
  else if (t.weeklyAvailability) slots = t.weeklyAvailability[day] || [];
  else return null;
  return slots.some((time) => time >= start && time < end);
}

function matchesAvailability(t: Teacher, f: Filters) {
  if (!f.blocks.length && !f.days.length) return true;
  const days = f.days.length ? f.days : [0, 1, 2, 3, 4, 5, 6];
  const blocks = f.blocks.length ? f.blocks.map((k) => k.split('-')) : [['00:00', '24:00']];
  for (const day of days) {
    for (const [start, end] of blocks) {
      const r = matchesDayBlock(t, day, start, end);
      if (r === null || r === true) return true;
    }
  }
  return false;
}

// search text compared without caring about case or the Turkish dotted /
// dotless i ("IELTS", "ielts" and "ıelts" all match)
const fold = (x: string) => x.replace(/[İIı]/g, 'i').toLowerCase();

export function matchesFilters(t: Teacher, f: Filters, favoriteIds: string[]) {
  const q = fold(f.query.trim());
  const tags = fold(t.tags.join(' '));
  const langs = fold(t.languages || '');
  const price = Number(t.price);
  if (q && !(fold(t.name).includes(q) || tags.includes(q) || fold(t.role).includes(q) || fold(t.specialties.join(' ')).includes(q))) return false;
  if (f.tags.length && !f.tags.some((tag) => tags.includes(fold(tag)))) return false;
  if (f.levels.length && !f.levels.includes(t.level)) return false;
  if (f.langs.length && !f.langs.some((l) => (LANGS.find(([k]) => k === l)?.[1] || [l]).some((w) => langs.includes(fold(w)))))
    return false;
  if (price < f.priceMin || (f.priceMax < PRICE_TOP && price > f.priceMax)) return false;
  if (f.favoritesOnly && !favoriteIds.includes(t.id)) return false;
  return matchesAvailability(t, f);
}

export function applyFilters(list: Teacher[], f: Filters, favoriteIds: string[]) {
  const out = list.filter((t) => matchesFilters(t, f, favoriteIds));
  if (f.sort === 'priceLow') out.sort((a, b) => a.price - b.price);
  else if (f.sort === 'priceHigh') out.sort((a, b) => b.price - a.price);
  else if (f.sort === 'rating') out.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  return out;
}

export function hasActiveFilters(f: Filters) {
  return (
    !!f.query.trim() ||
    f.priceMin > 0 ||
    f.priceMax < PRICE_TOP ||
    f.blocks.length > 0 ||
    f.days.length > 0 ||
    f.levels.length > 0 ||
    f.tags.length > 0 ||
    f.langs.length > 0 ||
    f.favoritesOnly
  );
}

type SheetKind = 'price' | 'time' | 'level' | 'tags' | 'langs' | 'sort';

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const money = (n: number, top = false) => `₺${n}${top && n >= PRICE_TOP ? '+' : ''}`;

/** The search bar and the row of filter chips, on the red band. */
export function FilterBar({
  filters,
  onChange,
  teachers,
  favoriteIds,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  teachers: Teacher[];
  favoriteIds: string[];
}) {
  const t = useT();
  const [open, setOpen] = useState<SheetKind | null>(null);

  const priceOn = filters.priceMin > 0 || filters.priceMax < PRICE_TOP;
  const timeCount = filters.blocks.length + filters.days.length;
  const one = (list: string[]) => (list.length === 1 ? t(list[0]) : `${list.length}`);
  const chips: { kind: SheetKind; label: string; on: boolean; icon?: ComponentProps<typeof Ionicons>['name'] }[] = [
    { kind: 'price', label: priceOn ? `${t('Fiyat')}: ${money(filters.priceMin)}–${money(filters.priceMax, true)}` : t('Fiyat'), on: priceOn },
    { kind: 'time', label: timeCount ? `${t('Saat')} · ${timeCount}` : t('Saat'), on: timeCount > 0 },
    { kind: 'level', label: filters.levels.length ? `${t('Seviye')}: ${one(filters.levels)}` : t('Seviye'), on: filters.levels.length > 0 },
    { kind: 'tags', label: filters.tags.length ? `${t('Konu')}: ${one(filters.tags)}` : t('Konu'), on: filters.tags.length > 0 },
    { kind: 'langs', label: filters.langs.length ? `${t('Diller')}: ${one(filters.langs)}` : t('Diller'), on: filters.langs.length > 0 },
    { kind: 'sort', label: t(SORTS.find(([k]) => k === filters.sort)![1]), on: filters.sort !== 'default', icon: 'swap-vertical' },
  ];

  return (
    <>
      <View style={styles.search}>
        <Ionicons name="search" size={17} color={colors.muted} />
        <TextInput
          value={filters.query}
          onChangeText={(query) => onChange({ ...filters, query })}
          placeholder={t('İsim, uzmanlık veya konu ara...')}
          placeholderTextColor={colors.faint}
          style={styles.searchInput}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel={t('Öğretmen ara')}
        />
        {!!filters.query && (
          <Pressable onPress={() => onChange({ ...filters, query: '' })} hitSlop={10} accessibilityLabel={t('Aramayı temizle')}>
            <Ionicons name="close-circle" size={18} color={colors.faint} />
          </Pressable>
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
        {chips.map((c) => (
          <Pressable
            key={c.kind}
            onPress={() => setOpen(c.kind)}
            style={({ pressed }) => [styles.chip, c.on && styles.chipOn, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
          >
            {c.icon && <Ionicons name={c.icon} size={14} color={c.on ? colors.red : colors.onRed} />}
            <Text style={[styles.chipText, c.on && styles.chipTextOn]} numberOfLines={1}>
              {c.label}
            </Text>
            <Ionicons name="chevron-down" size={13} color={c.on ? colors.red : colors.onRed} />
          </Pressable>
        ))}
      </ScrollView>
      {open && (
        <FilterSheet
          kind={open}
          filters={filters}
          teachers={teachers}
          favoriteIds={favoriteIds}
          onClose={() => setOpen(null)}
          onApply={(f) => {
            onChange(f);
            setOpen(null);
          }}
        />
      )}
    </>
  );
}

const TITLES: Record<SheetKind, string> = {
  price: 'Ders ücreti',
  time: 'Ders saatleri',
  level: 'Seviye',
  tags: 'Konu',
  langs: 'Öğretmenin konuştuğu diller',
  sort: 'Sıralama',
};

// what "Temizle" resets in each sheet
function clearSection(f: Filters, kind: SheetKind): Filters {
  if (kind === 'price') return { ...f, priceMin: 0, priceMax: PRICE_TOP };
  if (kind === 'time') return { ...f, blocks: [], days: [] };
  if (kind === 'level') return { ...f, levels: [] };
  if (kind === 'tags') return { ...f, tags: [] };
  if (kind === 'langs') return { ...f, langs: [] };
  return { ...f, sort: 'default' };
}

function FilterSheet({
  kind,
  filters,
  teachers,
  favoriteIds,
  onClose,
  onApply,
}: {
  kind: SheetKind;
  filters: Filters;
  teachers: Teacher[];
  favoriteIds: string[];
  onClose: () => void;
  onApply: (f: Filters) => void;
}) {
  const t = useT();
  const insets = useSafeAreaInsets();
  // the sheet works on a copy; "göster" applies it, closing drops it
  const [draft, setDraft] = useState<Filters>(filters);
  const count = useMemo(() => applyFilters(teachers, draft, favoriteIds).length, [teachers, draft, favoriteIds]);
  // for the counts next to each option: every other filter applied
  const countWith = (f: Filters) => applyFilters(teachers, f, favoriteIds).length;

  let body: ReactNode = null;
  if (kind === 'price') {
    const presets: [string, number, number][] = [
      ['₺500 altı', 0, 500],
      ['₺500 – ₺800', 500, 800],
      ['₺800 üstü', 800, PRICE_TOP],
    ];
    body = (
      <>
        <Text style={styles.bigValue}>
          {money(draft.priceMin)} – {money(draft.priceMax, true)}
        </Text>
        <Text style={styles.hint}>{t('50 dakikalık ders başına')}</Text>
        <RangeSlider
          min={0}
          max={PRICE_TOP}
          step={PRICE_STEP}
          low={draft.priceMin}
          high={draft.priceMax}
          onChange={(low, high) => setDraft((d) => ({ ...d, priceMin: low, priceMax: high }))}
        />
        <View style={styles.scale}>
          <Text style={styles.scaleText}>₺0</Text>
          <Text style={styles.scaleText}>₺{PRICE_TOP}+</Text>
        </View>
        <View style={styles.wrap}>
          {presets.map(([label, lo, hi]) => {
            const on = draft.priceMin === lo && draft.priceMax === hi;
            return (
              <Pressable key={label} onPress={() => setDraft((d) => ({ ...d, priceMin: lo, priceMax: hi }))} style={[styles.pill, on && styles.pillOn]}>
                <Text style={[styles.pillText, on && styles.pillTextOn]}>{t(label)}</Text>
              </Pressable>
            );
          })}
        </View>
      </>
    );
  } else if (kind === 'time') {
    body = (
      <>
        {TIME_GROUPS.map((g) => (
          <View key={g.label}>
            <Text style={styles.mini}>{t(g.label).toLocaleUpperCase()}</Text>
            <View style={styles.grid}>
              {g.blocks.map(([start, end, icon]) => {
                const key = blockKey(start, end);
                const on = draft.blocks.includes(key);
                return (
                  <Pressable
                    key={key}
                    onPress={() => setDraft((d) => ({ ...d, blocks: toggle(d.blocks, key) }))}
                    style={[styles.slot, on && styles.slotOn]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                  >
                    <Ionicons name={icon} size={18} color={on ? colors.onRed : colors.ink} />
                    <Text style={[styles.slotText, on && { color: colors.onRed }]}>{blockLabel(key)}</Text>
                  </Pressable>
                );
              })}
              {g.blocks.length < 3 && <View style={{ flex: 1 }} />}
            </View>
          </View>
        ))}
        <Text style={styles.mini}>{t('GÜNLER')}</Text>
        <View style={styles.days}>
          {DAYS.map(([d, label]) => {
            const on = draft.days.includes(d);
            return (
              <Pressable
                key={d}
                onPress={() => setDraft((x) => ({ ...x, days: toggle(x.days, d) }))}
                style={[styles.day, on && styles.slotOn]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                <Text style={[styles.dayText, on && { color: colors.onRed }]}>{t(label)}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.note}>{t('Öğretmenin kendi haftalık programına göre.')}</Text>
      </>
    );
  } else if (kind === 'level' || kind === 'tags' || kind === 'langs') {
    const field = kind === 'level' ? 'levels' : kind;
    const options: [string, string?][] = kind === 'level' ? LEVELS : kind === 'tags' ? TAGS.map((x) => [x]) : LANGS.map(([x]) => [x]);
    const base = { ...draft, [field]: [] } as Filters;
    body = (
      <View>
        {options.map(([value, sub]) => {
          const on = (draft[field] as string[]).includes(value);
          return (
            <Pressable
              key={value}
              onPress={() => setDraft((d) => ({ ...d, [field]: toggle(d[field] as string[], value) }))}
              style={styles.checkRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
            >
              <View style={[styles.box, on && styles.boxOn]}>{on && <Ionicons name="checkmark" size={14} color={colors.onRed} />}</View>
              <Text style={styles.checkText}>
                {t(value)}
                {sub ? <Text style={styles.checkSub}> ({sub})</Text> : null}
              </Text>
              <Text style={styles.checkCount}>{countWith({ ...base, [field]: [value] } as Filters)}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  } else {
    body = (
      <View>
        {SORTS.map(([value, label]) => {
          const on = draft.sort === value;
          return (
            <Pressable
              key={value}
              onPress={() => setDraft((d) => ({ ...d, sort: value }))}
              style={styles.checkRow}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
            >
              <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.red : colors.faint} />
              <Text style={styles.checkText}>{t(label)}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.shade} onPress={onClose} accessibilityLabel={t('Kapat')} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 14) + 10 }]}>
        <View style={styles.grab} />
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle}>{t(TITLES[kind])}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('Kapat')}>
            <Ionicons name="close" size={22} color={colors.muted} />
          </Pressable>
        </View>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 14 }} showsVerticalScrollIndicator={false}>
          {body}
        </ScrollView>
        <View style={styles.footer}>
          <Pressable onPress={() => setDraft((d) => clearSection(d, kind))} hitSlop={8}>
            <Text style={styles.clear}>{t('Temizle')}</Text>
          </Pressable>
          <Pressable
            onPress={() => onApply(draft)}
            style={({ pressed }) => [styles.show, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
          >
            <Text style={styles.showText}>{kind === 'sort' ? t('Uygula') : t('{0} öğretmeni göster', count)}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** A two-handle slider (the price range), drawn without a library. */
function RangeSlider({
  min,
  max,
  step,
  low,
  high,
  onChange,
}: {
  min: number;
  max: number;
  step: number;
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
}) {
  const t = useT();
  const [width, setWidth] = useState(0);
  const state = useRef({ low, high, width, startX: 0, which: 'low' as 'low' | 'high' });
  state.current.low = low;
  state.current.high = high;
  state.current.width = width;

  const toX = (v: number) => (width ? ((v - min) / (max - min)) * width : 0);
  const fromX = (x: number) => {
    const w = state.current.width || 1;
    const raw = min + (Math.max(0, Math.min(w, x)) / w) * (max - min);
    return Math.round(raw / step) * step;
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const x = e.nativeEvent.locationX;
          const s = state.current;
          const w = s.width || 1;
          const lowX = ((s.low - min) / (max - min)) * w;
          const highX = ((s.high - min) / (max - min)) * w;
          // the handle nearer the finger moves
          s.which = Math.abs(x - lowX) <= Math.abs(x - highX) ? 'low' : 'high';
          if (s.low === s.high) s.which = x > lowX ? 'high' : 'low';
          s.startX = x;
          move(x);
        },
        onPanResponderMove: (_e, g) => move(state.current.startX + g.dx),
        onPanResponderTerminationRequest: () => false,
      }),
    [min, max, step]
  );

  function move(x: number) {
    const s = state.current;
    const v = fromX(x);
    if (s.which === 'low') onChange(Math.min(v, s.high), s.high);
    else onChange(s.low, Math.max(v, s.low));
  }

  return (
    <View
      style={styles.slider}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      {...responder.panHandlers}
      accessibilityRole="adjustable"
      accessibilityLabel={t('Ders ücreti')}
      accessibilityValue={{ text: `₺${low} – ₺${high}` }}
    >
      <View style={styles.track} pointerEvents="none" />
      <View style={[styles.trackOn, { left: toX(low), width: Math.max(0, toX(high) - toX(low)) }]} pointerEvents="none" />
      <View style={[styles.thumb, { left: toX(low) - 13 }]} pointerEvents="none" />
      <View style={[styles.thumb, { left: toX(high) - 13 }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, borderRadius: 16, backgroundColor: colors.panel, paddingHorizontal: 14 },
  searchInput: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 14.5, color: colors.ink, paddingVertical: 0 },
  chipRow: { gap: 8, paddingVertical: 12, paddingRight: 16 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: 'rgba(250,245,226,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(250,245,226,0.3)',
  },
  chipOn: { backgroundColor: colors.cream, borderColor: colors.cream },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.onRed, maxWidth: 190 },
  chipTextOn: { color: colors.red },

  shade: { flex: 1, backgroundColor: 'rgba(10,10,10,0.45)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, maxHeight: '88%' },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 14 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sheetTitle: { flex: 1, fontFamily: fonts.display, fontSize: 21, color: colors.ink, letterSpacing: -0.4 },
  bigValue: { fontFamily: fonts.display, fontSize: 30, color: colors.red, letterSpacing: -0.6 },
  hint: { fontFamily: fonts.body, fontSize: 12.5, color: colors.muted, marginTop: 2, marginBottom: 6 },
  slider: { height: 44, justifyContent: 'center', marginTop: 6, marginHorizontal: 13 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border },
  trackOn: { position: 'absolute', height: 6, borderRadius: 3, backgroundColor: colors.red },
  thumb: { position: 'absolute', width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', borderWidth: 3, borderColor: colors.red },
  scale: { flexDirection: 'row', justifyContent: 'space-between' },
  scaleText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.faint },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  pill: { borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panel, paddingHorizontal: 14, paddingVertical: 8 },
  pillOn: { backgroundColor: colors.red, borderColor: colors.red },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink },
  pillTextOn: { color: colors.onRed },
  mini: { fontFamily: fonts.bodyExtraBold, fontSize: 10.5, letterSpacing: 1, color: colors.muted, marginTop: 12, marginBottom: 8 },
  grid: { flexDirection: 'row', gap: 8 },
  slot: { flex: 1, height: 62, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center', gap: 4 },
  slotOn: { backgroundColor: colors.red, borderColor: colors.red },
  slotText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink },
  days: { flexDirection: 'row', gap: 6 },
  day: { flex: 1, height: 40, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.ink },
  note: { fontFamily: fonts.body, fontSize: 12, color: colors.faint, marginTop: 10 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.red, borderColor: colors.red },
  checkText: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 15, color: colors.ink },
  checkSub: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  checkCount: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.faint },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  clear: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.ink, textDecorationLine: 'underline' },
  show: { flex: 1, height: 52, borderRadius: radius.md, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
  showText: { fontFamily: fonts.bodyExtraBold, fontSize: 15, color: colors.onRed },
});
