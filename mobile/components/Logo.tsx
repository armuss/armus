import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text } from 'react-native';

import { fonts, goldGradient } from '../lib/theme';

export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <MaskedView style={{ height: size * 1.25 }} maskElement={<Text style={[styles.text, { fontSize: size }]}>ARMUS</Text>}>
      <LinearGradient colors={goldGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
        <Text style={[styles.text, { fontSize: size, opacity: 0 }]}>ARMUS</Text>
      </LinearGradient>
    </MaskedView>
  );
}

const styles = StyleSheet.create({
  text: {
    fontFamily: fonts.displayBlack,
    letterSpacing: -1,
    alignSelf: 'flex-start',
  },
});
