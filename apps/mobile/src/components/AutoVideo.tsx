import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

function ActiveVideo({ uri, muted }: { uri: string; muted: boolean }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = muted;
    p.play();
  });
  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);
  return <VideoView player={player} style={styles.video} contentFit="cover" nativeControls={false} surfaceType="textureView" />;
}

export function AutoVideo({
  uri,
  poster,
  active,
  muted,
  style,
}: {
  uri: string;
  poster: string;
  active: boolean;
  muted: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[style, styles.clip]}>
      <Image source={{ uri: poster }} style={styles.video} contentFit="cover" cachePolicy="memory-disk" recyclingKey={poster} />
      {active ? <ActiveVideo uri={uri} muted={muted} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  video: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  clip: { overflow: 'hidden', backgroundColor: '#121212' },
});
