import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, AppState, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScrollBand } from '../../components/Band';
import Button from '../../components/Button';
import { useAuth } from '../../lib/auth';
import { capitalizeName, shortDisplayName } from '../../lib/displayName';
import { getConversations, type Conversation } from '../../lib/messages';
import { colors, fonts, radius } from '../../lib/theme';
import { useT } from '../../lib/i18n';

export default function Messages() {
  const t = useT();
  const { profile } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const focused = useRef(false);

  // The other participant in any conversation here is a teacher exactly
  // when the viewer is a student (conversations are always
  // student<->teacher) - so their full name never shows, only "Ahmet Y.".
  const displayName = (name: string) => (profile?.role === 'student' ? shortDisplayName(name) : capitalizeName(name));

  const load = useCallback(async () => {
    if (!profile) return;
    const data = await getConversations(profile.id);
    setLoading(false);
    setRefreshing(false);
    if (data === null) {
      // a failed load used to show "no messages yet" - the list on screen
      // stays, an empty one says it failed
      setLoadError(true);
      return;
    }
    setLoadError(false);
    setConversations(data);
  }, [profile]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      load();
      return () => {
        focused.current = false;
      };
    }, [load])
  );

  // new messages that came in while the app was in the background show
  // when it comes back, not only after switching tabs
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && focused.current) load();
    });
    return () => sub.remove();
  }, [load]);

  return (
    // the title is fixed on plain red; the band's fade scrolls with the list
    <SafeAreaView style={styles.safeRed} edges={['top']}>
      <View style={styles.headerBlock}>
        <Text style={styles.title}>{t("Mesajlar")}</Text>
        <Text style={styles.sub}>{profile?.role === 'teacher' ? t("Öğrencilerinle ve ARMUS destekle") : t("Öğretmenlerinle ve ARMUS destekle")}</Text>
      </View>

      {loading ? (
        // clipped: the band reaches 600px up and painted over the title
        // while the list loaded
        <View style={[styles.list, styles.clip]}>
          <ScrollBand height={0} />
          <ActivityIndicator color={colors.red} style={{ marginTop: 60 }} />
        </View>
      ) : loadError && !conversations.length ? (
        <View style={[styles.list, styles.clip]}>
          <ScrollBand height={0} />
          <View style={styles.errorBox}>
            <Text style={styles.emptyText}>{t("Mesajlar yüklenemedi. İnternet bağlantını kontrol edip tekrar dene.")}</Text>
            <View style={styles.emptyBtn}>
              <Button
                label={t("Tekrar dene")}
                onPress={() => {
                  setLoading(true);
                  load();
                }}
              />
            </View>
          </View>
        </View>
      ) : (
        <FlatList
          extraData={t}
          style={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              // iOS draws it over the red band above the list - in red it was invisible
              tintColor={colors.onRed}
              colors={[colors.red]}
            />
          }
          ListHeaderComponent={<ScrollBand height={conversations.length ? 40 : 0} />}
          data={conversations}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.row, { opacity: pressed ? 0.9 : 1 }]}
              onPress={() =>
                router.push({
                  pathname: '/chat/[id]',
                  params: { id: item.id, otherName: displayName(item.otherName), otherPhoto: item.otherPhoto ?? '' },
                })
              }
            >
              {item.otherPhoto ? (
                <Image source={{ uri: item.otherPhoto }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarInitial}>{(item.otherName || '?')[0]?.toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <View style={styles.rowTop}>
                  <Text style={styles.name}>{displayName(item.otherName)}</Text>
                  {item.unreadCount > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.unreadCount}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.preview} numberOfLines={1}>
                  {item.lastMessageText || t("Henüz mesaj yok")}
                </Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            // a teacher was told to "find a teacher" here, a button that
            // only led back to their own Bugün tab
            profile?.role === 'teacher' ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>{t("Henüz mesajın yok")}</Text>
                <Text style={styles.emptyText}>
                  {t("Öğrencilerin sana buradan yazabilir. Bir öğrencine yazmak için Öğrenciler sekmesini kullan.")}</Text>
                <View style={styles.emptyBtn}>
                  <Button label={t("Öğrencilerim")} onPress={() => router.push('/(tabs)/students')} />
                </View>
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>{t("Hiç sorun yok mu?")}</Text>
                <Text style={styles.emptyText}>
                  {t("Burada öğretmenlerine istediğini sorabilir, öğrenme hedeflerini konuşabilirsin.")}</Text>
                <View style={styles.emptyBtn}>
                  <Button label={t("Öğretmen bul")} onPress={() => router.push('/(tabs)')} />
                </View>
              </View>
            )
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
  // the status bar and title are plain red; the list paints the ground and carries the band
  safeRed: { flex: 1, backgroundColor: colors.red },
  list: { flex: 1, backgroundColor: colors.bg },
  clip: { overflow: 'hidden' },
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
  // every conversation is a white card on the band / the champagne ground
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
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  name: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 15,
    color: colors.ink,
  },
  preview: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  badge: {
    backgroundColor: colors.gold3,
    borderRadius: radius.pill,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.onGold,
  },
  empty: {
    alignItems: 'flex-start',
    marginTop: 90,
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
  errorBox: {
    paddingHorizontal: 20,
    marginTop: 60,
  },
});
