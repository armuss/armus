import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, goldGradient, radius } from '../lib/theme';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: 'gold' | 'dark' | 'outline';
  loading?: boolean;
  disabled?: boolean;
};

export default function Button({ label, onPress, variant = 'gold', loading, disabled }: Props) {
  const isDisabled = disabled || loading;

  const content = loading ? (
    <ActivityIndicator color={variant === 'outline' ? colors.ink : variant === 'dark' ? '#fff' : colors.onGold} />
  ) : (
    <Text
      style={[
        styles.label,
        variant === 'dark' && { color: '#fff' },
        variant === 'outline' && { color: colors.ink },
        variant === 'gold' && { color: colors.onGold },
      ]}
    >
      {label}
    </Text>
  );

  if (variant === 'gold') {
    return (
      <Pressable onPress={onPress} disabled={isDisabled} style={({ pressed }) => [{ opacity: isDisabled ? 0.6 : pressed ? 0.85 : 1 }]}>
        <LinearGradient colors={goldGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.base}>
          {content}
        </LinearGradient>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variant === 'dark' && { backgroundColor: colors.onGold },
        variant === 'outline' && { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.border },
        { opacity: isDisabled ? 0.6 : pressed ? 0.85 : 1 },
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  label: {
    fontFamily: fonts.bodyBold,
    fontSize: 15.5,
  },
});
