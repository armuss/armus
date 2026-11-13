import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors, fonts, redGradient } from '../lib/theme';

type Props = {
  label: string;
  onPress?: () => void;
  /** primary: the red main action · gold: a highlighted one (cream) · outline: a secondary one */
  variant?: 'primary' | 'gold' | 'outline';
  loading?: boolean;
  disabled?: boolean;
};

export default function Button({ label, onPress, variant = 'primary', loading, disabled }: Props) {
  const isDisabled = disabled || loading;
  const textColor = variant === 'primary' ? colors.onRed : variant === 'gold' ? colors.red : colors.ink;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variant === 'gold' && { backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.champagneDeep },
        variant === 'outline' && styles.outline,
        { opacity: isDisabled ? 0.55 : pressed ? 0.86 : 1 },
      ]}
    >
      {variant === 'primary' && (
        <LinearGradient colors={redGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill} />
      )}
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onRed : colors.red} />
      ) : (
        <Text style={[styles.label, { color: textColor }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    overflow: 'hidden',
  },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  outline: { backgroundColor: colors.panel, borderWidth: 1, borderColor: '#e2d6c3' },
  label: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 15,
  },
});
