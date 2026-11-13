import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Band from '../components/Band';
import SimpleHeader from '../components/SimpleHeader';
import TeacherCard from '../components/TeacherCard';
import { getFavorites, toggleFavorite } from '../lib/favorites';
import { getMarketplaceTeachers } from '../lib/teachers';
import type { Teacher } from '../lib/teachers-data';
import { colors, fonts, radius } from '../lib/theme';
import { useT } from '../lib/i18n';

/** Favori öğretmenlerim: the teachers the student hearted, as the Keşfet photo grid. */
export default function Favorites() {
  const t = useT();
  const [teachers, setTeachers] = useState<Teacher[] | null>(null);
  const { width } = useWindowDimensions();
  const tileW = Math.floor((width - 32 - 10) / 2);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      Promise.all([getFavorites(), getMarketplaceTeachers()]).then(([ids, all]) => {
        if (alive) setTeachers(ids.map((id) => all.find((t) => t.id === id)).filter((t): t is Teacher => !!t));
      });
      return () => {
        alive = false;
      };
    }, [])
  );

  async function unfavorite(id: string) {
    await toggleFavorite(id);
    setTeachers((prev) => (prev ?? []).filter((t) => t.id !== id));
  }

  return (
    <View style={styles.screen}>
      <Band height={70} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SimpleHeader title={t("Favori öğretmenlerim")} sub={teachers?.length ? t("{0} öğretmen", teachers.length) : undefined} />
        {teachers === null ? (
          <ActivityIndicator color={colors.onRed} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
          extraData={t}
            data={teachers}
            numColumns={2}
            keyExtractor={(t) => t.id}
            columnWrapperStyle={{ gap: 10 }}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <TeacherCard teacher={item} width={tileW} onPress={() => router.push(`/teacher/${item.id}`)} isFavorite onToggleFavorite={() => unfavorite(item.id)} />
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="heart-outline" size={28} color={colors.red} />
                </View>
                <Text style={styles.emptyTitle}>{t("Henüz favorin yok")}</Text>
                <Text style={styles.emptyText}>{t("Keşfet'te bir öğretmenin fotoğrafındaki kalbe dokunarak buraya ekleyebilirsin.")}</Text>
                <Pressable onPress={() => router.navigate('/(tabs)')} style={styles.btn}>
                  <Text style={styles.btnText}>{t("Öğretmenlere göz at")}</Text>
                </Pressable>
              </View>
            }
          />
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1, backgroundColor: 'transparent' },
  list: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 30 },
  empty: { alignItems: 'center', marginTop: 70, paddingHorizontal: 24, gap: 10 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: fonts.display, fontSize: 18, color: colors.ink, marginTop: 4 },
  emptyText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: 'center' },
  btn: { marginTop: 8, height: 48, borderRadius: radius.md, backgroundColor: colors.red, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: fonts.bodyExtraBold, fontSize: 14.5, color: colors.onRed },
});
