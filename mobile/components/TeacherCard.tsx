import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius } from '../lib/theme';
import type { Teacher } from '../lib/teachers-data';

export default function TeacherCard({ teacher, onPress }: { teacher: Teacher; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, { opacity: pressed ? 0.9 : 1 }]}>
      <Image source={{ uri: teacher.photo }} style={styles.photo} />
      <View style={styles.body}>
        <View style={styles.headerRow}>
          <Text style={styles.name}>{teacher.name}</Text>
          <View style={styles.ratingPill}>
            <Text style={styles.ratingText}>★ {teacher.rating.toFixed(1)}</Text>
          </View>
        </View>
        <Text style={styles.role} numberOfLines={1}>{teacher.role}</Text>
        <View style={styles.tagRow}>
          {teacher.tags.slice(0, 3).map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
        <View style={styles.footerRow}>
          <Text style={styles.price}>
            ₺{teacher.price} <Text style={styles.priceUnit}>/ ders</Text>
          </Text>
          <Text style={styles.availability} numberOfLines={1}>{teacher.availability}</Text>
        </View>
      </View>
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
  },
  photo: {
    width: '100%',
    height: 160,
    backgroundColor: colors.panel2,
  },
  body: {
    padding: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  name: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 16,
    color: colors.ink,
  },
  ratingPill: {
    backgroundColor: colors.panel2,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  ratingText: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    color: colors.goldText,
  },
  role: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
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
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
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
  availability: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11.5,
    color: colors.success,
    flexShrink: 1,
    textAlign: 'right',
  },
});
