import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

// An SVG with no `width`/`height` attributes and no renderable content
// (everything lives inside `<defs>`, as in an icon sprite).
// CoreSVG reports a canvas size of 0x0 for it, so SDWebImageSVGCoder's vector
// path returns a non-nil UIImage whose `size` is (0, 0).
const ZERO_SIZE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg"><defs><rect id="icon" width="16" height="16" fill="red"/></defs></svg>';

const SOURCE = `data:image/svg+xml;utf8,${encodeURIComponent(ZERO_SIZE_SVG)}`;
// If the data: URI does not load in your setup, run `npm run payload-server`
// in this directory and use this instead:
// const SOURCE = 'http://localhost:8000/zero-size.svg';

export default function App() {
  const [mode, setMode] = useState(null);
  const [loaded, setLoaded] = useState(null);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>expo-image: NaN in CALayer position</Text>
      <Text style={styles.body}>
        expo-image {require('expo-image/package.json').version} — new architecture enabled.
      </Text>

      <Pressable style={styles.button} onPress={() => setMode('fill')}>
        <Text style={styles.buttonText}>1. Probe with contentFit="fill" (safe)</Text>
      </Pressable>
      <Pressable style={[styles.button, styles.danger]} onPress={() => setMode('cover')}>
        <Text style={styles.buttonText}>2. Render with contentFit="cover" (crashes)</Text>
      </Pressable>

      {loaded ? (
        <Text style={styles.result}>
          onLoad reported source size: {loaded.width} x {loaded.height}
        </Text>
      ) : null}

      {mode ? (
        <Image
          key={mode}
          style={styles.image}
          source={SOURCE}
          contentFit={mode}
          onLoad={(event) => setLoaded(event.source)}
          onError={(event) => setLoaded({ width: `error: ${event.error}`, height: '' })}
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
