import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScrollBand } from '../../components/Band';
import { useAuth } from '../../lib/auth';
import { BLOCK_REASONS, blockStudent, getBlockedStudents, unblockStudent, type BlockReason } from '../../lib/blocks';
import { getBookingsForTeacher } from '../../lib/bookings';
import { getOrCreateConversation } from '../../lib/messages';
import { supabase } from '../../lib/supabase';
import { capitalizeName } from '../../lib/displayName';
import { colors, fonts, radius } from '../../lib/theme';
import { useT } from '../../lib/i18n';

type StudentSummary = {
  id: string;
  name: string;
  photo: string | null;
  lessonCount: number;
  lastDateLabel: string;
};

export default function Students() {
  const t = useT();
  const { profile } = useAuth();
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  // the website's "Engelle" (teacher-blocks.js): blocked students can't
  // book or message this teacher; their upcoming lessons are cancelled
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [blockTarget, setBlockTarget] = useState<StudentSummary | null>(null);
  const [blockReason, setBlockReason] = useState<BlockReason>('harassment');
  const [blockNote, setBlockNote] = useState('');
  const [blocking, setBlocking] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!profile) return;
      let active = true;
      setLoading(true);

      getBlockedStudents(profile.id).then((set) => active && setBlocked(set));
      getBookingsForTeacher(profile.id).then(async (bookings) => {
        if (!active) return;

        const byStudent = new Map<string, { name: string; count: number; lastDateLabel: string }>();
        bookings.forEach((b) => {
          const existing = byStudent.get(b.studentId);
          if (existing) {
            existing.count += 1;
            existing.lastDateLabel = b.dateLabel;
          } else {
            byStudent.set(b.studentId, { name: capitalizeName(b.studentName), count: 1, lastDateLabel: b.dateLabel });
          }
        });

        const ids = Array.from(byStudent.keys());
        // masked_profiles, not the raw profiles table - migration_70.sql
        // removed the raw table's conversation-partner read grant since
        // it exposed a student's/teacher's full row (email, phone,
        // certificate_file_url), not just the photo this screen needs.
        const { data: profiles } = ids.length
          ? await supabase.from('masked_profiles').select('id, photo_url').in('id', ids)
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
      params: { id: conversation.id, otherName: student?.name || t("Öğrenci", 1), otherPhoto: student?.photo ?? '' },
    });
  }

  function openStudentMenu(student: StudentSummary) {
    if (!profile) return;
    if (blocked.has(student.id)) {
      Alert.alert(t("Engeli kaldır"), t("Bu öğrencinin engelini kaldırmak istediğine emin misin?"), [
        { text: t("Vazgeç"), style: 'cancel' },
        {
          text: t("Engeli Kaldır"),
          onPress: async () => {
            const ok = await unblockStudent(profile.id, student.id);
            if (!ok) {
              Alert.alert(t("İşlem başarısız oldu, tekrar dene."));
              return;
            }
            setBlocked((prev) => {
              const next = new Set(prev);
              next.delete(student.id);
              return next;
            });
          },
        },
      ]);
      return;
    }
    setBlockReason('harassment');
    setBlockNote('');
    setBlockTarget(student);
  }

  async function confirmBlock() {
    if (!profile || !blockTarget || blocking) return;
    setBlocking(true);
    const result = await blockStudent(profile.id, blockTarget.id, blockReason, blockNote.trim() || undefined);
    setBlocking(false);
    if (!result.ok) {
      Alert.alert(t("İşlem başarısız oldu, tekrar dene."));
      return;
    }
    const id = blockTarget.id;
    setBlocked((prev) => new Set(prev).add(id));
    setBlockTarget(null);
    if (result.cancelledCount > 0) {
      Alert.alert(
        t("Öğrenci engellendi"),
        t("Bu öğrenciyle aranızdaki {0} ders otomatik iptal edildi ve kendisine ders hakkı olarak geri verildi.", result.cancelledCount)
      );
    }
  }

  return (
    // the title is fixed on plain red; the band's fade scrolls with the list
    <SafeAreaView style={styles.safeRed} edges={['top']}>
      <View style={styles.headerBlock}>
        <Text style={styles.title}>{t("Öğrencilerim")}</Text>
        {!loading && (
          <Text style={styles.sub}>{students.length ? t("{0} öğrenci", students.length) : t("Henüz öğrencin yok")}</Text>
        )}
      </View>

      {loading ? (
        <View style={styles.list}>
          <ScrollBand height={0} />
          <ActivityIndicator color={colors.red} style={{ marginTop: 60 }} />
        </View>
      ) : (
        <FlatList
          extraData={t}
          style={styles.list}
          ListHeaderComponent={<ScrollBand height={students.length ? 40 : 0} />}
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
                <Text style={styles.name}>
                  {item.name}
                  {blocked.has(item.id) && <Text style={styles.blockedTag}>  {t("  · Engellendi")}</Text>}
                </Text>
                <Text style={styles.meta}>
                  {t("{0} ders · son {1}", item.lessonCount, item.lastDateLabel)}</Text>
              </View>
              <Pressable
                onPress={() => openStudentMenu(item)}
                hitSlop={8}
                style={styles.moreBtn}
                accessibilityLabel={blocked.has(item.id) ? t("Engeli kaldır") : t("Öğrenciyi engelle")}
              >
                <Ionicons name={blocked.has(item.id) ? 'lock-open-outline' : 'ban-outline'} size={17} color={colors.muted} />
              </Pressable>
              <View style={styles.msgLink}>
                {openingId === item.id ? (
                  <ActivityIndicator size="small" color={colors.ink} />
                ) : (
                  <Ionicons name="chatbubble-outline" size={17} color={colors.red} />
                )}
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>{t("Henüz bir rezervasyonun yok — öğrencilerin burada listelenecek.")}</Text>
          }
        />
      )}

      <Modal visible={!!blockTarget} transparent animationType="slide" onRequestClose={() => setBlockTarget(null)}>
        <Pressable style={styles.shade} onPress={() => setBlockTarget(null)} />
        <View style={styles.sheet}>
          <View style={styles.grab} />
          <Text style={styles.sheetTitle}>{t("Öğrenciyi Engelle")}</Text>
          <Text style={styles.sheetIntro}>
            {t("Engellersen bu öğrenci seninle yeni bir ders rezervasyonu yapamaz, sana mesaj gönderemez ve aranızdaki henüz başlamamış dersler otomatik iptal edilip kendisine ders hakkı olarak geri verilir.")}</Text>
          {BLOCK_REASONS.map((r) => (
            <Pressable key={r.value} onPress={() => setBlockReason(r.value)} style={[styles.reason, blockReason === r.value && styles.reasonOn]}>
              <View style={[styles.radio, blockReason === r.value && styles.radioOn]}>{blockReason === r.value && <View style={styles.radioDot} />}</View>
              <Text style={styles.reasonText}>{t(r.label)}</Text>
            </Pressable>
          ))}
          {blockReason === 'other' && (
            <TextInput
              value={blockNote}
              onChangeText={setBlockNote}
              placeholder={t("Kısaca açıklar mısın? (isteğe bağlı)")}
              placeholderTextColor={colors.faint}
              style={styles.noteInput}
              multiline
            />
          )}
          <View style={styles.sheetBtns}>
            <Pressable onPress={() => setBlockTarget(null)} style={[styles.sheetBtn, styles.sheetBtnLight]}>
              <Text style={styles.sheetBtnLightText}>{t("Vazgeç")}</Text>
            </Pressable>
            <Pressable onPress={confirmBlock} disabled={blocking} style={[styles.sheetBtn, styles.sheetBtnRed]}>
              {blocking ? <ActivityIndicator color={colors.onRed} /> : <Text style={styles.sheetBtnRedText}>{t("Engelle")}</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  blockedTag: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.error },
  moreBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  shade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(20,6,8,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 34 },
  grab: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.silver2, alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.ink, letterSpacing: -0.5 },
  sheetIntro: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.muted, marginTop: 6, marginBottom: 12 },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, marginBottom: 8 },
  reasonOn: { borderColor: colors.red },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.red },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.red },
  reasonText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.ink, flex: 1 },
  noteInput: { minHeight: 70, borderRadius: 14, borderWidth: 1, borderColor: '#e8ddcc', backgroundColor: colors.panel, padding: 12, fontFamily: fonts.body, fontSize: 14, color: colors.ink, textAlignVertical: 'top' },
  sheetBtns: { flexDirection: 'row', gap: 10, marginTop: 14 },
  sheetBtn: { flex: 1, height: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  sheetBtnLight: { backgroundColor: colors.panel, borderWidth: 1, borderColor: '#e2d6c3' },
  sheetBtnLightText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  sheetBtnRed: { backgroundColor: colors.red },
  sheetBtnRedText: { fontFamily: fonts.bodyExtraBold, fontSize: 15, color: colors.onRed },
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // the status bar and title are plain red; the list paints the ground and carries the band
  safeRed: { flex: 1, backgroundColor: colors.red },
  list: { flex: 1, backgroundColor: colors.bg },
  headerBlock: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.onRed,
    letterSpacing: -0.8,
  },
  sub: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13.5,
    color: 'rgba(250,245,226,0.85)',
    marginTop: 4,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  // every student is a white card on the band / the champagne ground
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    marginBottom: 8,
    borderRadius: 18,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
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
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.redSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 100,
    paddingHorizontal: 20,
  },
});
