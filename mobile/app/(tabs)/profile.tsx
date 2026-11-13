import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScrollBand } from '../../components/Band';
import { useAuth } from '../../lib/auth';
import { getAvailableCredits } from '../../lib/credits';
import { capitalizeName, capitalizeTurkish, shortDisplayName } from '../../lib/displayName';
import { getFavorites } from '../../lib/favorites';
import { getPushEnabled, setPushEnabled } from '../../lib/push';
import { SITE_URL } from '../../lib/referrals';
import { getMarketplaceTeachers } from '../../lib/teachers';
import { colors, fonts, radius } from '../../lib/theme';
import { getVocabEntries, type VocabEntry } from '../../lib/vocab';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Profil (design 1, "a calm list"): the person on the red band, the word
 * cards, four shortcuts and the settings in tidy groups. A teacher gets the
 * same page with their own two shortcuts instead of the student tools.
 */
export default function Profile() {
  const { profile, signOut, deleteAccount } = useAuth();
  const isStudent = profile?.role !== 'teacher';
  const [deleting, setDeleting] = useState(false);
  const [headBottom, setHeadBottom] = useState(230);
  const [vocab, setVocab] = useState<VocabEntry[] | null>(null);
  const [credits, setCredits] = useState<{ count: number; teachers: string[] } | null>(null);
  const [favorites, setFavorites] = useState<{ count: number; photos: string[] }>({ count: 0, photos: [] });
  const [pushOn, setPushOn] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getPushEnabled().then((on) => alive && setPushOn(on));
      if (profile && isStudent) {
        getVocabEntries(profile.id).then((list) => alive && setVocab(list ?? []));
        getAvailableCredits(profile.id).then((list) => {
          if (!alive || !list) return;
          setCredits({ count: list.length, teachers: [...new Set(list.map((c) => shortDisplayName(c.teacher_name)))] });
        });
        getFavorites().then(async (ids) => {
          if (!alive) return;
          setFavorites((prev) => ({ count: ids.length, photos: ids.length ? prev.photos : [] }));
          if (!ids.length) return;
          // counted from the teachers that still exist, like the favourites page
          const teachers = await getMarketplaceTeachers();
          const found = ids.map((id) => teachers.find((t) => t.id === id)).filter((t) => !!t);
          const photos = found
            .map((t) => t!.photo)
            .filter((p): p is string => !!p)
            .slice(0, 3);
          if (alive) setFavorites({ count: found.length, photos });
        });
      }
      return () => {
        alive = false;
      };
    }, [profile?.id, isStudent])
  );

  function confirmDeleteAccount() {
    Alert.alert(
      'Hesabını silmek istediğine emin misin?',
      'Bu işlem geri alınamaz. Profilin, rezervasyonların, mesajların ve tüm verilerin kalıcı olarak silinir.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Hesabımı Sil',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            const result = await deleteAccount();
            setDeleting(false);
            if (!result.ok) {
              Alert.alert('Bir şeyler ters gitti', result.error);
              return;
            }
            router.replace('/welcome');
          },
        },
      ]
    );
  }

  function confirmSignOut() {
    Alert.alert('Çıkış yapmak istiyor musun?', undefined, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Çıkış Yap', style: 'destructive', onPress: () => signOut() },
    ]);
  }

  function explainEmailLock() {
    Alert.alert(
      'E-posta adresi değiştirilemez',
      'E-posta adresin hesabına bağlıdır. Yanlış bir adresle kaydolduysan ya da bu adrese artık erişemiyorsan bize ulaş.',
      [
        { text: 'Tamam', style: 'cancel' },
        { text: 'Bize ulaş', onPress: () => open('/iletisim') },
      ]
    );
  }

  async function togglePush(next: boolean) {
    setPushOn(next);
    await setPushEnabled(next);
  }

  const open = (path: string) => Linking.openURL(`${SITE_URL}${path}`);
  const city = capitalizeTurkish(profile?.city);
  const roleLine = [isStudent ? 'Öğrenci' : 'Öğretmen', city].filter(Boolean).join(' · ');

  const words = vocab ?? [];
  const learned = words.filter((w) => w.mastered).length;
  const studying = words.length - learned;
  const sample = words.find((w) => !w.mastered) ?? words[0];

  return (
    <SafeAreaView style={styles.safeRed} edges={['top']}>
      <ScrollView style={styles.list} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScrollBand height={headBottom + 30} />

        <View style={styles.head} onLayout={(e) => setHeadBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
          {profile?.photo_url ? (
            <Image source={{ uri: profile.photo_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitial}>{(profile?.name?.[0] || '?').toUpperCase()}</Text>
            </View>
          )}
          <Text style={styles.name}>{capitalizeName(profile?.name)}</Text>
          <Text style={styles.roleLine}>{roleLine}</Text>
          <Pressable onPress={() => router.push('/profile/edit')} style={styles.editPill} accessibilityRole="button">
            <Ionicons name="create-outline" size={14} color={colors.onRed} />
            <Text style={styles.editPillText}>Profili düzenle</Text>
          </Pressable>
        </View>

        {isStudent ? (
          <>
            {/* the word cards: how many, how many learned, one card peeking out */}
            <View style={styles.wordsCard}>
              <View style={styles.wordsTop}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.eyebrow}>KELİME KARTLARIM</Text>
                  <Text style={styles.wordsCount}>
                    {words.length}
                    <Text style={styles.wordsUnit}> kelime</Text>
                  </Text>
                  <Text style={styles.wordsMeta}>
                    {words.length === 0 ? (
                      'Derste öğrendiğin kelimeleri kartlara ekle, istediğin zaman çalış.'
                    ) : (
                      <>
                        <Text style={styles.wordsLearned}>{learned} öğrendin</Text> · {studying} çalışılıyor
                      </>
                    )}
                  </Text>
                  {words.length > 0 && (
                    <View style={styles.track}>
                      <View style={[styles.trackFill, { width: `${Math.round((learned / words.length) * 100)}%` }]} />
                    </View>
                  )}
                </View>
                {!!sample && (
                  <View style={styles.mini}>
                    <View style={[styles.miniCard, styles.miniBack1]} />
                    <View style={[styles.miniCard, styles.miniBack2]} />
                    <View style={[styles.miniCard, styles.miniFront]}>
                      <Text style={styles.miniTerm} numberOfLines={2} adjustsFontSizeToFit>
                        {sample.term}
                      </Text>
                      <Text style={styles.miniCat} numberOfLines={1}>
                        {sample.category}
                      </Text>
                    </View>
                  </View>
                )}
              </View>
              <View style={styles.wordsBtns}>
                {words.length > 0 ? (
                  <>
                    <Pressable onPress={() => router.push('/words')} style={[styles.btn, styles.btnRed, { flex: 1 }]}>
                      <Ionicons name="albums-outline" size={17} color={colors.onRed} />
                      <Text style={styles.btnRedText}>Kartları çalış</Text>
                    </Pressable>
                    <Pressable onPress={() => router.push({ pathname: '/words', params: { add: '1' } })} style={[styles.btn, styles.btnLight]}>
                      <Ionicons name="add" size={18} color={colors.ink} />
                      <Text style={styles.btnLightText}>Ekle</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable onPress={() => router.push({ pathname: '/words', params: { add: '1' } })} style={[styles.btn, styles.btnRed, { flex: 1 }]}>
                    <Ionicons name="add" size={18} color={colors.onRed} />
                    <Text style={styles.btnRedText}>İlk kelimeni ekle</Text>
                  </Pressable>
                )}
              </View>
            </View>

            <Text style={styles.sectionTitle}>Kısayollar</Text>
            <View style={styles.tiles}>
              <Tile
                icon="heart-outline"
                title="Favori öğretmenlerim"
                sub={favorites.count ? `${favorites.count} öğretmen` : 'Henüz favorin yok'}
                onPress={() => router.push('/favorites')}
                corner={
                  favorites.photos.length ? (
                    <View style={styles.tileAvatars}>
                      {favorites.photos.map((uri, i) => (
                        <Image key={uri} source={{ uri }} style={[styles.tileAvatar, i > 0 && { marginLeft: -8 }]} />
                      ))}
                    </View>
                  ) : null
                }
              />
              <Tile
                icon="albums-outline"
                tone="champagne"
                title="Ders haklarım"
                sub={
                  !credits || credits.count === 0
                    ? 'Kullanılabilir ders hakkın yok'
                    : credits.teachers.length === 1
                      ? `${credits.teachers[0]} ile kullanılabilir`
                      : `${credits.teachers.length} öğretmenle kullanılabilir`
                }
                onPress={() => router.navigate('/(tabs)/lessons')}
                corner={credits && credits.count > 0 ? <Text style={styles.tileBig}>{credits.count}</Text> : null}
              />
              <Tile
                icon="gift-outline"
                title="Arkadaşını davet et"
                sub="Arkadaşın ilk dersini alınca sana 1 ücretsiz ders"
                onPress={() => router.push('/referral')}
              />
              <Tile
                icon="locate-outline"
                tone="petrol"
                title="Ücretsiz seviye testi"
                sub="20 soru · yaklaşık 10 dk"
                onPress={() => open('/seviye-testi')}
              />
            </View>
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Kısayollar</Text>
            <View style={styles.tiles}>
              <Tile icon="wallet-outline" tone="champagne" title="Kazançlarım" sub="Bakiye ve para çekme" onPress={() => router.push('/earnings')} />
              <Tile icon="shield-checkmark-outline" tone="petrol" title="Öğretmen etik kuralları" sub="ARMUS'ta ders verirken" onPress={() => open('/ogretmen-etik-kurallari')} />
            </View>
          </>
        )}

        <Text style={styles.groupLabel}>HESAP</Text>
        <View style={styles.group}>
          <Row icon="person-outline" label="Profili düzenle" onPress={() => router.push('/profile/edit')} />
          {/* shown only: the sign-in email can't be changed (migration_117.sql) */}
          <Row icon="mail-outline" label="E-posta" value={profile?.email} locked onPress={explainEmailLock} />
          <Row icon="lock-closed-outline" label="Şifre değiştir" onPress={() => router.push('/settings/password')} last />
        </View>

        <Text style={styles.groupLabel}>BİLDİRİMLER</Text>
        <View style={styles.group}>
          <Row
            icon="notifications-outline"
            label="Ders ve mesaj bildirimleri"
            last
            right={
              <Switch
                value={pushOn}
                onValueChange={togglePush}
                trackColor={{ true: colors.red, false: colors.border }}
                thumbColor="#ffffff"
                ios_backgroundColor={colors.border}
              />
            }
          />
        </View>

        <Text style={styles.groupLabel}>DESTEK</Text>
        <View style={styles.group}>
          <Row icon="help-circle-outline" label="Sık sorulan sorular" onPress={() => open('/sss')} />
          <Row icon="chatbubble-ellipses-outline" label="Bize ulaş" onPress={() => open('/iletisim')} last />
        </View>

        <Text style={styles.groupLabel}>YASAL</Text>
        <View style={styles.group}>
          <Row icon="shield-outline" label="Gizlilik Politikası" onPress={() => open('/gizlilik-politikasi')} />
          <Row icon="document-text-outline" label="Kullanım Şartları" onPress={() => open('/kullanim-sartlari')} last />
        </View>

        <View style={[styles.group, { marginTop: 16 }]}>
          <Row icon="log-out-outline" label="Çıkış yap" onPress={confirmSignOut} />
          <Row
            icon="trash-outline"
            label={deleting ? 'Siliniyor…' : 'Hesabımı sil'}
            danger
            last
            onPress={deleting ? undefined : confirmDeleteAccount}
          />
        </View>

        <Text style={styles.version}>ARMUS {Constants.expoConfig?.version ?? ''}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({
  icon,
  title,
  sub,
  onPress,
  corner,
  tone = 'red',
}: {
  icon: IconName;
  title: string;
  sub: string;
  onPress: () => void;
  corner?: React.ReactNode;
  tone?: 'red' | 'champagne' | 'petrol';
}) {
  const iconBox = tone === 'petrol' ? styles.tileIconPetrol : tone === 'champagne' ? styles.tileIconChampagne : null;
  const iconColor = tone === 'petrol' ? colors.petrol : tone === 'champagne' ? colors.champagneText : colors.red;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={title}>
      <View style={[styles.tileIcon, iconBox]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      {corner && <View style={styles.tileCorner}>{corner}</View>}
      <Text style={styles.tileTitle}>{title}</Text>
      <Text style={styles.tileSub} numberOfLines={2}>
        {sub}
      </Text>
    </Pressable>
  );
}

function Row({
  icon,
  label,
  value,
  onPress,
  right,
  danger,
  locked,
  last,
}: {
  icon: IconName;
  label: string;
  value?: string | null;
  onPress?: () => void;
  right?: React.ReactNode;
  danger?: boolean;
  /** a value that can't be changed: a small lock instead of the arrow */
  locked?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, !last && styles.rowLine, pressed && onPress && { opacity: 0.7 }]}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
        <Ionicons name={icon} size={16} color={danger ? colors.error : colors.red} />
      </View>
      <Text style={[styles.rowLabel, danger && { color: colors.error }]}>{label}</Text>
      {right ?? (
        <>
          {!!value && (
            <Text style={styles.rowValue} numberOfLines={1}>
              {value}
            </Text>
          )}
          {!danger && (
            <Ionicons
              name={locked ? 'lock-closed' : 'chevron-forward'}
              size={locked ? 13 : 16}
              color={colors.faint}
              style={{ marginLeft: value ? 6 : 'auto' }}
            />
          )}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // the status bar area is plain red; the scroll view paints the ground and carries the band
  safeRed: { flex: 1, backgroundColor: colors.red },
  list: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 28 },

  head: { alignItems: 'center', paddingTop: 10 },
  avatar: { width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: colors.cream, backgroundColor: colors.champagne },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: fonts.display, fontSize: 30, color: colors.red },
  name: { fontFamily: fonts.display, fontSize: 21, color: colors.onRed, marginTop: 10, letterSpacing: -0.5, textAlign: 'center' },
  roleLine: { fontFamily: fonts.bodyMedium, fontSize: 13, color: 'rgba(250,245,226,0.85)', marginTop: 3 },
  editPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(250,245,226,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(250,245,226,0.3)',
  },
  editPillText: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.onRed },

  wordsCard: {
    marginTop: 20,
    backgroundColor: colors.panel,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  wordsTop: { flexDirection: 'row', gap: 14 },
  eyebrow: { fontFamily: fonts.bodyExtraBold, fontSize: 10.5, letterSpacing: 1, color: colors.red },
  wordsCount: { fontFamily: fonts.display, fontSize: 30, color: colors.ink, marginTop: 6, letterSpacing: -1 },
  wordsUnit: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 0, color: colors.muted },
  wordsMeta: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.muted, marginTop: 6 },
  wordsLearned: { fontFamily: fonts.bodyBold, color: colors.petrol },
  track: { height: 6, borderRadius: 3, backgroundColor: '#f0e7d8', overflow: 'hidden', marginTop: 10 },
  trackFill: { height: '100%', borderRadius: 3, backgroundColor: colors.petrol },
  mini: { width: 108, height: 96 },
  miniCard: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 14, borderWidth: 1, borderColor: colors.champagneDeep },
  miniBack1: { backgroundColor: colors.champagne, transform: [{ rotate: '-7deg' }, { translateX: -5 }, { translateY: 4 }] },
  miniBack2: { backgroundColor: colors.goldPale, transform: [{ rotate: '4deg' }, { translateX: 4 }, { translateY: 2 }] },
  miniFront: {
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 3,
    shadowColor: colors.redDeep,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  miniTerm: { fontFamily: fonts.displayBold, fontSize: 13, color: colors.red, textAlign: 'center' },
  miniCat: { fontFamily: fonts.body, fontSize: 10, color: colors.muted },
  wordsBtns: { flexDirection: 'row', gap: 8, marginTop: 14 },
  btn: { height: 44, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 14 },
  btnRed: { backgroundColor: colors.red },
  btnRedText: { fontFamily: fonts.bodyExtraBold, fontSize: 14, color: colors.onRed },
  btnLight: { backgroundColor: colors.panel, borderWidth: 1, borderColor: '#e2d6c3' },
  btnLightText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },

  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.ink, marginTop: 22, marginBottom: 10, marginLeft: 4 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48.5%',
    flexGrow: 1,
    minHeight: 118,
    backgroundColor: colors.panel,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  tileIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.redSoft },
  tileIconChampagne: { backgroundColor: colors.champagne },
  tileIconPetrol: { backgroundColor: colors.petrolSoft },
  tileCorner: { position: 'absolute', top: 14, right: 12 },
  tileAvatars: { flexDirection: 'row' },
  tileAvatar: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.panel },
  tileBig: { fontFamily: fonts.display, fontSize: 24, color: colors.red, marginTop: -4 },
  tileTitle: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink, marginTop: 'auto', paddingTop: 12, lineHeight: 18 },
  tileSub: { fontFamily: fonts.body, fontSize: 11.5, lineHeight: 15, color: colors.muted, marginTop: 2 },

  groupLabel: { fontFamily: fonts.bodyExtraBold, fontSize: 11, letterSpacing: 1, color: colors.muted, marginTop: 22, marginBottom: 8, marginLeft: 6 },
  group: { backgroundColor: colors.panel, borderRadius: 18, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.redSoft },
  rowIconDanger: { backgroundColor: '#fbeceb' },
  rowLabel: { fontFamily: fonts.bodySemibold, fontSize: 14.5, color: colors.ink, flexShrink: 1 },
  rowValue: { marginLeft: 'auto', flexShrink: 1, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.muted, maxWidth: '50%' },
  version: { textAlign: 'center', fontFamily: fonts.body, fontSize: 11.5, color: colors.faint, marginTop: 16 },
});
