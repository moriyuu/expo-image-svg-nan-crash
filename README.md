# expo-image: `CALayerInvalidGeometry` — CALayer position contains NaN

Minimal reproducible example for a hard crash in `expo-image` on iOS when the
decoded image has a size of `0 x 0`.

Related: [expo/expo#49332](https://github.com/expo/expo/issues/49332), closed by
the bot for a missing reproducible example.

## Steps to reproduce

```bash
npm install
npx expo run:ios
```

1. Tap **"1. Probe with contentFit=fill"** — the image loads without crashing and
   `onLoad` reports `0 x 0 (cacheType: disk)`.
2. Tap **"2. Render with contentFit=cover"** — the app crashes with
   `CALayerInvalidGeometry`.

The cache entry survives app restarts, so step 2 keeps crashing on every
subsequent launch until `SDImageCache` is cleared.

## Summary

`idealSize()` in `ios/Utils/ImageUtils.swift` divides the container size by the
content pixel size with no guard against a zero content size:

```swift
case .cover:
  let aspectRatio = max(containerSize.width / contentPixelSize.width,   // 350 / 0 = +Inf
                        containerSize.height / contentPixelSize.height)
  return contentPixelSize * aspectRatio                                 // 0 * Inf = NaN
```

`contain` and `scale-down` carry the same division. `fill` is the only
`contentFit` that does not, because it returns `containerSize` directly — which
is why step 1 above is safe and step 2 is not.

The `NaN` flows from `imageLoadCompleted` (`ImageView.swift:280`) into
`applyContentPosition(contentSize:containerSize:)` and is written straight into
`sdImageView.layer.frame.origin`, which raises `CALayerInvalidGeometry`.

## Why the image is `0 x 0`

The repro caches this SVG:

```svg
<svg xmlns="http://www.w3.org/2000/svg"><defs><rect id="icon" width="16" height="16" fill="red"/></defs></svg>
```

No `width`/`height` attributes and no renderable content — the shape of an icon
sprite that only defines symbols. CoreSVG reports a canvas size of `0 x 0` for
it.

`expo-image` registers `SDImageSVGCoder` and, with no `tintColor` /
`enforceEarlyResizing`, decodes through its **vector** path. That path has no
zero-size check, while the bitmap path does
([`SDImageSVGCoder.m`](https://github.com/SDWebImage/SDWebImageSVGCoder/blob/master/SDWebImageSVGCoder/Classes/SDImageSVGCoder.m)):

```objc
// createBitmapSVGWithData:targetSize:preserveAspectRatio:
CGSize size = SDCGSVGDocumentGetCanvasSize(document);
if (size.width == 0 || size.height == 0) {   // <- guarded
    return nil;
}
```

```objc
// createVectorSVGWithData: — no size check, returns a UIImage with size (0, 0)
// and a nil CGImage
```

SVG is only the most deterministic way in. The bug is in `idealSize()` /
`applyContentPosition()`, and any decoder that hands back a `0 x 0` image
reaches it.

## Why the repro goes through the cache

SDWebImage rejects zero-size images, but **only on the download path**
(`SDWebImageDownloaderOperation.m`):

```objc
CGSize imageSize = image.size;
if (imageSize.width == 0 || imageSize.height == 0) {
    NSString *description = image == nil ? @"Downloaded image decode failed" : @"Downloaded image has 0 pixels";
    NSError *error = [NSError errorWithDomain:SDWebImageErrorDomain code:SDWebImageErrorBadImageData ...];
    [self callCompletionBlockWithToken:token image:nil imageData:nil error:error finished:YES];
}
```

That is the only zero-size check in `SDWebImage/Core`. The cache read path
(`SDImageCache queryCacheOperationForKey:` -> `SDWebImageManager
callCompletionBlockForOperation:`) has none, so `expo-image` receives the `0 x 0`
image with `error == nil` and `finished == true`.

The repro reaches that path with `expo-image`'s own public API, which stores raw
bytes without decoding or validating them (`ImageModule.swift`,
`writeToCacheAsync`):

```js
await Image.writeToCacheAsync(fileUri, CACHE_KEY);
<Image source={{ uri: '...', cacheKey: CACHE_KEY }} contentFit="cover" />
```

The crash backtrace below confirms the same entry point
(`-[SDImageCache queryCacheOperationForKey:options:context:cacheType:done:]`),
and it matches what we see in production.

## Crash

```
*** Terminating app due to uncaught exception 'CALayerInvalidGeometry',
reason: 'CALayer position contains NaN: [nan nan].
  Layer: <CALayer:0x3005c22e0; position = CGPoint (175 45); bounds = CGRect (0 0; 350 90);
    delegate = <SDAnimatedImageView: 0x1763ee300; baseClass = UIImageView;
      frame = (0 0; 350 90); autoresize = W+H; userInteractionEnabled = NO;
      image = <(null):0x0 (null) anonymous; (0 0)@0>;
      layer = <CALayer: 0x3005c22e0>>;
    mask = <CAShapeLayer: 0x3005c14a0>; opaque = YES; allowsGroupOpacity = YES;
    minificationFilter = trilinear; magnificationFilter = trilinear>'

*** First throw call stack:
 3   QuartzCore    -[CALayer setPosition:] + 128
 4   QuartzCore    -[CALayer setFrame:] + 384
 5   ExpoImage     ExpoImage.ImageView.applyContentPosition(contentSize: CGSize, containerSize: CGSize) -> ()
 6   ExpoImage     ExpoImage.ImageView.imageLoadCompleted(UIImage?, Data?, Error?, SDImageCacheType, Bool, URL?) -> ()
 7   ExpoImage     closure in ExpoImage.ImageView.reload(force: Bool) -> ()
 9   SDWebImage    __110-[SDWebImageManager callCompletionBlockForOperation:completion:image:data:error:cacheType:finished:queue:url:]_block_invoke
12   SDWebImage    -[SDWebImageManager callCompletionBlockForOperation:completion:image:data:error:cacheType:finished:queue:url:]
13   SDWebImage    -[SDWebImageManager callDownloadProcessForOperation:url:options:context:cachedImage:cachedData:cacheType:progress:completed:]
14   SDWebImage    __89-[SDWebImageManager callCacheProcessForOperation:url:options:context:progress:completed:]_block_invoke
15   SDWebImage    __73-[SDImageCache queryCacheOperationForKey:options:context:cacheType:done:]_block_invoke_2
16   libdispatch   _dispatch_call_block_and_release
20   libdispatch   _dispatch_main_queue_callback_4CF
```

## Suggested fix

Guard the single place where the value reaches Core Animation, rather than the
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

Independent of this repro, we hit the same crash in production in a separate app
(Expo SDK 56, `expo-image@56.0.11`, new architecture enabled) — 29 events / 28
users over 7 days, on remote animated image sources rather than SVG:

```
Fatal Exception: CALayerInvalidGeometry
CALayer position contains NaN: [nan nan].
  Layer: <CALayer: position = CGPoint (175 45.3333); bounds = CGRect (0 0; 350 90.6667);
    delegate = <SDAnimatedImageView: baseClass = UIImageView;
      frame = (0 0; 350 90.6667);
      image = <(null):0x0 (null) anonymous; (0 0)@0>;
      ...>;
    mask = <CAShapeLayer: ...>; ...>

3  QuartzCore   CA::Layer::set_position(CA::Vec2<double> const&, bool)
4  QuartzCore   -[CALayer setPosition:]
5  QuartzCore   -[CALayer setFrame:]
6  ExpoImage    ...
9  SDWebImage   ...
13 libdispatch  _dispatch_call_block_and_release
```

It first appeared when that app moved to SDK 56 (`expo-image` `~3.0.9` ->
`~56.0.11`).

`idealSize()` is byte-for-byte identical in `56.0.11`, `57.0.x` and `main`, so
upgrading does not help.

## Environment

- `expo` 57.0.19, `expo-image` 57.0.4, `react-native` 0.86.3
- New architecture enabled
- Xcode 26.6, iOS 26.5 simulator (iPhone 17 Pro)
