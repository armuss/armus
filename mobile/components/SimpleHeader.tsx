import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '../lib/theme';

/** Back button and a centred title on the red band, for the small pages opened from Profil. */
export default function SimpleHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <View style={styles.head}>
      <Pressable onPress={() => router.back()} style={styles.roundBtn} accessibilityLabel="Geri">
        <Ionicons name="chevron-back" size={20} color={colors.onRed} />
      </Pressable>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {!!sub && <Text style={styles.sub}>{sub}</Text>}
      </View>
      <View style={{ width: 40 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12 },
  text: { flex: 1, alignItems: 'center' },
  title: { fontFamily: fonts.bodyExtraBold, fontSize: 16, color: colors.onRed },
  sub: { fontFamily: fonts.bodyMedium, fontSize: 12, color: 'rgba(250,245,226,0.8)', marginTop: 1 },
  roundBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(250,245,226,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(250,245,226,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
