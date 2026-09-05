import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../../components/Button';
import { useAuth } from '../../lib/auth';
import { colors, fonts, radius } from '../../lib/theme';

export default function Profile() {
  const { profile, signOut } = useAuth();

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.headerBlock}>
        <Text style={styles.title}>Profil</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>{(profile?.name?.[0] || '?').toUpperCase()}</Text>
        </View>
        <Text style={styles.name}>{profile?.name}</Text>
        <Text style={styles.email}>{profile?.email}</Text>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Rol</Text>
            <Text style={styles.infoValue}>{profile?.role === 'teacher' ? 'Öğretmen' : 'Öğrenci'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Şehir</Text>
            <Text style={styles.infoValue}>{profile?.city || '—'}</Text>
          </View>
        </View>

        <View style={{ marginTop: 24, width: '100%' }}>
          <Button label="Çıkış Yap" variant="outline" onPress={signOut} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  headerBlock: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.ink,
    letterSpacing: -0.5,
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatarInitial: {
    fontFamily: fonts.display,
    fontSize: 30,
    color: colors.ink,
  },
  name: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 19,
    color: colors.ink,
  },
  email: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.muted,
    marginTop: 4,
    marginBottom: 24,
  },
  infoCard: {
    width: '100%',
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  infoLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13.5,
    color: colors.muted,
  },
  infoValue: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13.5,
    color: colors.ink,
  },
});
