import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import TeacherCard from '../../components/TeacherCard';
import { TEACHERS } from '../../lib/teachers-data';
import { colors, fonts, radius } from '../../lib/theme';

const SPECIALTY_OPTIONS = ['Tümü', 'IELTS', 'TOEFL', 'YDS', 'Konuşma', 'İş İngilizcesi'];
type PriceSort = 'none' | 'asc' | 'desc';

export default function Home() {
  const [query, setQuery] = useState('');
  const [specialtyIndex, setSpecialtyIndex] = useState(0);
  const [priceSort, setPriceSort] = useState<PriceSort>('none');

  const specialty = SPECIALTY_OPTIONS[specialtyIndex];

  function cycleSpecialty() {
    setSpecialtyIndex((i) => (i + 1) % SPECIALTY_OPTIONS.length);
  }

  function cyclePriceSort() {
    setPriceSort((s) => (s === 'none' ? 'asc' : s === 'asc' ? 'desc' : 'none'));
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = TEACHERS.filter((t) => {
      const matchesQuery = !q || [t.name, t.role, ...t.tags].some((f) => f.toLowerCase().includes(q));
      const matchesSpecialty = specialty === 'Tümü' || t.tags.includes(specialty);
      return matchesQuery && matchesSpecialty;
    });
    if (priceSort !== 'none') {
      list = [...list].sort((a, b) => (priceSort === 'asc' ? a.price - b.price : b.price - a.price));
    }
    return list;
  }, [query, specialty, priceSort]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <Text style={styles.eyebrow}>İNGİLİZCE</Text>
            <Text style={styles.title}>
              Konuşurken <Text style={styles.titleAccent}>özgüven</Text> kazandıracak öğretmenler
            </Text>

            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="İsim, IELTS, konuşma..."
              placeholderTextColor={colors.faint}
              style={styles.search}
            />

            <View style={styles.filterRow}>
              <Pressable onPress={cyclePriceSort} style={[styles.filterChip, priceSort !== 'none' && styles.filterChipActive]}>
                <Text style={[styles.filterChipText, priceSort !== 'none' && styles.filterChipTextActive]}>
                  Fiyat{priceSort === 'asc' ? ' ↑' : priceSort === 'desc' ? ' ↓' : ''}
                </Text>
              </Pressable>
              <Pressable onPress={cycleSpecialty} style={[styles.filterChip, specialty !== 'Tümü' && styles.filterChipActive]}>
                <Text style={[styles.filterChipText, specialty !== 'Tümü' && styles.filterChipTextActive]}>
                  Uzmanlık{specialty !== 'Tümü' ? `: ${specialty}` : ''}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.resultCount}>{filtered.length} öğretmen bulundu</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TeacherCard teacher={item} onPress={() => router.push(`/teacher/${item.id}`)} />
        )}
        ListEmptyComponent={<Text style={styles.empty}>Aramanla eşleşen öğretmen bulunamadı.</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  headerBlock: {
    paddingTop: 8,
    paddingBottom: 18,
  },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    letterSpacing: 1,
    color: colors.goldText,
    marginBottom: 8,
  },
  title: {
    fontFamily: fonts.displayBlack,
    fontSize: 25,
    lineHeight: 31,
    color: colors.ink,
    letterSpacing: -0.5,
    marginBottom: 18,
  },
  titleAccent: {
    color: colors.gold3,
  },
  search: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 16,
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: colors.ink,
    backgroundColor: colors.panel,
    marginBottom: 14,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  filterChip: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  filterChipActive: {
    borderColor: colors.gold3,
    backgroundColor: '#fff8e6',
  },
  filterChipText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 12.5,
    color: colors.ink,
  },
  filterChipTextActive: {
    color: colors.goldText,
  },
  resultCount: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12.5,
    color: colors.muted,
  },
  empty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 40,
  },
});
