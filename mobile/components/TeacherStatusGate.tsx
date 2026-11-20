import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth, type Profile } from '../lib/auth';
import { capitalizeName } from '../lib/displayName';
import { useT } from '../lib/i18n';
import { SITE_URL } from '../lib/referrals';
import { colors, fonts, radius } from '../lib/theme';
import { ScrollBand } from './Band';
import Button from './Button';

export type TeacherGate = 'apply' | 'pending' | 'rejected' | 'banned';

/**
 * Which status page a teacher account gets instead of the teacher panel,
 * or null for an approved one - dashboard.html's gate, in the same order:
 * no application yet, under review, rejected, then a closed (banned)
 * account. The app used to open the full panel for all of them, with
 * lessons, a schedule and student blocks that the database refuses for
 * them (a banned profile can't be written at all, migration_81.sql) and a
 * profile students can't see yet.
 */
export function teacherGate(profile: Profile | null | undefined): TeacherGate | null {
  if (!profile || profile.role !== 'teacher') return null;
  if (!profile.status) return 'apply';
  if (profile.status === 'pending') return 'pending';
  if (profile.status === 'rejected') return 'rejected';
  if (profile.is_banned) return 'banned';
  return null;
}

/** dashboard.html's status page for a teacher who isn't approved (or whose account is closed) */
export default function TeacherStatusGate({ gate }: { gate: TeacherGate }) {
  const t = useT();
  const { profile, refreshProfile } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  // an admin may have answered since sign-in: read the status again each
  // time the tab opens (and on a pull), so an approved teacher gets their panel
  useFocusEffect(
    useCallback(() => {
      refreshProfile();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const open = (path: string) => Linking.openURL(`${SITE_URL}${path}`).catch(() => {});

  const content =
    gate === 'apply'
      ? {
          icon: 'document-text-outline' as const,
          title: t("Başvurunu tamamlamalısın"),
          text: t("Panelini görebilmen için önce öğretmen başvuru formunu doldurman gerekiyor."),
          action: { label: t("Başvuruyu Tamamla"), onPress: () => open('/apply-teacher') },
        }
      : gate === 'pending'
        ? {
            icon: 'hourglass-outline' as const,
            title: t("Başvurun inceleniyor"),
            text: t("ARMUS ekibi profilini ve belgelerini inceliyor. Onaylandığında profilin Öğretmenler sayfasında yayına girecek ve bu panel açılacak."),
            action: null,
          }
        : gate === 'rejected'
          ? {
              icon: 'close-circle-outline' as const,
              title: t("Başvurun onaylanmadı"),
              text: t("Başvurunu gözden geçirip tekrar gönderebilirsin."),
              action: { label: t("Tekrar Başvur"), onPress: () => open('/apply-teacher') },
            }
          : {
              icon: 'lock-closed-outline' as const,
              title: t("Hesabın kapatıldı"),
              text: t("Tekrarlanan, doğrulanmış devamsızlık nedeniyle hesabın kalıcı olarak kapatıldı. İtiraz etmek istersen bizimle iletişime geç."),
              action: { label: t("Bize Ulaş"), onPress: () => open('/iletisim') },
            };

  return (
    <SafeAreaView style={styles.safeRed} edges={['top']}>
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await refreshProfile();
              setRefreshing(false);
            }}
            tintColor={colors.onRed}
          />
        }
      >
        <ScrollBand height={110} inset={20} />
        <Text style={styles.eyebrow}>{t("ÖĞRETMEN PANELİ")}</Text>
        <Text style={styles.title}>{t("Merhaba, ")}{capitalizeName(profile?.name).split(' ')[0] || t("Öğretmen")}</Text>

        <View style={styles.card}>
          <View style={styles.iconBox}>
            <Ionicons name={content.icon} size={26} color={colors.red} />
          </View>
          <Text style={styles.cardTitle}>{content.title}</Text>
          <Text style={styles.cardText}>{content.text}</Text>
          {content.action && (
            <View style={styles.action}>
              <Button label={content.action.label} onPress={content.action.onPress} />
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // the status bar area is plain red; the list paints the ground and carries the band
  safeRed: { flex: 1, backgroundColor: colors.red },
  list: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32 },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 11.5,
    letterSpacing: 1,
    color: 'rgba(250,245,226,0.8)',
    marginBottom: 8,
  },
  title: {
    fontFamily: fonts.displayBlack,
    fontSize: 25,
    lineHeight: 31,
    color: colors.onRed,
    letterSpacing: -0.5,
    marginBottom: 22,
  },
  card: {
    backgroundColor: colors.panel,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 22,
    alignItems: 'center',
  },
  iconBox: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.redSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  cardTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 24,
    color: colors.ink,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  cardText: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 8,
  },
  action: { alignSelf: 'stretch', marginTop: 18 },
});
