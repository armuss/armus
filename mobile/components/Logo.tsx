import { StyleSheet, Text } from 'react-native';

import { colors, fonts } from '../lib/theme';

export default function Logo({ size = 28 }: { size?: number }) {
  return <Text style={[styles.text, { fontSize: size }]}>ARMUS</Text>;
}

const styles = StyleSheet.create({
  text: {
    fontFamily: fonts.displayBlack,
    color: colors.gold3,
    letterSpacing: -1,
  },
});
