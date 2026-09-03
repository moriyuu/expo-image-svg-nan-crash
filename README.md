# expo-image: `CALayerInvalidGeometry` — CALayer position contains NaN

Minimal reproducible example for a hard crash in `expo-image` on iOS when the
decoded image has a size of `0 x 0`.

Related: [expo/expo#49332](https://github.com/expo/expo/issues/49332) (closed by
the bot for a missing reproducible example).

## Summary

`idealSize()` in `ImageUtils.swift` divides the container size by the content
pixel size without guarding against a zero content size. A `0 x 0` image
produces `+Infinity`, then `0 * Infinity = NaN`, and the `NaN` is written
straight into `CALayer.frame.origin`, which raises `CALayerInvalidGeometry` and
kills the process.

Any image whose decoded size is `0 x 0` triggers this. The repro uses an SVG,
which reaches that state deterministically (see below).

## Steps to reproduce

```bash
npm install
npx expo run:ios
```

1. Tap **"1. Probe with contentFit=fill"** — the image loads without crashing and
   `onLoad` reports a source size of `0 x 0`.
2. Tap **"2. Render with contentFit=cover"** — the app crashes with
   `CALayerInvalidGeometry`.

`contentFit="fill"` is safe because `idealSize()` returns `containerSize`
directly for it. `cover`, `contain` and `scale-down` all divide by the content
size and all crash.

## Why the image is `0 x 0`

The source is this SVG, inlined as a `data:` URI:

```svg
<svg xmlns="http://www.w3.org/2000/svg"><defs><rect id="icon" width="16" height="16" fill="red"/></defs></svg>
```

It has no `width`/`height` attributes and no renderable content — the shape of
an icon sprite that only defines symbols. CoreSVG reports a canvas size of
`0 x 0` for it.

`expo-image` registers `SDImageSVGCoder` and, with no `tintColor` /
`enforceEarlyResizing`, decodes through its **vector** path. That path has no
zero-size check:

- [`createBitmapSVGWithData:`](https://github.com/SDWebImage/SDWebImageSVGCoder/blob/master/SDWebImageSVGCoder/Classes/SDImageSVGCoder.m)
  bails out with `if (size.width == 0 || size.height == 0) return nil;`
- `createVectorSVGWithData:` does not, and returns a valid `UIImage` whose
  `size` is `(0, 0)` and whose `CGImage` is `nil`.

So `expo-image` receives a non-nil image with `error == nil` and
`finished == true`.

SVG is only the most deterministic way in. This is not SVG-specific — the
crash lives in `idealSize()` / `applyContentPosition()`, and any decoder that
hands back a `0 x 0` image reaches it. We see the same crash in production on a
different codebase with animated GIF/WebP sources (see "Production occurrences").

## Crash path

`ImageView.swift`, in `imageLoadCompleted`:

```swift
imageLayoutSize = idealSize(
  contentPixelSize: image.size * image.scale,   // (0, 0)
  containerSize: frame.size,
  scale: scale,
  contentFit: contentFit
)
...
applyContentPosition(contentSize: imageLayoutSize, containerSize: frame.size)
```

`ImageUtils.swift:64`:

```swift
case .cover:
  let aspectRatio = max(containerSize.width / contentPixelSize.width,   // 350 / 0 = +Inf
                        containerSize.height / contentPixelSize.height)
  return contentPixelSize * aspectRatio                                 // 0 * Inf = NaN
```

`applyContentPosition` then writes the `NaN` offset into the layer:

```swift
sdImageView.layer.frame.origin = offset   // -> CALayerInvalidGeometry
```

## Suggested fix

Guard the single point where the value reaches Core Animation, rather than the
three division branches in `idealSize()`:

```swift
private func applyContentPosition(contentSize: CGSize, containerSize: CGSize) {
  let offset = contentPosition.offset(contentSize: contentSize, containerSize: containerSize)
  guard offset.x.isFinite, offset.y.isFinite else {
    return
  }
  ...
```

## Production occurrences

Independent of this repro, we hit the same crash in production in a different
app (Expo SDK 56, `expo-image@56.0.11`, new architecture enabled), 29 events /
28 users in 7 days:

```
Fatal Exception: CALayerInvalidGeometry
CALayer position contains NaN: [nan nan].
  Layer: <CALayer: position = CGPoint (175 45.3333); bounds = CGRect (0 0; 350 90.6667);
    delegate = <SDAnimatedImageView: baseClass = UIImageView;
      frame = (0 0; 350 90.6667);
      image = <(null):0x0 (null) anonymous; (0 0)@0>;    <- decoded image is 0x0
      ...>;
    mask = <CAShapeLayer: ...>; ...>

3  QuartzCore   CA::Layer::set_position(CA::Vec2<double> const&, bool)
4  QuartzCore   -[CALayer setPosition:]
5  QuartzCore   -[CALayer setFrame:]
6  ExpoImage    ...
9  SDWebImage   ...
13 libdispatch  _dispatch_call_block_and_release
```

The crash first appeared when that app moved to SDK 56 (`expo-image` `~3.0.9` ->
`~56.0.11`).

`idealSize()` is byte-for-byte identical in `56.0.11`, `57.0.x` and `main`, so
upgrading does not help.

## Environment

- `expo` 57.0.19, `expo-image` 57.0.4, `react-native` 0.86.3
- New architecture enabled
- iOS 26.2 simulator (also reproduces on device)
