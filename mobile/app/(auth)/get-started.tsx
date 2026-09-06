import { router } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../../components/Button';
import { TEACHERS } from '../../lib/teachers-data';
import { colors, fonts, radius } from '../../lib/theme';

const featured = TEACHERS[0];
const learner = TEACHERS[2];

export default function GetStarted() {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Image source={{ uri: featured.photo }} style={styles.heroPhoto} />

          <View style={styles.learnerBubble}>
            <Image source={{ uri: learner.photo }} style={styles.learnerPhoto} />
            <View style={styles.onlineDot} />
            <View style={styles.learnerTag}>
              <Text style={styles.learnerTagText}>Öğrenci</Text>
            </View>
          </View>

          <View style={styles.teacherCard}>
            <Image source={{ uri: featured.photo }} style={styles.teacherThumb} />
            <View style={{ flex: 1 }}>
              <View style={styles.teacherCardTop}>
                <Text style={styles.teacherName}>{featured.name}</Text>
                <View style={styles.superBadge}>
                  <Text style={styles.superBadgeText}>Süper Öğretmen</Text>
                </View>
              </View>
              <Text style={styles.teacherMeta}>
                {featured.completedLessons} ders · ★ {featured.rating.toFixed(1)} · {featured.reviewCount} yorum
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.title}>
          <Text style={styles.titleAccent}>İngilizce'yi</Text> kendi öğretmeninle çok daha hızlı öğren.
        </Text>
        <Text style={styles.subtitle}>
          Hedefine, seviyene ve öğrenme tarzına uygun bir öğretmenle, sana özel bir ders programıyla ilerle.
        </Text>

        <Button label="Öğretmenini bul →" onPress={() => router.push('/(auth)/goal-quiz')} />

        <Pressable onPress={() => router.push('/(auth)/signup-options')} hitSlop={10}>
          <Text style={styles.link}>500+ öğretmeni incele</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
    alignItems: 'center',
  },
  hero: {
    width: '100%',
    marginBottom: 30,
  },
  heroPhoto: {
    width: '100%',
    height: 340,
    borderRadius: radius.xl,
    backgroundColor: colors.panel2,
  },
  learnerBubble: {
    position: 'absolute',
    top: 18,
    right: 18,
    alignItems: 'center',
  },
  learnerPhoto: {
    width: 84,
    height: 96,
    borderRadius: radius.lg,
    borderWidth: 3,
    borderColor: colors.bg,
    backgroundColor: colors.panel2,
  },
  onlineDot: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  learnerTag: {
    marginTop: 6,
    backgroundColor: colors.bg,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  learnerTagText: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    color: colors.ink,
  },
  teacherCard: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  teacherThumb: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.panel2,
  },
  teacherCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  teacherName: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 15.5,
    color: colors.ink,
  },
  superBadge: {
    backgroundColor: '#fff2cf',
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  superBadgeText: {
    fontFamily: fonts.bodyBold,
    fontSize: 10.5,
    color: colors.goldText,
  },
  teacherMeta: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.muted,
    marginTop: 3,
  },
  title: {
    fontFamily: fonts.displayBlack,
    fontSize: 32,
    lineHeight: 38,
    color: colors.ink,
    textAlign: 'center',
    letterSpacing: -0.8,
    marginBottom: 14,
  },
  titleAccent: {
    color: colors.goldText,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
    maxWidth: 340,
  },
  link: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
    textDecorationLine: 'underline',
    marginTop: 18,
  },
});
