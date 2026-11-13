import { type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScrollBand } from './Band';
import SimpleHeader from './SimpleHeader';
import { colors, fonts, radius } from '../lib/theme';

/** A small settings form opened from Profil: header on the red band, a white card with the fields. */
export default function FormScreen({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safeRed} edges={['top']}>
      <SimpleHeader title={title} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={styles.list} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ScrollBand height={30} />
          {!!intro && <Text style={styles.intro}>{intro}</Text>}
          <View style={styles.card}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Field({ label, ...input }: { label: string } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.faint} style={[styles.input, input.editable === false && styles.inputOff]} {...input} />
    </View>
  );
}

export function FormMessage({ text, error }: { text: string; error?: boolean }) {
  if (!text) return null;
  return <Text style={[styles.message, error ? styles.error : styles.success]}>{text}</Text>;
}

const styles = StyleSheet.create({
  safeRed: { flex: 1, backgroundColor: colors.red },
  list: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  intro: { fontFamily: fonts.bodyMedium, fontSize: 13.5, lineHeight: 19, color: 'rgba(250,245,226,0.9)', marginTop: 4, marginBottom: 12, paddingHorizontal: 4 },
  card: { backgroundColor: colors.panel, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: 16, marginTop: 6 },
  field: { marginBottom: 14 },
  label: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.muted, marginBottom: 6, marginLeft: 2 },
  input: {
    height: 50,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#e8ddcc',
    backgroundColor: colors.panel,
    paddingHorizontal: 15,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  inputOff: { backgroundColor: colors.bg, color: colors.muted },
  message: { fontFamily: fonts.bodySemibold, fontSize: 13, lineHeight: 18, marginBottom: 12 },
  error: { color: colors.error },
  success: { color: colors.petrol },
});
