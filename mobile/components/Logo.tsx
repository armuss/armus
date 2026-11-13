import MaskedViewNative from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentType, ReactElement } from 'react';
import { StyleSheet, Text, type ViewProps } from 'react-native';

import { colors, fonts, redGradient } from '../lib/theme';

// the package's own types still build on React Native's old NativeMethods
// type, which RN 0.88 no longer exports, so TypeScript can't read it as a
// component; the component itself is unchanged (SDK 58 ships 0.3.2)
const MaskedView = MaskedViewNative as unknown as ComponentType<ViewProps & { maskElement: ReactElement }>;

/** The ARMUS wordmark: red on the light ground, plain cream on the red band (`light`). */
export default function Logo({ size = 28, light = false }: { size?: number; light?: boolean }) {
  if (light) {
    // no alignSelf here: the parent places it (centred on the welcome and sign-in screens)
    return <Text style={[styles.light, { fontSize: size, lineHeight: size * 1.25 }]}>ARMUS</Text>;
  }
  return (
    <MaskedView style={{ height: size * 1.25 }} maskElement={<Text style={[styles.text, { fontSize: size }]}>ARMUS</Text>}>
      <LinearGradient colors={redGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
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
  light: {
    fontFamily: fonts.displayBlack,
    letterSpacing: -1,
    color: colors.onRed,
  },
});
