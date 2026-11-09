import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import TeacherCard from '../../components/TeacherCard';
import TeacherHome from '../../components/TeacherHome';
import { useAuth } from '../../lib/auth';
import { getFavorites, toggleFavorite } from '../../lib/favorites';
import { getMarketplaceTeachers } from '../../lib/teachers';
import type { Teacher } from '../../lib/teachers-data';
import { colors, fonts, radius } from '../../lib/theme';

const SPECIALTY_OPTIONS = ['Tümü', 'IELTS', 'TOEFL', 'YDS', 'Konuşma', 'İş İngilizcesi'];
type PriceSort = 'none' | 'asc' | 'desc';

export default function Home() {
  const { profile } = useAuth();
  return profile?.role === 'teacher' ? <TeacherHome /> : <StudentBrowse />;
}

function StudentBrowse() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [specialty, setSpecialty] = useState('Tümü');
  const [priceSort, setPriceSort] = useState<PriceSort>('none');
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = teachers.filter((t) => {
      const matchesQuery = !q || [t.name, t.role, ...t.tags].some((f) => f.toLowerCase().includes(q));
      const matchesSpecialty = specialty === 'Tümü' || t.tags.includes(specialty);
      const matchesFavorite = !favoritesOnly || favoriteIds.includes(t.id);
      return matchesQuery && matchesSpecialty && matchesFavorite;
    });
    if (priceSort !== 'none') {
      list = [...list].sort((a, b) => (priceSort === 'asc' ? a.price - b.price : b.price - a.price));
    }
    return list;
  }, [teachers, query, specialty, priceSort, favoritesOnly, favoriteIds]);

  const activeFilters = specialty !== 'Tümü' || favoritesOnly || !!query.trim();
  const tileW = Math.floor((width - 32 - 10) / 2);
  // an odd result count under a filter ends on a tile that offers to widen it,
  // so the last photo doesn't sit alone
  const gridData: (Teacher | 'more')[] = filtered.length % 2 === 1 && activeFilters ? [...filtered, 'more'] : filtered;

  function clearFilters() {
    setSpecialty('Tümü');
    setFavoritesOnly(false);
    setQuery('');
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]} edges={['top']}>
        <ActivityIndicator color={colors.ink} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <FlatList
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
            tintColor={colors.ink}
          />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.head}>
              <Text style={styles.title}>Keşfet</Text>
              <Pressable
                onPress={() => setShowSearch((v) => !v)}
                style={[styles.roundBtn, showSearch && styles.roundBtnOn]}
                accessibilityLabel="Ara ve sırala"
              >
                <Ionicons name={showSearch ? 'close' : 'search'} size={19} color={showSearch ? '#fff' : colors.ink} />
              </Pressable>
            </View>

            {showSearch && (
              <View style={styles.searchBlock}>
                <View style={styles.searchRow}>
                  <Ionicons name="search" size={17} color={colors.faint} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="İsim, IELTS, konuşma..."
                    placeholderTextColor={colors.faint}
                    style={styles.search}
                    autoFocus
                  />
                </View>
                <View style={styles.sortRow}>
                  <Text style={styles.sortLabel}>Sırala</Text>
                  {(
                    [
                      ['none', 'Önerilen'],
                      ['asc', 'Fiyat ↑'],
                      ['desc', 'Fiyat ↓'],
                    ] as [PriceSort, string][]
                  ).map(([key, label]) => (
                    <Chip key={key} label={label} active={priceSort === key} onPress={() => setPriceSort(key)} />
                  ))}
                </View>
              </View>
            )}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsInner}>
              {SPECIALTY_OPTIONS.map((opt) => (
                <Chip key={opt} label={opt} active={specialty === opt} onPress={() => setSpecialty(opt)} />
              ))}
              <Chip
                label={favoritesOnly ? '♥ Favorilerim' : '♡ Favorilerim'}
                active={favoritesOnly}
                onPress={() => setFavoritesOnly((v) => !v)}
              />
            </ScrollView>
          </View>
        }
        renderItem={({ item }) =>
          item === 'more' ? (
            <Pressable onPress={clearFilters} style={[styles.more, { width: tileW }]}>
              <Ionicons name="options-outline" size={20} color={colors.muted} />
              <Text style={styles.moreText}>Daha fazla öğretmen için filtreyi temizle</Text>
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
              {favoritesOnly ? 'Henüz favori öğretmenin yok. Bir fotoğraftaki kalbe dokunarak ekleyebilirsin.' : 'Aramanla eşleşen öğretmen bulunamadı.'}
            </Text>
            {activeFilters && (
              <Pressable onPress={clearFilters} style={styles.emptyBtn}>
                <Text style={styles.emptyBtnText}>Filtreyi temizle</Text>
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
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: 16, paddingBottom: 20 },
  row: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: 12 },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.ink, letterSpacing: -0.5 },
  roundBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.panel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundBtnOn: { backgroundColor: colors.dark },
  searchBlock: { marginBottom: 12, gap: 10 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.panel2,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 48,
  },
  search: { flex: 1, height: '100%', fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.ink },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  sortLabel: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.faint, letterSpacing: 0.5, textTransform: 'uppercase', marginRight: 2 },
  chips: { marginHorizontal: -16, marginBottom: 12 },
  chipsInner: { paddingHorizontal: 16, gap: 7 },
  chip: { backgroundColor: colors.panel2, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  chipActive: { backgroundColor: colors.dark },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink },
  chipTextActive: { color: '#fff' },
  more: {
    height: 232,
    borderRadius: radius.xl,
    backgroundColor: '#f6f6f6',
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
  emptyBtnText: { fontFamily: fonts.bodyBold, fontSize: 14, color: '#fff' },
});
