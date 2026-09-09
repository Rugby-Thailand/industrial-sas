# Browser recording encoder

The local encoder is `scripts/encode-browser-recording.swift`. It uses macOS AVFoundation to create a silent H.264 MP4 from real browser screenshot frames. It does not use a paid service, generate intermediate artwork, activate a native window, or change browser settings. Original screenshots remain unchanged.

```sh
swift scripts/encode-browser-recording.swift artifacts/finished-goods/recording-manifest.json artifacts/finished-goods/finished-flow.mp4
```

The output path must not already exist. Relative PNG paths resolve from the manifest's directory.

```json
{
  "width": 1440,
  "height": 900,
  "fps": 10,
  "durationMs": 3300,
  "frames": [
    { "path": "frames/0001.png", "timestampMs": 0 },
    { "path": "frames/0002.png", "timestampMs": 900 },
    { "path": "frames/0003.png", "timestampMs": 2150 }
  ]
}
```

Record timestamps from actual elapsed capture time; `durationMs` is the stop time and must exceed the final captured frame timestamp. The first frame is timestamp zero; later timestamps must increase. Dimensions default to 1440 × 900; fps defaults to 10 and supports 1–60. Different viewport aspect ratios are fitted in full with black bars, never cropped.

This is a sampled browser viewport recording. Each captured frame remains visible until the next captured frame; timing is quantized to the configured output frame interval. Transient animations or cursor movement between captures are not represented. Avoid claiming continuous operating-system screen recording. Choose an adequate capture cadence and retain the source manifest/frames as evidence.

## Encoder verification, 2026-09-06

A temporary test used three actual browser screenshots already saved under `artifacts/finished-goods`: `01-desktop-empty.png`, `02-product-details-desktop.png`, and `03-measurement-desktop.png`. Output remained in ignored `.cache/video-encoder-check/test.mp4` and is not the final flow recording.

AVFoundation verified:

- Codec: avc1 (H.264), MP4 container.
- Dimensions: 1440 × 900.
- Nominal frame rate: 10 fps; 33 encoded frames from 3 captured screenshots.
- Duration: 3.3 seconds; no audio track.
- File size: 62,462 bytes.
- Decoded video frames at 0.2, 1.2, and 2.6 seconds matched the intended source screenshots after aspect-fit. Mean absolute RGB errors from lossy encoding were 1.86, 2.17, and 1.98 per channel on a 0–255 scale; this checks frame order, orientation, and image content.
- A manifest with duplicate/nonincreasing timestamps was rejected before writing output.

The encoder prints final metadata after successful creation. Missing frames, invalid timestamps/dimensions, existing output paths, encoder stalls, and encoder failure produce a nonzero exit status. Partial output from failures during encoding is removed.
