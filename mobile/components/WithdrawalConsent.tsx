import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius } from '../lib/theme';

// The right-of-withdrawal consent a card payment needs (migration_112.sql,
// create-payment's withdrawalConsent) - same wording as booking.html.
export default function WithdrawalConsent({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      style={styles.row}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>{checked && <Text style={styles.tick}>✓</Text>}</View>
      <Text style={styles.text}>
        Dersin, 14 günlük cayma süresi dolmadan benim onayımla başlayacağını ve ders başladığında cayma hakkımın sona ereceğini
        kabul ediyorum. Bir paketten hiç ders kullanmadıysam 14 gün içinde paketi iptal edip ücretin tamamını geri alabilirim.
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 4, marginBottom: 14 },
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
  boxChecked: { backgroundColor: colors.dark, borderColor: colors.dark },
  tick: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.gold2 },
  text: { flex: 1, fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.muted },
});
