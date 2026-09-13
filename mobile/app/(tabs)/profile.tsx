import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../../components/Button';
import { useAuth } from '../../lib/auth';
import { colors, fonts, radius } from '../../lib/theme';

const SITE_URL = 'https://armus.vercel.app';

export default function Profile() {
  const { profile, signOut, deleteAccount } = useAuth();
  const [deleting, setDeleting] = useState(false);

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
      ],
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.headerBlock}>
        <Text style={styles.title}>Profil</Text>
      </View>

      <View style={styles.content}>
        {profile?.photo_url ? (
          <Image source={{ uri: profile.photo_url }} style={styles.avatar} />
        ) : (
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>{(profile?.name?.[0] || '?').toUpperCase()}</Text>
          </View>
        )}
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

        <View style={{ marginTop: 16, width: '100%' }}>
          <Button label="Profili Düzenle" variant="outline" onPress={() => router.push('/profile/edit')} />
        </View>
        <View style={{ marginTop: 12, width: '100%' }}>
          <Button label="Çıkış Yap" variant="outline" onPress={signOut} />
        </View>

        <Pressable
          onPress={deleting ? undefined : confirmDeleteAccount}
          style={styles.deleteRow}
          disabled={deleting}
        >
          <Text style={styles.deleteText}>{deleting ? 'Siliniyor…' : 'Hesabımı Sil'}</Text>
        </Pressable>

        <View style={styles.legalRow}>
          <Pressable onPress={() => Linking.openURL(`${SITE_URL}/gizlilik-politikasi.html`)}>
            <Text style={styles.legalLink}>Gizlilik Politikası</Text>
          </Pressable>
          <Text style={styles.legalDot}>·</Text>
          <Pressable onPress={() => Linking.openURL(`${SITE_URL}/kullanim-sartlari.html`)}>
            <Text style={styles.legalLink}>Kullanım Şartları</Text>
          </Pressable>
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
  deleteRow: {
    marginTop: 20,
    padding: 6,
  },
  deleteText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12.5,
    color: colors.error,
  },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  legalLink: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12.5,
    color: colors.muted,
    textDecorationLine: 'underline',
  },
  legalDot: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.faint,
  },
});
