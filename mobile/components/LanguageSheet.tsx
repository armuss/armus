import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLang, type Lang } from '../lib/i18n';
import { colors, fonts, radius } from '../lib/theme';

const OPTIONS: { code: Lang; short: string; name: string; sub: string }[] = [
  { code: 'tr', short: 'TR', name: 'Türkçe', sub: 'Uygulama Türkçe görünür' },
  { code: 'en', short: 'EN', name: 'English', sub: 'The app is shown in English' },
];

/**
 * Dil · Language (Profil): pick Turkish or English for the app. The choice
 * is kept on this phone and the whole app switches right away. Each option
 * is written in its own language, so it can be read whichever is on now.
 */
export default function LanguageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { lang, setLang, t } = useLang();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.shade} onPress={onClose} accessibilityLabel={t('Kapat')} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 18 }]}>
        <View style={styles.grab} />
        <Text style={styles.title}>Dil · Language</Text>
        <Text style={styles.sub}>{t('Uygulamanın dilini seç.')}</Text>
        <View style={{ gap: 10 }} accessibilityRole="radiogroup">
          {OPTIONS.map((o) => {
            const on = lang === o.code;
            return (
              <Pressable
                key={o.code}
                onPress={() => {
                  setLang(o.code);
                  onClose();
                }}
                style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && { opacity: 0.85 }]}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={o.name}
              >
                <View style={[styles.badge, on && styles.badgeOn]}>
                  <Text style={[styles.badgeText, on && { color: colors.onRed }]}>{o.short}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{o.name}</Text>
                  <Text style={styles.optionSub}>{o.sub}</Text>
                </View>
                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.red : colors.faint} />
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.note}>{t('Bu seçim bu telefonda saklanır.')}</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shade: { flex: 1, backgroundColor: 'rgba(10,10,10,0.45)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 22, paddingTop: 10 },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 16 },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink, letterSpacing: -0.3 },
  sub: { fontFamily: fonts.body, fontSize: 13.5, color: colors.muted, marginTop: 6, marginBottom: 16 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  optionOn: { borderColor: colors.red, backgroundColor: colors.redSoft },
  badge: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' },
  badgeOn: { backgroundColor: colors.red },
  badgeText: { fontFamily: fonts.bodyExtraBold, fontSize: 13, color: colors.ink },
  name: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  optionSub: { fontFamily: fonts.body, fontSize: 12.5, color: colors.muted, marginTop: 2 },
  note: { fontFamily: fonts.body, fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 14 },
});
