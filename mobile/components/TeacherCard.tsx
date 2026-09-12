import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { shortDisplayName } from '../lib/displayName';
import { colors, fonts, radius } from '../lib/theme';
import type { Teacher } from '../lib/teachers-data';

export default function TeacherCard({ teacher, onPress }: { teacher: Teacher; onPress?: () => void }) {
  const isPopular = teacher.reviewCount > 100;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, { opacity: pressed ? 0.9 : 1 }]}>
      <View style={styles.topRow}>
        {teacher.photo ? (
          <Image source={{ uri: teacher.photo }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoFallback]}>
            <Text style={styles.photoFallbackText}>{teacher.initials}</Text>
          </View>
        )}
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{shortDisplayName(teacher.name)}</Text>
            <View style={styles.verifiedBadge}>
              <Text style={styles.verifiedCheck}>✓</Text>
            </View>
          </View>
          <View style={styles.ratingRow}>
            <Text style={styles.ratingText}>{teacher.rating ? `★ ${teacher.rating.toFixed(1)}` : 'Yeni'}</Text>
            {teacher.reviewCount > 0 && <Text style={styles.reviewCount}>({teacher.reviewCount} yorum)</Text>}
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.price}>₺{teacher.price}</Text>
            <Text style={styles.priceUnit}> / 50 dk ders</Text>
          </View>
        </View>
      </View>

      {!!teacher.level && (
        <View style={styles.levelBadge}>
          <Text style={styles.levelBadgeText}>{teacher.level} Seviye</Text>
        </View>
      )}

      <Text style={styles.bio} numberOfLines={2}>
        {teacher.about[0]}
      </Text>

      <Text style={styles.stats}>
        {teacher.students} öğrenci · {teacher.completedLessons} ders
      </Text>

      <View style={styles.tagRow}>
        {teacher.tags.slice(0, 3).map((tag) => (
          <View key={tag} style={styles.tag}>
            <Text style={styles.tagText}>{tag}</Text>
          </View>
        ))}
      </View>

      {isPopular && (
        <View style={styles.popularBanner}>
          <Text style={styles.popularBannerText}>⚡ Süper popüler · sık tercih ediliyor</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    overflow: 'hidden',
    marginBottom: 14,
    padding: 14,
  },
  topRow: {
    flexDirection: 'row',
    gap: 12,
  },
  photo: {
    width: 74,
    height: 74,
    borderRadius: radius.md,
    backgroundColor: colors.panel2,
  },
  photoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoFallbackText: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 20,
    color: colors.muted,
  },
  info: {
    flex: 1,
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 16,
    color: colors.ink,
  },
  verifiedBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedCheck: {
    color: '#fff',
    fontSize: 10,
    fontFamily: fonts.bodyBold,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  ratingText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.goldText,
  },
  reviewCount: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 4,
  },
  price: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 15,
    color: colors.ink,
  },
  priceUnit: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  levelBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.panel2,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 12,
  },
  levelBadgeText: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.muted,
  },
  bio: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
    marginTop: 10,
  },
  stats: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.faint,
    marginTop: 8,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  tag: {
    backgroundColor: colors.panel2,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  tagText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11.5,
    color: colors.muted,
  },
  popularBanner: {
    backgroundColor: '#fff8e6',
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 12,
  },
  popularBannerText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 12,
    color: colors.goldText,
  },
});
