import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { bandGradient } from '../lib/theme';

// where the red starts to give way: solid under the title, the lighter red
// at the band's edge, a blush, then the champagne ground `fade` points down
const stops = (from: number, height: number, total: number, fade = 130) => {
  const at = (y: number) => Math.min(1, Math.max(0, (from + y) / total));
  const solid = height * 0.45;
  return [0, at(solid), at(Math.max(solid, height - 20)), at(height + fade * 0.38), 1] as const;
};

/**
 * The red band behind the top of a screen that doesn't scroll (design A,
 * like the website panels): red under the status bar and the title, fading
 * into the champagne ground about `height` points below the status bar.
 * It goes first in the screen, under a transparent SafeAreaView.
 */
export default function Band({ height = 220 }: { height?: number }) {
  const insets = useSafeAreaInsets();
  useLightStatusBar();
  const total = insets.top + height + 130;
  return (
    <LinearGradient colors={bandGradient} locations={stops(insets.top, height, total)} style={[styles.fixed, { height: total }]} />
  );
}

/**
 * The same band for a screen whose content scrolls: it goes first inside the
 * scrolling content (the list header) so it moves away with the content and
 * no dark text ever slides over red. The screen's SafeAreaView paints the
 * status bar area (and any fixed header) plain red — `colors.red`, the band's
 * own top colour — and the list paints the ground. It also reaches 600pt
 * above the content, for the pull-down bounce on iOS. `inset` is the list's
 * side padding, which the band reaches past to touch both screen edges;
 * `fade` is how long the red takes to melt into the ground (shorter where
 * small grey text follows right below the band).
 */
export function ScrollBand({ height = 120, inset = 16, fade = 130 }: { height?: number; inset?: number; fade?: number }) {
  useLightStatusBar();
  const above = 600;
  const total = above + height + fade;
  return (
    <LinearGradient
      colors={bandGradient}
      locations={stops(above, height, total, fade)}
      style={[styles.scroll, { top: -above, left: -inset, right: -inset, height: total }]}
    />
  );
}

/** light status bar text while this screen is in front (it sits on red) */
export function useLightStatusBar() {
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, [])
  );
}

const styles = StyleSheet.create({
  fixed: { position: 'absolute', top: 0, left: 0, right: 0 },
  scroll: { position: 'absolute', pointerEvents: 'none' },
});
