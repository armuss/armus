import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect } from 'expo-router';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AnnouncementFrame from '../../components/AnnouncementBanner';
import { teacherGate } from '../../components/TeacherStatusGate';
import { needsEmailVerification, useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors, floatShadow, fonts, redGradient } from '../../lib/theme';
import { useT } from '../../lib/i18n';

type IconName = keyof typeof Ionicons.glyphMap;

const ICONS: Record<string, IconName> = {
  index: 'search',
  students: 'people-outline',
  availability: 'calendar-outline',
  messages: 'chatbubble-outline',
  lessons: 'calendar-outline',
  profile: 'person-outline',
};

/**
 * The floating red dock (design A, like the website panels): every tab
 * with its icon and name, the open one on a cream tile.
 */
function Dock({ state, descriptors, emitter, navigateToTab, home }: BottomTabBarProps & { home: IconName }) {
  const insets = useSafeAreaInsets();
  const visible = state.routes.filter(
    (r) => StyleSheet.flatten(descriptors[r.key].options.tabBarItemStyle)?.display !== 'none'
  );
  return (
    <View style={[styles.dockWrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <LinearGradient colors={redGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.dock}>
        {visible.map((route) => {
          const focused = state.routes[state.index]?.key === route.key;
          const { options } = descriptors[route.key];
          const label = typeof options.title === 'string' ? options.title : route.name;
          const icon = route.name === 'index' ? home : ICONS[route.name] ?? 'ellipse-outline';
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              onPress={() => {
                const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigateToTab(route.key);
              }}
              style={[styles.item, focused && styles.itemOn]}
            >
              <Ionicons
                name={focused ? (icon.replace('-outline', '') as IconName) : icon}
                size={21}
                color={focused ? colors.red : 'rgba(250,245,226,0.8)'}
              />
              <Text style={[styles.label, focused && styles.labelOn]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </LinearGradient>
    </View>
  );
}

// A teacher shows as online to students for 5 minutes after
// profiles.last_active_at (migration_85.sql) - the website refreshes it
// on every page and every 2 minutes (auth.js armusMaybeRefreshPresence).
// The app never did, so a teacher working from the app always looked
// offline on their profile and in the teacher list.
const PRESENCE_REFRESH_MS = 2 * 60 * 1000;

function useTeacherPresence(teacherId: string | null) {
  const lastWrite = useRef(0);
  useEffect(() => {
    if (!teacherId) return;
    // a new sign-in writes right away, not 2 minutes after the last account's write
    lastWrite.current = 0;
    const beat = () => {
      if (AppState.currentState !== 'active') return;
      if (Date.now() - lastWrite.current < PRESENCE_REFRESH_MS - 5000) return;
      lastWrite.current = Date.now();
      supabase
        .from('profiles')
        .update({ last_active_at: new Date().toISOString() })
        .eq('id', teacherId)
        .then(
          () => {},
          () => {}
        );
    };
    beat();
    const interval = setInterval(beat, PRESENCE_REFRESH_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') beat();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [teacherId]);
}

export default function TabsLayout() {
  const t = useT();
  const { session, profile, loading } = useAuth();
  // a teacher still waiting for approval, or with a closed account, isn't
  // listed for students (and a closed profile can't be written at all)
  const teacherPanelOpen = profile?.role === 'teacher' && !teacherGate(profile);
  useTeacherPresence(session && teacherPanelOpen ? profile!.id : null);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  if (!session) return <Redirect href="/(auth)/login" />;
  // like the website's armusEnforceEmailVerification: a new account that
  // hasn't confirmed its email with the 6-digit code goes back there
  if (needsEmailVerification(profile)) return <Redirect href="/verify-email" />;

  const isTeacher = profile?.role === 'teacher';

  return (
    <AnnouncementFrame>
    <Tabs
      tabBar={(props) => <Dock {...props} home={isTeacher ? 'home-outline' : 'search'} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tabs.Screen name="index" options={{ title: isTeacher ? t("Bugün") : t("Keşfet") }} />
      {/* dashboard.html shows a teacher who isn't approved only their status
          page (TeacherHome), not the students or the schedule */}
      <Tabs.Screen name="students" options={{ title: t("Öğrenciler"), href: teacherPanelOpen ? undefined : null }} />
      <Tabs.Screen name="availability" options={{ title: t("Programım"), href: teacherPanelOpen ? undefined : null }} />
      <Tabs.Screen name="messages" options={{ title: t("Mesajlar") }} />
      <Tabs.Screen name="lessons" options={{ title: t("Derslerim"), href: isTeacher ? null : undefined }} />
      <Tabs.Screen name="profile" options={{ title: t("Profil") }} />
    </Tabs>
    </AnnouncementFrame>
  );
}

const styles = StyleSheet.create({
  dockWrap: { backgroundColor: colors.bg, paddingTop: 8, paddingHorizontal: 14 },
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    padding: 6,
    borderRadius: 24,
    ...floatShadow,
  },
  item: {
    flex: 1,
    minWidth: 0,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 2,
  },
  itemOn: { backgroundColor: colors.cream },
  label: { fontFamily: fonts.bodyBold, fontSize: 10.5, color: 'rgba(250,245,226,0.8)' },
  labelOn: { color: colors.red },
});
