import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../../lib/auth';
import { colors, floatShadow, fonts } from '../../lib/theme';

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
 * The floating black dock: icons only, and the open tab grows into a gold
 * pill with its name.
 */
function Dock({ state, descriptors, navigation, home }: BottomTabBarProps & { home: IconName }) {
  const insets = useSafeAreaInsets();
  const visible = state.routes.filter(
    (r) => StyleSheet.flatten(descriptors[r.key].options.tabBarItemStyle)?.display !== 'none'
  );
  return (
    <View style={[styles.dockWrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.dock}>
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
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
              }}
              style={[styles.item, focused && styles.itemOn]}
            >
              <Ionicons
                name={focused ? (icon.replace('-outline', '') as IconName) : icon}
                size={21}
                color={focused ? colors.ink : '#8a8a8a'}
              />
              {focused && (
                <Text style={styles.label} numberOfLines={1}>
                  {label}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  if (!session) return <Redirect href="/(auth)/login" />;

  const isTeacher = profile?.role === 'teacher';

  return (
    <Tabs
      tabBar={(props) => <Dock {...props} home={isTeacher ? 'home-outline' : 'search'} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tabs.Screen name="index" options={{ title: isTeacher ? 'Bugün' : 'Keşfet' }} />
      <Tabs.Screen name="students" options={{ title: 'Öğrenciler', href: isTeacher ? undefined : null }} />
      <Tabs.Screen name="availability" options={{ title: 'Programım', href: isTeacher ? undefined : null }} />
      <Tabs.Screen name="messages" options={{ title: 'Mesajlar' }} />
      <Tabs.Screen name="lessons" options={{ title: 'Derslerim', href: isTeacher ? null : undefined }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  dockWrap: { backgroundColor: colors.bg, alignItems: 'center', paddingTop: 8 },
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 62,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: colors.dark,
    ...floatShadow,
  },
  item: {
    height: 46,
    minWidth: 46,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 12,
  },
  itemOn: { backgroundColor: colors.gold2 },
  label: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink },
});
