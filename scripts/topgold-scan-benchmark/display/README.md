# Original Job photo display

A separate desktop target for pointing an Android camera at the Mac screen. Does not open a camera, decode barcodes, call OCR/AI, or communicate with the Android test page.

From the repository root:

```sh
node scripts/topgold-scan-benchmark/display/server.mjs
```

Open <http://127.0.0.1:3195/?id=50>. Bound to loopback only. Port 3194 remains the separate Android camera test. This server requires the existing benchmark manifest and dimension audit in `docs/reviews/assets/topgold-scanning-2026-10-16/`.

The default dataset is `/Users/macbook/Downloads/TopGold_2569-10-10_ถึง_2569-10-16/`. To use the same dataset at another location, set `TOPGOLD_DATASET` when starting the server. Original JPEG files are streamed unchanged from that directory; no photos are copied into the repo. The browser uses an ordinary `<img>` and CSS fit/zoom/pan, with no canvas or image processing.

The catalog includes unique package photos with a nonempty Job field in the existing manifest, excluding product-only labels. Suggested starting specimens come first: 50, 52, 57, 60, 73, 77, 81, 99, 112, 131, 137, 150, 164, 165. Default specimen 50 is 2160 × 2880 pixels. URLs and displayed metadata use specimen IDs; no expected Job/product answers are included in the catalog or sent to a decoder.

Controls:

- Left/right arrows: previous/next specimen.
- `+` / `−`: zoom; drag the photo to pan.
- `0`: fit to screen and reset pan.
- `F`: toggle fullscreen.
- `H`: hide/show controls and footer. A small restore button stays in the corner.

Keep the same photo, displayed size, screen brightness, camera distance, and angle while comparing decoders. Scanning a screen is a functional rehearsal: screen pixels, refresh, moiré, brightness and reflected light can differ from a paper Job ticket at the warehouse. These results should not be presented as real-site accuracy.
