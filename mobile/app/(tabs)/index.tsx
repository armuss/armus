import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Band, { ScrollBand } from '../../components/Band';
import { EMPTY_FILTERS, FilterBar, applyFilters, hasActiveFilters, type Filters } from '../../components/ExploreFilters';
import TeacherCard from '../../components/TeacherCard';
import TeacherHome from '../../components/TeacherHome';
import { useAuth } from '../../lib/auth';
import { getFavorites, toggleFavorite } from '../../lib/favorites';
import { getMarketplaceTeachers } from '../../lib/teachers';
import type { Teacher } from '../../lib/teachers-data';
import { colors, fonts, radius } from '../../lib/theme';
import { useT } from '../../lib/i18n';


export default function Home() {
  const { profile } = useAuth();
  return profile?.role === 'teacher' ? <TeacherHome /> : <StudentBrowse />;
}

function StudentBrowse() {
  const t = useT();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // search + filters (design A): the website's filters, one chip each
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const favoritesOnly = filters.favoritesOnly;
  const { width } = useWindowDimensions();

  const load = useCallback(async () => {
    const [list, favorites] = await Promise.all([getMarketplaceTeachers(), getFavorites()]);
    setTeachers(list);
    setFavoriteIds(favorites);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleToggleFavorite(teacherId: string) {
    const nowFavorited = await toggleFavorite(teacherId);
    setFavoriteIds((prev) => (nowFavorited ? [...prev, teacherId] : prev.filter((id) => id !== teacherId)));
  }

  const filtered = useMemo(() => applyFilters(teachers, filters, favoriteIds), [teachers, filters, favoriteIds]);

  const activeFilters = hasActiveFilters(filters);
  const tileW = Math.floor((width - 32 - 10) / 2);
  // an odd result count under a filter ends on a tile that offers to widen it,
  // so the last photo doesn't sit alone
  const gridData: (Teacher | 'more')[] = filtered.length % 2 === 1 && activeFilters ? [...filtered, 'more'] : filtered;

  function clearFilters() {
    setFilters((f) => ({ ...EMPTY_FILTERS, sort: f.sort }));
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <Band height={150} />
        <SafeAreaView style={[styles.safe, styles.centered]} edges={['top']}>
          <ActivityIndicator color={colors.onRed} />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeRed} edges={['top']}>
      <FlatList
          extraData={t}
        style={styles.list}
        data={gridData}
        numColumns={2}
        keyExtractor={(item) => (item === 'more' ? 'more' : item.id)}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.onRed}
          />
        }
        ListHeaderComponent={
          <View>
            {/* the red band reaches under the title, the search and the filter chips */}
            <ScrollBand height={196} />
            <View style={styles.head}>
              <Text style={styles.title}>{t("Keşfet")}</Text>
              <Pressable
                onPress={() => setFilters((f) => ({ ...f, favoritesOnly: !f.favoritesOnly }))}
                style={[styles.roundBtn, favoritesOnly && styles.roundBtnOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: favoritesOnly }}
                accessibilityLabel={t("Favorilerim")}
              >
                <Ionicons name={favoritesOnly ? 'heart' : 'heart-outline'} size={19} color={favoritesOnly ? colors.red : colors.onRed} />
              </Pressable>
            </View>

            <FilterBar filters={filters} onChange={setFilters} teachers={teachers} favoriteIds={favoriteIds} />

            <View style={styles.countRow}>
              <Text style={styles.countText}>{t("{0} öğretmen", filtered.length)}</Text>
              {activeFilters && (
                <Pressable onPress={clearFilters} hitSlop={8}>
                  <Text style={styles.countClear}>{t("Filtreleri temizle")}</Text>
                </Pressable>
              )}
            </View>
          </View>
        }
        renderItem={({ item }) =>
          item === 'more' ? (
            <Pressable onPress={clearFilters} style={[styles.more, { width: tileW }]}>
              <Ionicons name="options-outline" size={20} color={colors.muted} />
              <Text style={styles.moreText}>{t("Daha fazla öğretmen için filtreyi temizle")}</Text>
            </Pressable>
          ) : (
            <TeacherCard
              teacher={item}
              width={tileW}
              onPress={() => router.push(`/teacher/${item.id}`)}
              isFavorite={favoriteIds.includes(item.id)}
              onToggleFavorite={() => handleToggleFavorite(item.id)}
            />
          )
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.empty}>
              {favoritesOnly ? t("Henüz favori öğretmenin yok. Bir fotoğraftaki kalbe dokunarak ekleyebilirsin.") : t("Aramanla eşleşen öğretmen bulunamadı.")}
            </Text>
            {activeFilters && (
              <Pressable onPress={clearFilters} style={styles.emptyBtn}>
                <Text style={styles.emptyBtnText}>{t("Filtreyi temizle")}</Text>
              </Pressable>
            )}
          </View>
        }
      />
    </SafeAreaView>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10, marginLeft: 2 },
  countText: { fontFamily: fonts.bodyExtraBold, fontSize: 12.5, color: colors.ink },
  countClear: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.red, textDecorationLine: 'underline' },
  screen: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1, backgroundColor: 'transparent' },
  // the status bar area is plain red; the list paints the ground and carries the band
  safeRed: { flex: 1, backgroundColor: colors.red },
  list: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: 16, paddingBottom: 20 },
  row: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: 12 },
  title: { fontFamily: fonts.display, fontSize: 26, color: colors.onRed, letterSpacing: -0.8 },
  roundBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(250,245,226,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(250,245,226,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundBtnOn: { backgroundColor: colors.cream, borderColor: colors.cream },
  searchBlock: { marginBottom: 12, gap: 10 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.panel,
    borderRadius: 15,
    paddingHorizontal: 14,
    height: 48,
  },
  search: { flex: 1, height: '100%', fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  sortLabel: { fontFamily: fonts.bodyBold, fontSize: 12, color: 'rgba(250,245,226,0.8)', letterSpacing: 0.5, textTransform: 'uppercase', marginRight: 2 },
  chips: { marginHorizontal: -16, marginBottom: 12 },
  chipsInner: { paddingHorizontal: 16, gap: 7 },
  // the chips sit on the red band: see-through cream, the picked one solid cream
  chip: {
    backgroundColor: 'rgba(250,245,226,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(250,245,226,0.3)',
    borderRadius: 99,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  chipActive: { backgroundColor: colors.cream, borderColor: colors.cream },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.onRed },
  chipTextActive: { color: colors.red },
  more: {
    height: 232,
    borderRadius: radius.xl,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    marginBottom: 10,
  },
  moreText: { fontFamily: fonts.bodySemibold, fontSize: 13, lineHeight: 18, color: colors.muted, textAlign: 'center' },
  emptyBox: { alignItems: 'center', marginTop: 40, gap: 14, paddingHorizontal: 20 },
  empty: { fontFamily: fonts.bodyMedium, fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: 'center' },
  emptyBtn: { backgroundColor: colors.dark, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12 },
  emptyBtnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.onRed },
});
