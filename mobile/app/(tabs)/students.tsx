import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../lib/auth';
import { getBookingsForTeacher } from '../../lib/bookings';
import { getOrCreateConversation } from '../../lib/messages';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius } from '../../lib/theme';

type StudentSummary = {
  id: string;
  name: string;
  photo: string | null;
  lessonCount: number;
  lastDateLabel: string;
};

export default function Students() {
  const { profile } = useAuth();
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!profile) return;
      let active = true;
      setLoading(true);

      getBookingsForTeacher(profile.id).then(async (bookings) => {
        if (!active) return;

        const byStudent = new Map<string, { name: string; count: number; lastDateLabel: string }>();
        bookings.forEach((b) => {
          const existing = byStudent.get(b.studentId);
          if (existing) {
            existing.count += 1;
            existing.lastDateLabel = b.dateLabel;
          } else {
            byStudent.set(b.studentId, { name: b.studentName, count: 1, lastDateLabel: b.dateLabel });
          }
        });

        const ids = Array.from(byStudent.keys());
        const { data: profiles } = ids.length
          ? await supabase.from('profiles').select('id, photo_url').in('id', ids)
          : { data: [] as any[] };
        const photoById = Object.fromEntries((profiles || []).map((p: any) => [p.id, p.photo_url]));

        if (!active) return;
        setStudents(
          ids.map((id) => {
            const s = byStudent.get(id)!;
            return { id, name: s.name, photo: photoById[id] || null, lessonCount: s.count, lastDateLabel: s.lastDateLabel };
          })
        );
        setLoading(false);
      });

      return () => {
        active = false;
      };
    }, [profile])
  );

  async function openChat(studentId: string) {
    if (!profile || openingId) return;
    setOpeningId(studentId);
    const conversation = await getOrCreateConversation(profile.id, 'teacher', studentId);
    setOpeningId(null);
    if (!conversation) return;
    const student = students.find((s) => s.id === studentId);
    router.push({
      pathname: '/chat/[id]',
      params: { id: conversation.id, otherName: student?.name || 'Öğrenci', otherPhoto: student?.photo ?? '' },
    });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.headerBlock}>
        <Text style={styles.title}>Öğrencilerim</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.gold3} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={students}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, { opacity: pressed ? 0.9 : 1 }]}
              onPress={() => openChat(item.id)}
              disabled={openingId === item.id}
            >
              {item.photo ? (
                <Image source={{ uri: item.photo }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarInitial}>{item.name[0]?.toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>
                  {item.lessonCount} ders · son {item.lastDateLabel}
                </Text>
              </View>
              <Text style={styles.msgLink}>{openingId === item.id ? '…' : '✉'}</Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>Henüz bir rezervasyonun yok — öğrencilerin burada listelenecek.</Text>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.panel2,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.ink,
  },
  name: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 15,
    color: colors.ink,
  },
  meta: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 2,
  },
  msgLink: {
    fontSize: 18,
    color: colors.goldText,
  },
  empty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 40,
    paddingHorizontal: 20,
  },
});
