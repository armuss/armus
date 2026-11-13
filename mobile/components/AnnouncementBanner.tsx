import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../lib/supabase';
import { colors, fonts, radius } from '../lib/theme';

const DISMISSED_KEY = 'armusDismissedAnnouncement';

/**
 * The admin's announcement (site_settings "announcement"), shown at the top
 * like the website's sticky banner (site-settings.js): only while it's
 * active, and gone for good on this phone once closed - until the admin
 * writes a different message.
 */
export default function AnnouncementBanner() {
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

  if (!message) return null;

  return (
    <View style={[styles.wrap, { top: insets.top + 6 }]} pointerEvents="box-none">
      <View style={styles.bar}>
        <Ionicons name="megaphone-outline" size={17} color={colors.red} />
        <Text style={styles.text}>{message}</Text>
        <Pressable
          onPress={() => {
            AsyncStorage.setItem(DISMISSED_KEY, message).catch(() => {});
            setMessage(null);
          }}
          hitSlop={10}
          accessibilityLabel="Kapat"
        >
          <Ionicons name="close" size={18} color={colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 50 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.cream,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: colors.champagneDeep,
    shadowColor: colors.redDeep,
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  text: { flex: 1, fontFamily: fonts.bodySemibold, fontSize: 13.5, lineHeight: 19, color: colors.ink },
});
