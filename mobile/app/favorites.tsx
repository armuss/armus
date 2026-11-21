import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Band from '../components/Band';
import SimpleHeader from '../components/SimpleHeader';
import TeacherCard from '../components/TeacherCard';
import { getFavorites, setFavorite } from '../lib/favorites';
import { loadMarketplaceTeachers } from '../lib/teachers';
import type { Teacher } from '../lib/teachers-data';
import { colors, fonts, radius } from '../lib/theme';
import { useT } from '../lib/i18n';

/** Favori öğretmenlerim: the teachers the student hearted, as the Keşfet photo grid. */
export default function Favorites() {
  const t = useT();
  const [teachers, setTeachers] = useState<Teacher[] | null>(null);
  // without a connection only the demo teachers load: a favourite real
  // teacher went missing and the page could say "no favourites yet"
  const [incomplete, setIncomplete] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const { width } = useWindowDimensions();
  const tileW = Math.floor((width - 32 - 10) / 2);

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const list = await loadMarketplaceTeachers();
    const ids = await getFavorites();
    if (seq !== loadSeq.current) return;
    setTeachers(ids.map((id) => list.teachers.find((t) => t.id === id)).filter((t): t is Teacher => !!t));
    setIncomplete(!list.complete && ids.some((id) => !list.teachers.some((t) => t.id === id)));
    setRetrying(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        // a load still on its way when the screen is left doesn't land
        loadSeq.current++;
      };
    }, [load])
  );

  // set, not toggled: a double tap on the heart put the teacher back in
  // storage while the screen had already taken it off
  function unfavorite(id: string) {
    setTeachers((prev) => (prev ?? []).filter((t) => t.id !== id));
    setFavorite(id, false);
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
            ListHeaderComponent={
              incomplete ? (
                <View style={styles.failRow}>
                  <Ionicons name="cloud-offline-outline" size={16} color={colors.red} />
                  <Text style={styles.failText}>{t("Bazı öğretmenler yüklenemedi.")}</Text>
                  <Pressable
                    onPress={() => {
                      setRetrying(true);
                      load();
                    }}
                    disabled={retrying}
                    hitSlop={8}
                  >
                    <Text style={styles.failRetry}>{t("Tekrar dene")}</Text>
                  </Pressable>
                </View>
              ) : undefined
            }
            renderItem={({ item }) => (
              <TeacherCard teacher={item} width={tileW} onPress={() => router.push(`/teacher/${item.id}`)} isFavorite onToggleFavorite={() => unfavorite(item.id)} />
            )}
            ListEmptyComponent={
              incomplete ? undefined : (
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
              )
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
  failRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 },
  failText: { flexShrink: 1, fontFamily: fonts.bodySemibold, fontSize: 13, color: colors.muted },
  failRetry: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.red, textDecorationLine: 'underline' },
  empty: { alignItems: 'center', marginTop: 70, paddingHorizontal: 24, gap: 10 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: fonts.display, fontSize: 18, color: colors.ink, marginTop: 4 },
  emptyText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: 'center' },
  btn: { marginTop: 8, height: 48, borderRadius: radius.md, backgroundColor: colors.red, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: fonts.bodyExtraBold, fontSize: 14.5, color: colors.onRed },
});
