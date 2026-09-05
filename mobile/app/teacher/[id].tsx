import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../../components/Button';
import { TEACHERS } from '../../lib/teachers-data';
import { colors, fonts, radius } from '../../lib/theme';

export default function TeacherDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const teacher = TEACHERS.find((t) => t.id === id);
  const [noticeVisible, setNoticeVisible] = useState(false);

  if (!teacher) {
    return (
      <SafeAreaView style={styles.screen}>
        <Text style={styles.notFound}>Öğretmen bulunamadı.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Geri</Text>
        </Pressable>

        <Image source={{ uri: teacher.photo }} style={styles.photo} />

        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{teacher.name}</Text>
            <Text style={styles.role}>{teacher.role}</Text>
          </View>
          <View style={styles.ratingBlock}>
            <Text style={styles.ratingValue}>★ {teacher.rating.toFixed(1)}</Text>
            <Text style={styles.ratingCount}>{teacher.reviewCount} değerlendirme</Text>
          </View>
        </View>

        <View style={styles.tagRow}>
          {teacher.tags.map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>

        <View style={styles.statGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{teacher.experience}</Text>
            <Text style={styles.statLabel}>Deneyim</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{teacher.completedLessons}</Text>
            <Text style={styles.statLabel}>Tamamlanan ders</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{teacher.students}</Text>
            <Text style={styles.statLabel}>Öğrenci</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Hakkında</Text>
        {teacher.about.map((p, i) => (
          <Text key={i} style={styles.paragraph}>{p}</Text>
        ))}

        <Text style={styles.sectionTitle}>Uzmanlık alanları</Text>
        <View style={styles.tagRow}>
          {teacher.specialties.map((s) => (
            <View key={s} style={styles.tag}>
              <Text style={styles.tagText}>{s}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Değerlendirmeler</Text>
        {teacher.reviews.map((r, i) => (
          <View key={i} style={styles.reviewCard}>
            <View style={styles.reviewHeader}>
              <Text style={styles.reviewName}>{r.name}</Text>
              <Text style={styles.reviewStars}>{'★'.repeat(r.stars)}</Text>
            </View>
            <Text style={styles.reviewText}>{r.text}</Text>
          </View>
        ))}

        {noticeVisible && (
          <Text style={styles.notice}>
            Rezervasyon ve ödeme yakında uygulama içinden yapılabilecek — şu an için siteden devam edebilirsin.
          </Text>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <View>
          <Text style={styles.price}>₺{teacher.price}</Text>
          <Text style={styles.priceUnit}>/ ders</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 16 }}>
          <Button label="Deneme Dersi Al" onPress={() => setNoticeVisible(true)} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },
  notFound: {
    fontFamily: fonts.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 60,
  },
  backBtn: {
    marginBottom: 12,
  },
  backText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13.5,
    color: colors.muted,
  },
  photo: {
    width: '100%',
    height: 220,
    borderRadius: radius.lg,
    backgroundColor: colors.panel2,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  name: {
    fontFamily: fonts.display,
    fontSize: 23,
    color: colors.ink,
    letterSpacing: -0.5,
  },
  role: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    marginTop: 2,
  },
  ratingBlock: {
    alignItems: 'flex-end',
  },
  ratingValue: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 16,
    color: colors.goldText,
  },
  ratingCount: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.muted,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  tag: {
    backgroundColor: colors.panel2,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  tagText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12.5,
    color: colors.muted,
  },
  statGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
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
    fontSize: 15,
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
    fontSize: 16,
    color: colors.ink,
    marginTop: 26,
    marginBottom: 10,
  },
  paragraph: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 21,
    marginBottom: 10,
  },
  reviewCard: {
    backgroundColor: colors.panel,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 14,
    marginBottom: 10,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  reviewName: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: colors.ink,
  },
  reviewStars: {
    fontSize: 12,
    color: colors.gold3,
  },
  reviewText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
  },
  notice: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.goldText,
    backgroundColor: '#fff8e6',
    borderRadius: radius.md,
    padding: 12,
    marginTop: 20,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    backgroundColor: colors.panel,
  },
  price: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 20,
    color: colors.ink,
  },
  priceUnit: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.muted,
  },
});
