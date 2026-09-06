import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../lib/auth';
import { hasSeenOnboarding } from '../lib/onboarding';
import { colors } from '../lib/theme';

export default function Index() {
  const { session, loading } = useAuth();
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);
  const [seenOnboarding, setSeenOnboarding] = useState(true);

  useEffect(() => {
    hasSeenOnboarding().then((seen) => {
      setSeenOnboarding(seen);
      setCheckingOnboarding(false);
    });
  }, []);

  if (loading || checkingOnboarding) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.gold3} />
      </View>
    );
  }

  if (session) return <Redirect href="/(tabs)" />;
  if (!seenOnboarding) return <Redirect href="/welcome" />;
  return <Redirect href="/(auth)/login" />;
}
