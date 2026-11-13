import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, fonts, radius } from '../lib/theme';
import { useT } from '../lib/i18n';

/**
 * The teacher's intro video on their profile, where the big photo used to
 * be (teacher.html does the same). It waits on its first frame with a play
 * button; the first tap starts it and hands over to the native controls
 * (pause, seek, full screen). Leaving the screen pauses it, so it doesn't
 * keep talking behind the booking screen.
 */
export default function TeacherVideo({
  uri,
  style,
  badge,
}: {
  uri: string;
  style?: StyleProp<ViewStyle>;
  /** a small caption over the corner until it starts, e.g. the teacher's availability */
  badge?: string;
}) {
  const t = useT();
  const [started, setStarted] = useState(false);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });

  useFocusEffect(
    useCallback(() => {
      return () => player.pause();
    }, [player])
  );

  return (
    <View style={[styles.box, style]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={started}
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture={false}
      />
      {!started && (
        <Pressable
          style={styles.cover}
          onPress={() => {
            setStarted(true);
            player.play();
          }}
          accessibilityRole="button"
          accessibilityLabel={t("Tanıtım videosunu oynat")}
        >
          <View style={styles.play}>
            <Ionicons name="play" size={26} color={colors.red} style={{ marginLeft: 3 }} />
          </View>
          <View style={[styles.pill, styles.topRight]}>
            <Ionicons name="videocam" size={13} color="#fff" />
            <Text style={styles.tagText}>{t("Tanıtım videosu")}</Text>
          </View>
          {!!badge && (
            <View style={[styles.pill, styles.bottomLeft]}>
              <View style={styles.liveDot} />
              <Text style={styles.tagText}>{badge}</Text>
            </View>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', backgroundColor: '#161616' },
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.18)' },
  play: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  // the two captions: "Tanıtım videosu" top right, the availability bottom left
  pill: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  topRight: { right: 10, top: 10 },
  bottomLeft: { left: 10, bottom: 10 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#3ecf7a' },
  tagText: { fontFamily: fonts.bodyBold, fontSize: 12, color: '#fff' },
});
