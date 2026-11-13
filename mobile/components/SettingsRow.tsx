import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '../lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

/** A white rounded group of settings rows (Profil, Hesap ve güvenlik). */
export function SettingsGroup({ label, children, style }: { label?: string; children: ReactNode; style?: object }) {
  return (
    <>
      {!!label && <Text style={styles.groupLabel}>{label}</Text>}
      <View style={[styles.group, style]}>{children}</View>
    </>
  );
}

/** One row: an icon, a label, an optional value, and an arrow (or a lock for a value that can't change). */
export function SettingsRow({
  icon,
  label,
  value,
  onPress,
  right,
  danger,
  locked,
  last,
}: {
  icon: IconName;
  label: string;
  value?: string | null;
  onPress?: () => void;
  right?: ReactNode;
  danger?: boolean;
  /** a value that can't be changed: a small lock instead of the arrow */
  locked?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, !last && styles.rowLine, pressed && onPress && { opacity: 0.7 }]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={value ? `${label}: ${value}` : label}
    >
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
        <Ionicons name={icon} size={16} color={danger ? colors.error : colors.red} />
      </View>
      <Text style={[styles.rowLabel, danger && { color: colors.error }]}>{label}</Text>
      {right ?? (
        <>
          {!!value && (
            <Text style={styles.rowValue} numberOfLines={1}>
              {value}
            </Text>
          )}
          <Ionicons
            name={locked ? 'lock-closed' : 'chevron-forward'}
            size={locked ? 13 : 16}
            color={danger ? colors.error : colors.faint}
            style={{ marginLeft: value ? 6 : 'auto' }}
          />
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  groupLabel: { fontFamily: fonts.bodyExtraBold, fontSize: 11, letterSpacing: 1, color: colors.muted, marginTop: 22, marginBottom: 8, marginLeft: 6 },
  group: { backgroundColor: colors.panel, borderRadius: 18, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.redSoft },
  rowIconDanger: { backgroundColor: '#fbeceb' },
  rowLabel: { fontFamily: fonts.bodySemibold, fontSize: 14.5, color: colors.ink, flexShrink: 1 },
  rowValue: { marginLeft: 'auto', flexShrink: 1, fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.muted, maxWidth: '50%' },
});
