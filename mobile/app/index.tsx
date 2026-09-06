import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../lib/auth';
import { colors } from '../lib/theme';

// TEST MODE: always show the welcome carousel on launch, regardless of the
// stored "seen onboarding" flag, so it's easy to review the whole first-run
// flow repeatedly. Set back to false to restore the normal skip-if-seen behavior.
const ALWAYS_SHOW_WELCOME = true;

export default function Index() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.gold3} />
      </View>
    );
  }

  if (session) return <Redirect href="/(tabs)" />;
  if (ALWAYS_SHOW_WELCOME) return <Redirect href="/welcome" />;
  return <Redirect href="/(auth)/login" />;
}
