import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius } from '../lib/theme';
import { useT } from '../lib/i18n';

// The website checkout's first box (booking.html #payerConsent): the phone
// number and T.C. kimlik no go to the payment provider only with this.
export default function PayerConsent({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  const t = useT();
  return (
    <Pressable onPress={() => onChange(!checked)} style={styles.row} accessibilityRole="checkbox" accessibilityState={{ checked }}>
      <View style={[styles.box, checked && styles.boxChecked]}>{checked && <Text style={styles.tick}>✓</Text>}</View>
      <Text style={styles.text}>
        {t("Telefon numaramın ve T.C. kimlik numaramın, bu rezervasyonu tamamlamak amacıyla ödeme sağlayıcımıza iletilmesini")}{' '}
        <Text style={styles.link} onPress={() => Linking.openURL('https://armus.com.tr/gizlilik-politikasi')}>
          {t("Gizlilik Politikası")}</Text>
        {t("'na uygun şekilde kabul ediyorum.")}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 12, marginBottom: 4 },
  box: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxChecked: { backgroundColor: colors.red, borderColor: colors.red },
  tick: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.onRed },
  text: { flex: 1, fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.muted },
  link: { fontFamily: fonts.bodySemibold, color: colors.red, textDecorationLine: 'underline' },
});
