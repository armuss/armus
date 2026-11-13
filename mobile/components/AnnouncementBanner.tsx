import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../lib/supabase';
import { colors, fonts } from '../lib/theme';
import { useT } from '../lib/i18n';

const DISMISSED_KEY = 'armusDismissedAnnouncement';

/**
 * The admin's announcement (site_settings "announcement"), the website's
 * top bar (site-settings.js armusRenderAnnouncementBanner): a red strip
 * with cream text and a close button, shown only while it's active and
 * gone for good on this phone once closed - until the admin writes a
 * different message. It sits in the flow above the screens (under the
 * status bar), so nothing on the screen is covered.
 */
export default function AnnouncementFrame({ children }: { children: ReactNode }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.from('site_settings').select('value').eq('key', 'announcement').maybeSingle();
      const setting = data?.value as { active?: boolean; message?: string } | undefined;
      if (!setting?.active || !setting.message) return;
      let dismissed: string | null = null;
      try {
        dismissed = await AsyncStorage.getItem(DISMISSED_KEY);
      } catch {
        // shown again next time - harmless
      }
      if (alive && dismissed !== setting.message) setMessage(setting.message);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!message) return <>{children}</>;

  return (
    <View style={styles.frame}>
      <View style={[styles.bar, { paddingTop: insets.top + 8 }]} accessibilityRole="alert">
        <Ionicons name="megaphone-outline" size={16} color={colors.onRed} />
        <Text style={styles.text}>{message}</Text>
        <Pressable
          onPress={() => {
            AsyncStorage.setItem(DISMISSED_KEY, message).catch(() => {});
            setMessage(null);
          }}
          hitSlop={10}
          accessibilityLabel={t("Duyuruyu kapat")}
        >
          <Ionicons name="close" size={18} color={colors.onRed} />
        </Pressable>
      </View>
      {/* the screens below already start under the status bar */}
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>{children}</SafeAreaInsetsContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.red },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.redDeep,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  text: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 13.5, lineHeight: 19, color: colors.onRed },
});
