import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import TeacherCard from '../../components/TeacherCard';
import { useAuth } from '../../lib/auth';
import { canJoinLessonNow, getBookingsForTeacher, type Booking } from '../../lib/bookings';
import { getMarketplaceTeachers } from '../../lib/teachers';
import type { Teacher } from '../../lib/teachers-data';
import { colors, fonts, radius } from '../../lib/theme';

const SPECIALTY_OPTIONS = ['Tümü', 'IELTS', 'TOEFL', 'YDS', 'Konuşma', 'İş İngilizcesi'];
type PriceSort = 'none' | 'asc' | 'desc';

export default function Home() {
  const { profile } = useAuth();
  return profile?.role === 'teacher' ? <TeacherHome /> : <StudentBrowse />;
}

function TeacherHome() {
  const { profile } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    const data = await getBookingsForTeacher(profile.id);
    setBookings(data);
    setLoading(false);
    setRefreshing(false);
  }, [profile]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const todayKey = new Date().toISOString().slice(0, 10);
  const active = bookings.filter((b) => b.status !== 'cancelled');
  const today = active.filter((b) => b.date === todayKey);
  const upcoming = active.filter((b) => b.date > todayKey).slice(0, 5);
  const studentCount = new Set(active.map((b) => b.studentId)).size;

  if (loading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]} edges={['top']}>
        <ActivityIndicator color={colors.gold3} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <FlatList
        data={today}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.gold3}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <Text style={styles.eyebrow}>BUGÜN</Text>
            <Text style={styles.title}>Merhaba, {profile?.name?.split(' ')[0] || 'Öğretmen'} 👋</Text>

            <View style={styles.statRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{today.length}</Text>
                <Text style={styles.statLabel}>Bugünkü ders</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{studentCount}</Text>
                <Text style={styles.statLabel}>Öğrenci</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{active.length}</Text>
                <Text style={styles.statLabel}>Toplam ders</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Bugünkü derslerin</Text>
          </View>
        }
        renderItem={({ item }) => <TeacherBookingCard booking={item} />}
        ListEmptyComponent={<Text style={styles.empty}>Bugün planlanmış bir dersin yok.</Text>}
        ListFooterComponent={
          upcoming.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.sectionTitle}>Yaklaşan dersler</Text>
              {upcoming.map((b) => (
                <TeacherBookingCard key={b.id} booking={b} compact />
              ))}
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function TeacherBookingCard({ booking, compact }: { booking: Booking; compact?: boolean }) {
  const joinable = !compact && canJoinLessonNow(booking);
  return (
    <View style={styles.bookingCard}>
      <View style={styles.bookingRow}>
        <Text style={styles.bookingName}>{booking.studentName}</Text>
        <Text style={styles.bookingMeta}>
          {compact ? booking.dateLabel : ''} {booking.time}
        </Text>
      </View>
      <Text style={styles.bookingType}>{booking.type === 'trial' ? 'Deneme Dersi' : 'Ders'}</Text>
      {joinable && (
        <Pressable style={styles.joinBtn} onPress={() => router.push(`/class/${booking.id}`)}>
          <Text style={styles.joinBtnText}>🎥 Derse Katıl</Text>
        </Pressable>
      )}
    </View>
  );
}

function StudentBrowse() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [specialtyIndex, setSpecialtyIndex] = useState(0);
  const [priceSort, setPriceSort] = useState<PriceSort>('none');

  const specialty = SPECIALTY_OPTIONS[specialtyIndex];

  const load = useCallback(async () => {
    const list = await getMarketplaceTeachers();
    setTeachers(list);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function cycleSpecialty() {
    setSpecialtyIndex((i) => (i + 1) % SPECIALTY_OPTIONS.length);
  }

  function cyclePriceSort() {
    setPriceSort((s) => (s === 'none' ? 'asc' : s === 'asc' ? 'desc' : 'none'));
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = teachers.filter((t) => {
      const matchesQuery = !q || [t.name, t.role, ...t.tags].some((f) => f.toLowerCase().includes(q));
      const matchesSpecialty = specialty === 'Tümü' || t.tags.includes(specialty);
      return matchesQuery && matchesSpecialty;
    });
    if (priceSort !== 'none') {
      list = [...list].sort((a, b) => (priceSort === 'asc' ? a.price - b.price : b.price - a.price));
    }
    return list;
  }, [teachers, query, specialty, priceSort]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]} edges={['top']}>
        <ActivityIndicator color={colors.gold3} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.gold3}
          />
        }
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
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
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
    marginTop: 20,
  },
  statRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 22,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.panel,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    paddingVertical: 14,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 20,
    color: colors.ink,
  },
  statLabel: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    marginTop: 3,
    textAlign: 'center',
  },
  sectionTitle: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 10,
  },
  bookingCard: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 14,
    marginBottom: 10,
  },
  bookingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bookingName: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 15,
    color: colors.ink,
  },
  bookingMeta: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13,
    color: colors.muted,
  },
  bookingType: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 3,
  },
  joinBtn: {
    marginTop: 12,
    backgroundColor: colors.gold3,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  joinBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.onGold,
  },
});
