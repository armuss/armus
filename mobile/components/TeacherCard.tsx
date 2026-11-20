import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { shortDisplayName } from '../lib/displayName';
import { colors, fonts, radius } from '../lib/theme';
import { isTeacherOnline } from '../lib/teachers';
import type { Teacher } from '../lib/teachers-data';
import { useT } from '../lib/i18n';

type Props = {
  teacher: Teacher;
  width: number;
  onPress?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
};

/** Photo tile for the two-column Keşfet grid: rating, heart, name, main topic and price. */
export default function TeacherCard({ teacher, width, onPress, isFavorite, onToggleFavorite }: Props) {
  const t = useT();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, { width, opacity: pressed ? 0.92 : 1 }]}>
      <TeacherPhoto teacher={teacher} style={StyleSheet.absoluteFill} initialsSize={40} />
      <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)']} style={styles.shade} />
      <View style={styles.rating}>
        <Text style={styles.ratingText}>{teacher.rating ? `★ ${teacher.rating.toFixed(1)}` : t("Yeni")}</Text>
      </View>
      {onToggleFavorite && (
        <Pressable
          onPress={onToggleFavorite}
          hitSlop={10}
          style={styles.heart}
          accessibilityLabel={isFavorite ? t("Favorilerden çıkar") : t("Favorilere ekle")}
        >
          <Ionicons name={isFavorite ? 'heart' : 'heart-outline'} size={17} color={isFavorite ? colors.red : colors.ink} />
        </Pressable>
      )}
      <View style={styles.text}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {shortDisplayName(teacher.name)}
          </Text>
          {/* teachers.html's online dot: green with a check, not colour alone */}
          {isTeacherOnline(teacher) && (
            <View style={styles.online} accessible accessibilityRole="image" accessibilityLabel={t("Öğretmen şu an çevrimiçi")}>
              <Ionicons name="checkmark" size={9} color="#fff" />
            </View>
          )}
        </View>
        <View style={styles.meta}>
          <Text style={styles.topic} numberOfLines={1}>
            {t(teacher.tags[0] ?? teacher.role)}
          </Text>
          <Text style={styles.price}>₺{teacher.price}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export function TeacherPhoto({ teacher, style, initialsSize = 18 }: { teacher: Teacher; style: any; initialsSize?: number }) {
  // a photo that doesn't load (deleted from storage, no connection) left a
  // blank tile - the initials stand in, like a teacher with no photo
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [teacher.photo]);
  if (teacher.photo && !failed)
    return <Image source={{ uri: teacher.photo }} style={[style, styles.photoBg]} resizeMode="cover" onError={() => setFailed(true)} />;
  return (
    <View style={[style, styles.photoBg, styles.fallback]}>
      <Text style={[styles.fallbackText, { fontSize: initialsSize }]}>{teacher.initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    height: 232,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.panel2,
    marginBottom: 10,
  },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '52%' },
  photoBg: { backgroundColor: colors.panel2 },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackText: { fontFamily: fonts.display, color: colors.faint },
  rating: {
    position: 'absolute',
    left: 9,
    top: 9,
    backgroundColor: 'rgba(255,255,255,0.93)',
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  ratingText: { fontFamily: fonts.bodyExtraBold, fontSize: 11.5, color: colors.ink },
  heart: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { position: 'absolute', left: 11, right: 11, bottom: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { fontFamily: fonts.bodyExtraBold, fontSize: 15, color: '#fff', flexShrink: 1 },
  online: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#3ecf7a',
    borderWidth: 1.5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 1 },
  topic: { fontFamily: fonts.bodySemibold, fontSize: 12, color: 'rgba(255,255,255,0.85)', flexShrink: 1 },
  price: { fontFamily: fonts.bodyExtraBold, fontSize: 12.5, color: '#fff' },
});
