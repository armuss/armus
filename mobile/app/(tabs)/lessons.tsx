import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../lib/auth';
import { getBookingsForStudent, type Booking } from '../../lib/bookings';
import { colors, fonts, radius } from '../../lib/theme';

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
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.teacherName}>{item.teacherName}</Text>
                <View style={[styles.statusPill, item.status === 'cancelled' && styles.statusPillCancelled]}>
                  <Text
                    style={[styles.statusText, item.status === 'cancelled' && styles.statusTextCancelled]}
                  >
                    {item.status === 'cancelled' ? 'İptal edildi' : 'Onaylı'}
                  </Text>
                </View>
              </View>
              <Text style={styles.type}>{item.type}</Text>
              <View style={styles.metaRow}>
                <Text style={styles.meta}>{item.dateLabel}</Text>
                <Text style={styles.meta}>{item.time}</Text>
                <Text style={styles.meta}>₺{item.price}</Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Henüz dersin yok</Text>
              <Text style={styles.emptyText}>Bir öğretmen seçip deneme dersi alarak başla.</Text>
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
  empty: {
    alignItems: 'center',
    marginTop: 60,
    paddingHorizontal: 30,
  },
  emptyTitle: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 6,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.muted,
    textAlign: 'center',
  },
});
