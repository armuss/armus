import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Logo from '../../components/Logo';
import TeacherCard from '../../components/TeacherCard';
import { useAuth } from '../../lib/auth';
import { TEACHERS } from '../../lib/teachers-data';
import { colors, fonts, goldGradient, radius } from '../../lib/theme';

export default function Home() {
  const { profile } = useAuth();
  const firstName = profile?.name?.split(' ')[0] || '';
  const featured = TEACHERS.slice(0, 3);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Logo size={22} />
          <View style={styles.avatarDot}>
            <Text style={styles.avatarInitial}>{(firstName[0] || '?').toUpperCase()}</Text>
          </View>
        </View>

        <Text style={styles.greeting}>
          {firstName ? `Merhaba, ${firstName}` : 'Merhaba'}
        </Text>
        <Text style={styles.subtitle}>Bugün İngilizce pratiğine ne dersin?</Text>

        <LinearGradient colors={goldGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <Text style={styles.heroTitle}>Sana uygun öğretmeni bul</Text>
          <Text style={styles.heroSubtitle}>Hedefine, seviyene ve bütçene göre seç.</Text>
          <View style={styles.heroBtn}>
            <Text style={styles.heroBtnText} onPress={() => router.push('/(tabs)/teachers')}>
              Öğretmen Bul →
            </Text>
          </View>
        </LinearGradient>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Öne çıkan öğretmenler</Text>
          <Text style={styles.sectionLink} onPress={() => router.push('/(tabs)/teachers')}>
            Tümünü gör
          </Text>
        </View>

        {featured.map((teacher) => (
          <TeacherCard
            key={teacher.id}
            teacher={teacher}
            onPress={() => router.push(`/teacher/${teacher.id}`)}
          />
        ))}
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
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  avatarDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
  },
  greeting: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.ink,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: colors.muted,
    marginTop: 6,
    marginBottom: 20,
  },
  hero: {
    borderRadius: radius.xl,
    padding: 22,
    marginBottom: 28,
  },
  heroTitle: {
    fontFamily: fonts.display,
    fontSize: 21,
    color: colors.onGold,
    marginBottom: 6,
  },
  heroSubtitle: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.onGold,
    opacity: 0.75,
    marginBottom: 16,
  },
  heroBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.onGold,
    borderRadius: radius.md,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  heroBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13.5,
    color: '#fff',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionTitle: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 16,
    color: colors.ink,
  },
  sectionLink: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13,
    color: colors.goldText,
  },
});
