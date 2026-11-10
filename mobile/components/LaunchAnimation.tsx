import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';

import { useAuth } from '../lib/auth';

/**
 * The launch animation, played once when the app opens, on top of the
 * first screen:
 *
 *   1. the still launch screen's black dolphin on white (this layer draws
 *      the very same picture, so the hand-over from the native launch
 *      screen can't be seen)
 *   2. the hand-drawn ARMUS wordmark comes up under it, then goes
 *   3. the dolphin dips, then grows until the app shows through its shape
 *      and it has swallowed the whole screen
 *
 * How it's drawn: a white sheet with a dolphin-shaped hole lies over the
 * app. Under the hole sits a black sheet, so at first the hole reads as a
 * black dolphin. Scaling the white sheet up makes the hole grow; fading
 * the black sheet lets the app show through it. Only transforms and
 * opacity move, so it runs on the native driver and stays smooth while
 * the first screen is still loading.
 */

// The still launch image is this many points wide - the same numbers as
// "imageWidth" for expo-splash-screen in app.json. They have to match, or
// the dolphin jumps when this layer takes over.
const CANVAS = Platform.OS === 'ios' ? 280 : 200;

// Where things sit on the launch artwork's square canvas
// (assets/splash-icon.png), as shares of its width.
const WORDMARK = { left: 247 / 1024, top: 703.5 / 1024, width: 530 / 1024, height: 163 / 1024 };
// The point deepest inside the dolphin's body, and how far it is from the
// dolphin's edge. Growing around it is what lets the shape cover the screen.
const FOCUS = { x: 542 / 1024, y: 322 / 1024 };
const CLEARANCE = 52 / 1024;

const DIP = 0.83;
const WHITE = '#ffffff';
const NATIVE = Platform.OS !== 'web';

const stencil = require('../assets/launch-stencil.png');
const wordmark = require('../assets/launch-wordmark.png');

export default function LaunchAnimation() {
  const { loading } = useAuth();
  const windowSize = useWindowDimensions();
  // this layer's own measured size - on some Android phones the window
  // size leaves out a system bar that the layer itself covers, which would
  // put the dolphin a few points off the still launch screen's
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const width = box?.width ?? windowSize.width;
  const height = box?.height ?? windowSize.height;
  const [artReady, setArtReady] = useState(false);
  const artReadyNow = useRef(false);
  const [done, setDone] = useState(false);
  const started = useRef(false);
  const reduceMotion = useRef(false);

  const wordIn = useRef(new Animated.Value(0)).current;
  const wordOut = useRef(new Animated.Value(1)).current;
  const dip = useRef(new Animated.Value(0)).current;
  const zoom = useRef(new Animated.Value(0)).current;
  const dark = useRef(new Animated.Value(1)).current;
  const sheet = useRef(new Animated.Value(1)).current;

  // the canvas sits in the middle of the screen, like the still launch image
  const left0 = width / 2 - CANVAS / 2;
  const top0 = height / 2 - CANVAS / 2;
  const fx = FOCUS.x * CANVAS;
  const fy = FOCUS.y * CANVAS;
  // the white sheet reaches this far from the focus point in every direction,
  // enough to cover the screen even while the dolphin dips
  const half = Math.ceil(Math.max(width, height) * 1.4);

  // how much the hole has to grow for the screen's farthest corner to fall
  // inside the dolphin, with some to spare
  const zoomScale = useMemo(() => {
    const focusX = left0 + fx;
    const focusY = top0 + fy;
    const farthest = Math.hypot(Math.max(focusX, width - focusX), Math.max(focusY, height - focusY));
    const target = (farthest / (CLEARANCE * CANVAS)) * 1.25;
    // the growth speeds up like a camera pushing in: equal steps multiply
    // the size rather than add to it
    const steps = 24;
    const inputRange = Array.from({ length: steps + 1 }, (_, i) => i / steps);
    return zoom.interpolate({ inputRange, outputRange: inputRange.map((p) => Math.pow(target / DIP, p)) });
  }, [zoom, left0, top0, fx, fy, width, height]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        reduceMotion.current = on;
      })
      .catch(() => {});
  }, []);

  function begin(play: boolean) {
    if (started.current) return;
    started.current = true;
    SplashScreen.hideAsync().catch(() => {});

    if (!play) {
      setDone(true);
      return;
    }

    // "reduce motion" is on: no zoom, the launch screen just fades away
    if (reduceMotion.current) {
      Animated.timing(sheet, { toValue: 0, duration: 260, delay: 200, useNativeDriver: NATIVE }).start(() => setDone(true));
      return;
    }

    const ease = Easing.inOut(Easing.cubic);
    Animated.parallel([
      Animated.timing(wordIn, { toValue: 1, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }),
      Animated.timing(wordOut, { toValue: 0, delay: 750, duration: 200, easing: ease, useNativeDriver: NATIVE }),
      Animated.timing(dip, { toValue: 1, delay: 800, duration: 200, easing: ease, useNativeDriver: NATIVE }),
      Animated.timing(zoom, { toValue: 1, delay: 1000, duration: 650, easing: Easing.poly(1.7), useNativeDriver: NATIVE }),
      Animated.timing(dark, { toValue: 0, delay: 1060, duration: 340, easing: ease, useNativeDriver: NATIVE }),
    ]).start(() => setDone(true));
  }

  // start once the first screen can be drawn for real (sign-in state known)
  // and this layer is laid out with its stencil on screen - until then the
  // native launch screen stays up over it
  useEffect(() => {
    if (!loading && artReady && box) begin(true);
  });

  // a slow connection can't hold the launch screen: after a few seconds
  // it lets go, with the animation if the artwork is ready
  useEffect(() => {
    const timer = setTimeout(() => begin(artReadyNow.current), 5000);
    return () => clearTimeout(timer);
  }, []);

  if (done) return null;

  const scale = Animated.multiply(dip.interpolate({ inputRange: [0, 1], outputRange: [1, DIP] }), zoomScale);

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity: sheet }]}
      onLayout={(e) => setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.dark, { opacity: dark }]} />

      {/* the white sheet: four plain panels around the stencil, all scaled
          together around the focus point (the middle of this box) */}
      <Animated.View
        style={{
          position: 'absolute',
          left: left0 + fx - half,
          top: top0 + fy - half,
          width: half * 2,
          height: half * 2,
          transform: [{ scale }],
        }}
      >
        <View style={[styles.white, { left: 0, right: 0, top: 0, height: half - fy + 1 }]} />
        <View style={[styles.white, { left: 0, right: 0, top: half - fy + CANVAS - 1, bottom: 0 }]} />
        <View style={[styles.white, { left: 0, top: half - fy, width: half - fx + 1, height: CANVAS }]} />
        <View style={[styles.white, { left: half - fx + CANVAS - 1, right: 0, top: half - fy, height: CANVAS }]} />
        <Image
          source={stencil}
          onLoad={() => {
            artReadyNow.current = true;
            setArtReady(true);
          }}
          fadeDuration={0}
          style={{ position: 'absolute', left: half - fx, top: half - fy, width: CANVAS, height: CANVAS }}
        />
      </Animated.View>

      <Animated.Image
        source={wordmark}
        fadeDuration={0}
        style={{
          position: 'absolute',
          left: left0 + WORDMARK.left * CANVAS,
          top: top0 + WORDMARK.top * CANVAS,
          width: WORDMARK.width * CANVAS,
          height: WORDMARK.height * CANVAS,
          opacity: Animated.multiply(wordIn, wordOut),
          transform: [{ translateY: wordIn.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dark: { backgroundColor: '#0a0a0a' },
  white: { position: 'absolute', backgroundColor: WHITE },
});
