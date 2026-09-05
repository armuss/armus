import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import TeacherCard from '../../components/TeacherCard';
import { TEACHERS } from '../../lib/teachers-data';
import { colors, fonts, radius } from '../../lib/theme';

export default function Teachers() {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TEACHERS;
    return TEACHERS.filter((t) =>
      [t.name, t.role, ...t.tags].some((field) => field.toLowerCase().includes(q))
    );
  }, [query]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.headerBlock}>
        <Text style={styles.title}>Öğretmenler</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="İsim, IELTS, konuşma..."
          placeholderTextColor={colors.faint}
          style={styles.search}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <TeacherCard teacher={item} onPress={() => router.push(`/teacher/${item.id}`)} />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>Aramanla eşleşen öğretmen bulunamadı.</Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  headerBlock: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.ink,
    marginBottom: 14,
    letterSpacing: -0.5,
  },
  search: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 16,
    fontFamily: fonts.body,
    fontSize: 14.5,
    color: colors.ink,
    backgroundColor: colors.panel,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  empty: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 40,
  },
});
