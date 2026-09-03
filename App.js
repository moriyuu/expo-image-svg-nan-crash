import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';

// An SVG with no `width`/`height` attributes and no renderable content
// (everything lives inside `<defs>`, as in an icon sprite).
// CoreSVG reports a canvas size of 0x0 for it, so SDWebImageSVGCoder's vector
// path returns a non-nil UIImage whose `size` is (0, 0).
const ZERO_SIZE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg"><defs><rect id="icon" width="16" height="16" fill="red"/></defs></svg>';

const CACHE_KEY = 'expo-image-zero-size-svg';
const SOURCE = { uri: 'https://example.invalid/zero-size.svg', cacheKey: CACHE_KEY };

export default function App() {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState(null);
  const [loaded, setLoaded] = useState(null);

  useEffect(() => {
    const file = new File(Paths.cache, 'zero-size.svg');
    if (file.exists) {
      file.delete();
    }
    file.create();
    file.write(ZERO_SIZE_SVG);
    Image.writeToCacheAsync(file.uri, CACHE_KEY).then(() => setReady(true));
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>expo-image: NaN in CALayer position</Text>
      <Text style={styles.body}>expo-image {require('expo-image/package.json').version}</Text>

      <Pressable style={styles.button} disabled={!ready} onPress={() => setMode('fill')}>
        <Text style={styles.buttonText}>1. Probe with contentFit="fill" (safe)</Text>
      </Pressable>
      <Pressable style={[styles.button, styles.danger]} disabled={!ready} onPress={() => setMode('cover')}>
        <Text style={styles.buttonText}>2. Render with contentFit="cover" (crashes)</Text>
      </Pressable>

      {loaded ? (
        <Text style={styles.result}>
          onLoad: {loaded.width} x {loaded.height} (cacheType: {loaded.cacheType})
        </Text>
      ) : null}

      {mode ? (
        <Image
          key={mode}
          style={styles.image}
          source={SOURCE}
          contentFit={mode}
          onLoad={(event) => setLoaded({ ...event.source, cacheType: event.cacheType })}
          onError={(event) => setLoaded({ width: 'error', height: event.error })}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 96, gap: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  body: { fontSize: 14, color: '#444' },
  button: { backgroundColor: '#2563eb', padding: 14, borderRadius: 8 },
  danger: { backgroundColor: '#dc2626' },
  buttonText: { color: 'white', fontSize: 15, textAlign: 'center' },
  result: { fontSize: 15, fontFamily: 'Menlo' },
  image: { width: 350, height: 90, backgroundColor: '#eee' },
});
