import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../../components/Button';
import { useAuth } from '../../lib/auth';
import { canJoinLessonNow, getBookingsForStudent, type Booking } from '../../lib/bookings';
import { colors, fonts, radius } from '../../lib/theme';

function isPastBooking(booking: Booking) {
  const todayKey = new Date().toISOString().slice(0, 10);
  return booking.date < todayKey;
}

export default function Lessons() {
  const { profile } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    const data = await getBookingsForStudent(profile.id);
    setBookings(data);
    setLoading(false);
    setRefreshing(false);
  }, [profile]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.headerBlock}>
        <Text style={styles.title}>Derslerim</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.gold3} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={bookings}
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
          renderItem={({ item }) => {
            const isCancelled = item.status === 'cancelled';
            const isPast = isPastBooking(item);
            const joinable = !isCancelled && !isPast && canJoinLessonNow(item);
            const showHint = !isCancelled && !isPast && !joinable && item.date === new Date().toISOString().slice(0, 10);

            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.teacherName}>{item.teacherName}</Text>
                  <View style={[styles.statusPill, isCancelled && styles.statusPillCancelled]}>
                    <Text style={[styles.statusText, isCancelled && styles.statusTextCancelled]}>
                      {isCancelled ? 'İptal edildi' : 'Onaylı'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.type}>{item.type}</Text>
                <View style={styles.metaRow}>
                  <Text style={styles.meta}>{item.dateLabel}</Text>
                  <Text style={styles.meta}>{item.time}</Text>
                  <Text style={styles.meta}>₺{item.price}</Text>
                </View>

                {joinable && (
                  <Pressable style={styles.joinBtn} onPress={() => router.push(`/class/${item.id}`)}>
                    <Text style={styles.joinBtnText}>🎥 Derse Katıl</Text>
                  </Pressable>
                )}
                {showHint && <Text style={styles.joinHint}>Ders saatinde bu kart üzerinden odaya katılabileceksin.</Text>}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Ders programın burada görünecek</Text>
              <Text style={styles.emptyText}>
                Ders programın başarıya giden yol - başlamak için bir deneme dersi ayarla.
              </Text>
              <View style={styles.emptyBtn}>
                <Button label="Öğretmen bul" onPress={() => router.push('/(tabs)')} />
              </View>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
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
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  teacherName: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 15.5,
    color: colors.ink,
  },
  statusPill: {
    backgroundColor: '#e9f7ef',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusPillCancelled: {
    backgroundColor: '#fbeceb',
  },
  statusText: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.success,
  },
  statusTextCancelled: {
    color: colors.error,
  },
  type: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 12,
  },
  meta: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12.5,
    color: colors.ink,
  },
  joinBtn: {
    marginTop: 14,
    backgroundColor: colors.gold3,
    borderRadius: radius.md,
    paddingVertical: 11,
    alignItems: 'center',
  },
  joinBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.onGold,
  },
  joinHint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.faint,
    marginTop: 12,
  },
  empty: {
    alignItems: 'flex-start',
    marginTop: 20,
  },
  emptyTitle: {
    fontFamily: fonts.displayBlack,
    fontSize: 22,
    color: colors.ink,
    marginBottom: 10,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: 22,
  },
  emptyBtn: {
    width: '100%',
  },
});
