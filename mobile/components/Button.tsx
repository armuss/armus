import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors, fonts } from '../lib/theme';

type Props = {
  label: string;
  onPress?: () => void;
  /** primary: the black main action · gold: a highlighted one · outline: a secondary one */
  variant?: 'primary' | 'gold' | 'outline';
  loading?: boolean;
  disabled?: boolean;
};

export default function Button({ label, onPress, variant = 'primary', loading, disabled }: Props) {
  const isDisabled = disabled || loading;
  const textColor = variant === 'primary' ? '#fff' : colors.ink;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && { backgroundColor: colors.dark },
        variant === 'gold' && { backgroundColor: colors.gold2 },
        variant === 'outline' && styles.outline,
        { opacity: isDisabled ? 0.55 : pressed ? 0.86 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.gold2 : colors.ink} />
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
  },
  outline: { backgroundColor: colors.bg, borderWidth: 1, borderColor: '#e3e3e3' },
  label: {
    fontFamily: fonts.bodyExtraBold,
    fontSize: 15,
  },
});
