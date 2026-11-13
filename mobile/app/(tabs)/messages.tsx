import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScrollBand } from '../../components/Band';
import Button from '../../components/Button';
import { useAuth } from '../../lib/auth';
import { capitalizeName, shortDisplayName } from '../../lib/displayName';
import { getConversations, type Conversation } from '../../lib/messages';
import { colors, fonts, radius } from '../../lib/theme';

export default function Messages() {
  const { profile } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  // The other participant in any conversation here is a teacher exactly
  // when the viewer is a student (conversations are always
  // student<->teacher) - so their full name never shows, only "Ahmet Y.".
  const displayName = (name: string) => (profile?.role === 'student' ? shortDisplayName(name) : capitalizeName(name));

  useFocusEffect(
    useCallback(() => {
      if (!profile) return;
      getConversations(profile.id).then((data) => {
        setConversations(data);
        setLoading(false);
      });
    }, [profile])
  );

  return (
    // the title is fixed on plain red; the band's fade scrolls with the list
    <SafeAreaView style={styles.safeRed} edges={['top']}>
      <View style={styles.headerBlock}>
        <Text style={styles.title}>Mesajlar</Text>
        <Text style={styles.sub}>{profile?.role === 'teacher' ? 'Öğrencilerinle ve ARMUS destekle' : 'Öğretmenlerinle ve ARMUS destekle'}</Text>
      </View>

      {loading ? (
        <View style={styles.list}>
          <ScrollBand height={0} />
          <ActivityIndicator color={colors.red} style={{ marginTop: 60 }} />
        </View>
      ) : (
        <FlatList
          style={styles.list}
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
                  <Text style={styles.avatarInitial}>{item.otherName[0]?.toUpperCase()}</Text>
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
                  {item.lastMessageText || 'Henüz mesaj yok'}
                </Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Hiç sorun yok mu?</Text>
              <Text style={styles.emptyText}>
                Burada öğretmenlerine istediğini sorabilir, öğrenme hedeflerini konuşabilirsin.
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
});
