import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../../components/Button';
import { useAuth } from '../../lib/auth';
import { canJoinLessonNow, getBookingsForStudent, type Booking } from '../../lib/bookings';
import { shortDisplayName } from '../../lib/displayName';
import { createDispute, getOwnDisputes, type Dispute } from '../../lib/disputes';
import { colors, fonts, radius } from '../../lib/theme';

function isPastBooking(booking: Booking) {
  const todayKey = new Date().toISOString().slice(0, 10);
  return booking.date < todayKey;
}

const DISPUTE_SUBJECTS = [
  'Öğretmen derse gelmedi',
  'Ders kalitesiyle ilgili bir sorun',
  'İletişim / uygunsuz davranış',
  'Ödeme ile ilgili bir sorun',
  'Diğer',
];

const DISPUTE_STATUS_LABELS: Record<string, string> = {
  open: 'Bildirdin, inceleniyor',
  in_progress: 'İnceleniyor',
  resolved: 'Çözüldü',
};

function DisputeSection({
  booking,
  reporterId,
  reporterName,
  existingDispute,
  onCreated,
}: {
  booking: Booking;
  reporterId: string;
  reporterName: string;
  existingDispute?: Dispute;
  onCreated: (d: Dispute) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [subject, setSubject] = useState(DISPUTE_SUBJECTS[0]);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (existingDispute) {
    return (
      <View style={styles.disputeSubmitted}>
        <Text style={styles.disputeStatus}>⚑ {DISPUTE_STATUS_LABELS[existingDispute.status] || existingDispute.status}</Text>
        <Text style={styles.disputeSubjectText}>{existingDispute.subject}</Text>
      </View>
    );
  }

  if (!expanded) {
    return (
      <Pressable onPress={() => setExpanded(true)} style={styles.disputePromptBtn}>
        <Text style={styles.disputePromptText}>⚑ Bir sorun bildir</Text>
      </Pressable>
    );
  }

  async function handleSubmit() {
    if (!description.trim()) {
      setError('Lütfen ne olduğunu kısaca yaz.');
      return;
    }
    setError('');
    setSubmitting(true);
    const created = await createDispute({
      bookingId: booking.id,
      reporterId,
      reporterName,
      reporterRole: 'student',
      otherPartyName: booking.teacherName,
      subject,
      description: description.trim(),
    });
    setSubmitting(false);
    if (!created) {
      setError('Bildirilemedi. Lütfen tekrar dene.');
      return;
    }
    onCreated(created);
  }

  return (
    <View style={styles.disputeForm}>
      <View style={styles.disputeSubjectRow}>
        {DISPUTE_SUBJECTS.map((s) => (
          <Pressable
            key={s}
            onPress={() => setSubject(s)}
            style={[styles.disputeChip, subject === s && styles.disputeChipActive]}
          >
            <Text style={[styles.disputeChipText, subject === s && styles.disputeChipTextActive]}>{s}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="Ne oldu, kısaca anlat..."
        placeholderTextColor={colors.faint}
        style={styles.disputeInput}
        multiline
      />
      {!!error && <Text style={styles.disputeError}>{error}</Text>}
      <Pressable onPress={handleSubmit} disabled={submitting} style={[styles.disputeSubmitBtn, submitting && styles.disputeSubmitBtnDisabled]}>
        <Text style={styles.disputeSubmitText}>{submitting ? 'Gönderiliyor…' : 'Gönder'}</Text>
      </Pressable>
    </View>
  );
}

export default function Lessons() {
  const { profile } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!profile) return;
    const [bookingsData, disputesData] = await Promise.all([
      getBookingsForStudent(profile.id),
      getOwnDisputes(profile.id),
    ]);
    setBookings(bookingsData);
    setDisputes(disputesData);
    setLoading(false);
    setRefreshing(false);
  }, [profile]);

  const disputeByBooking = new Map(disputes.filter((d) => d.bookingId).map((d) => [d.bookingId, d]));

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
                  <Text style={styles.teacherName}>{shortDisplayName(item.teacherName)}</Text>
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

                {!isCancelled && profile && (
                  <DisputeSection
                    booking={item}
                    reporterId={profile.id}
                    reporterName={profile.name}
                    existingDispute={disputeByBooking.get(item.id)}
                    onCreated={(d) => setDisputes((prev) => [d, ...prev])}
                  />
                )}
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
  disputePromptBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  disputePromptText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 12.5,
    color: colors.muted,
  },
  disputeSubmitted: {
    marginTop: 12,
    backgroundColor: colors.panel2,
    borderRadius: radius.md,
    padding: 10,
  },
  disputeStatus: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    color: colors.goldText,
  },
  disputeSubjectText: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 3,
  },
  disputeForm: {
    marginTop: 12,
    gap: 8,
  },
  disputeSubjectRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  disputeChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  disputeChipActive: {
    borderColor: colors.gold3,
    backgroundColor: '#fff8e6',
  },
  disputeChipText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11.5,
    color: colors.muted,
  },
  disputeChipTextActive: {
    color: colors.goldText,
  },
  disputeInput: {
    minHeight: 64,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  disputeError: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.error,
  },
  disputeSubmitBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  disputeSubmitBtnDisabled: {
    opacity: 0.6,
  },
  disputeSubmitText: {
    fontFamily: fonts.bodyBold,
    fontSize: 12.5,
    color: '#fff',
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
