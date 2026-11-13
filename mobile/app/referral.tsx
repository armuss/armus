import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScrollBand } from '../components/Band';
import SimpleHeader from '../components/SimpleHeader';
import { useAuth } from '../lib/auth';
import { getReferralRewardCount, referralLink } from '../lib/referrals';
import { colors, fonts, radius } from '../lib/theme';

const STEPS: [string, string][] = [
  ['Linkini paylaş', 'Kendi davet linkini arkadaşınla paylaş'],
  ['İlk dersini alsın', 'Linkle kayıt olup ilk dersine katılsın'],
  ['Dersini kazan', 'Sen de aynı öğretmenle ücretsiz bir ders kazanırsın'],
];

/** Arkadaşını davet et: the website's referral programme (referral.html) in the app. */
export default function Referral() {
  const { profile } = useAuth();
  const [rewards, setRewards] = useState<number | null>(null);
  const link = referralLink(profile?.referral_code);

  useEffect(() => {
    if (profile) getReferralRewardCount(profile.id).then(setRewards);
  }, [profile?.id]);

  async function share() {
    if (!link) return;
    try {
      await Share.share({ message: `ARMUS'ta birebir İngilizce dersleri için benim davet linkimle kayıt ol: ${link}` });
    } catch {
      // the share sheet was closed
    }
  }

  return (
    <SafeAreaView style={styles.safeRed} edges={['top']}>
      <SimpleHeader title="Arkadaşını davet et" />
      <ScrollView style={styles.list} contentContainerStyle={styles.content}>
        <ScrollBand height={150} />
        <View style={styles.hero}>
          <View style={styles.giftIcon}>
            <Ionicons name="gift" size={30} color={colors.red} />
          </View>
          <Text style={styles.title}>Bir arkadaş getir, bir ders kazan</Text>
          <Text style={styles.text}>Arkadaşın ilk dersini alınca, sen de aynı öğretmenle ücretsiz bir ders kazanırsın.</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.rewardRow}>
            <Text style={styles.rewardNum}>{rewards ?? '–'}</Text>
            <Text style={styles.rewardLabel}>ücretsiz ders kazandın</Text>
          </View>
          <Text style={styles.linkLabel}>Davet linkin</Text>
          {link ? (
            <>
              <View style={styles.linkBox}>
                <Text style={styles.linkText} selectable numberOfLines={1}>
                  {link}
                </Text>
              </View>
              <Pressable onPress={share} style={styles.shareBtn}>
                <Ionicons name="share-outline" size={18} color={colors.onRed} />
                <Text style={styles.shareText}>Linki paylaş</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.noLink}>Davet linkin henüz hazır değil. Biraz sonra tekrar dene.</Text>
          )}
        </View>

        <Text style={styles.section}>Nasıl çalışır?</Text>
        <View style={styles.card}>
          {STEPS.map(([t, d], i) => (
            <View key={t} style={[styles.step, i > 0 && styles.stepLine]}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>{t}</Text>
                <Text style={styles.stepText}>{d}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeRed: { flex: 1, backgroundColor: colors.red },
  list: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  hero: { alignItems: 'center', paddingTop: 8, paddingHorizontal: 12 },
  giftIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.onRed, textAlign: 'center', marginTop: 12, letterSpacing: -0.5 },
  text: { fontFamily: fonts.bodyMedium, fontSize: 14, lineHeight: 20, color: 'rgba(250,245,226,0.88)', textAlign: 'center', marginTop: 6 },
  card: { backgroundColor: colors.panel, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: 16, marginTop: 18 },
  rewardRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  rewardNum: { fontFamily: fonts.display, fontSize: 32, color: colors.red },
  rewardLabel: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  linkLabel: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.muted, marginTop: 14, marginBottom: 6 },
  linkBox: { height: 48, borderRadius: 14, borderWidth: 1, borderColor: '#e8ddcc', backgroundColor: colors.bg, paddingHorizontal: 14, justifyContent: 'center' },
  linkText: { fontFamily: fonts.bodyMedium, fontSize: 13.5, color: colors.ink },
  shareBtn: { marginTop: 10, height: 50, borderRadius: 15, backgroundColor: colors.red, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  shareText: { fontFamily: fonts.bodyExtraBold, fontSize: 15, color: colors.onRed },
  noLink: { fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.muted },
  section: { fontFamily: fonts.displayBold, fontSize: 15, color: colors.ink, marginTop: 24, marginLeft: 4 },
  step: { flexDirection: 'row', gap: 12, paddingVertical: 10 },
  stepLine: { borderTopWidth: 1, borderTopColor: colors.borderSoft },
  stepNum: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.redSoft, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontFamily: fonts.display, fontSize: 13, color: colors.red },
  stepTitle: { fontFamily: fonts.bodyBold, fontSize: 14.5, color: colors.ink },
  stepText: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 1 },
});
