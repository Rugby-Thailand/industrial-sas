# Android Job scan test

Standalone local instrument, independent of Next.js, Clerk, Convex and AI/OCR. It reads QR/Code 128 candidates and records trials; it does not register jobs, validate registered products or modify production scanners.

## Start on the Mac

From the repository root:

```sh
node scripts/topgold-scan-benchmark/mobile/device-server.mjs
```

Open <http://localhost:3194/>. The server binds to `127.0.0.1` only. No preview deployment, HTTPS certificate or shared Wi-Fi is needed when using USB forwarding. The WASM binary is served locally from `public/barcode/zxing_reader.wasm`.

ADB 37.0.1 was prepared on this Mac under `~/Library/Caches/TopGoldScan/platform-tools/adb`, downloaded from Google's [SDK Platform Tools](https://developer.android.com/tools/releases/platform-tools). The tools are outside the repository. The helper also accepts `TOPGOLD_ADB=/absolute/path/to/adb` or the usual Android SDK/Homebrew installation.

## Connect Android

1. Enable Developer options → USB debugging on the unlocked phone.
2. Connect a data-capable USB cable and accept **Allow USB debugging** on the phone.
3. With the local server running, execute:

```sh
node scripts/topgold-scan-benchmark/android-usb.mjs --open
```

This lists devices, requires an authorised physical USB device, forwards TCP 3194, and opens Chrome. If several phones are attached, select one with `--serial=SERIAL`. `--open` is optional; otherwise open `http://localhost:3194/` in Chrome manually. It does not install an APK, change device settings or expose the server over the LAN.

Remove this forwarding when finished:

```sh
node scripts/topgold-scan-benchmark/android-usb.mjs --disconnect
```

If the helper reports no device, unlock the phone, check USB debugging and the cable. `unauthorized` means the phone's authorisation dialog still needs acceptance. Localhost forwarding is documented by [Chrome](https://developer.chrome.com/docs/devtools/remote-debugging/local-server). Camera access requires a [secure context such as localhost or HTTPS](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

## Use the page

- Open the rear camera, wait for focus, then start a timed trial. Opening/permission and decoder preparation are outside scan timing; decoder `setupMs` is recorded separately.
- Alternatively choose a JPG/PNG/WebP, up to 25 MB/40 MP. This reads that same photo once per trial, with decode/setup and file loading separated. Preview input is bounded to 2560 px, preserving aspect ratio. The original file SHA256 and original dimensions identify repeated samples. Photos are not uploaded to the result server.
- Select a target: Job, product, or both. Fill the sample/condition and optionally exact expected values from the printed label **before starting**. Expected values are used only by scoring, never passed to decoders.
- Switch methods on the same sample. Keep target, lighting, distance, requested frame size and time limit constant. Rotate method order across trials. Check output against the actual encoded value/printed label; repeated scans alone are not independent proof of correctness.
- Native-only is disabled unless both QR and Code 128 are supported. Mixed works without Native by starting with WASM.
- The product field contains acquisition candidates, not registered product identities. Several distinct candidates remain ambiguous; the page never chooses one automatically.
- Scanning continues to manual Stop or the time limit. Finding a QR alone does not finish a both-fields trial. In mixed mode, each frame escalates only if its requested target is unresolved. Full-frame WASM uses `tryHarder`; product region rescue runs at most once per second when still unresolved, with the existing 300 ms cooperative budget. A synchronous decode can overrun a cooperative budget.
- Camera settings report the actual resolution/frame rate, which may differ from requested ideals. Frames are capped at the selected long side without upscaling. Only one frame is in flight; the next capture waits for a **new** presented video frame with `requestVideoFrameCallback`, or media-time gating where unavailable. No JPEG is encoded per camera frame.
- Stop invalidates pending work and terminates the worker immediately. Closing, hiding or leaving the page also stops camera tracks. A permission request that resolves after cancellation closes its newly obtained stream. Camera permission itself is controlled by the phone.
- Inspect the latest trial manually with the review selector. This judgement is stored separately from exact expected-value scoring.

## What each method means

| Method                           | Implementation                                                                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JS เดิม + fallback · อ่านต่อเฟรม | Production unhinted `BrowserMultiFormatReader` primary and `decodeBarcodeCanvas` fallback, at most once per 1500 ms following a primary miss; the same singleton-only fallback acceptance. Runs on the main thread. |
| Native                           | `BarcodeDetector` restricted to QR and Code 128, on the main thread.                                                                                                                                                |
| WASM                             | Existing persistent benchmark worker, full-frame `tryHarder`, valid symbols, default two-line Code 128 requirement.                                                                                                 |
| Mixed                            | Native, if available → WASM if requested fields are missing/ambiguous → Code 128 region rescue if a requested product remains unresolved. Native errors are recorded before falling back.                           |

All modes use this page's controlled, sequential frame scheduler. **The JS mode compares existing decoder functions; it is not an unchanged end-to-end production hook baseline.** The production hook can interleave its stream callbacks and asynchronous fallback. This difference is intentional and recorded as pipeline `job-device-1`; do not advertise the results as complete app improvements. The legacy fallback returns strings without format metadata: its non-JOB strings are marked provisional product candidates with `format: null`, preserving that limitation instead of inventing format provenance. FOM classification here does not fix the production classifier.

## Results and interpretation

Each completed/interrupted trial is retained in browser localStorage and synchronised to a per-trial JSON file under **`data/private/topgold-device/`**, already excluded by the repository's private-data ignore rule. Revisions are written atomically and older revisions do not replace newer ones. If USB/server connectivity fails, the page keeps results locally and offers retry and JSON/CSV export. Storage failure is shown explicitly; export before clearing browser site data. The table shows the latest 30; exports and summaries include the full retained history. No images/video are saved by this tool.

Stored evidence includes user agent/capabilities, photo hash or actual camera settings, method/target, requested/actual frame size, setup/elapsed time, per-engine calls/errors, first field/complete candidate time, distinct candidates with first-seen timestamps/engine/format, main-thread RAF gaps/long tasks where supported, stop reason, expected values and manual judgement.

- Exact field scoring requires one unique matching candidate. Extra candidates are ambiguous even if one matches. JOB comparison is case-insensitive; product comparison is exact and case-sensitive. A QR containing unrelated text does not become a product.
- Complete-test accuracy includes no-reads, wrong values and ambiguous candidates, with expected answers present for all requested fields. Interrupted and failed trials remain visible but are reported separately.
- First-complete latency is an acquisition metric. p50/p95 for **correct complete trials only** is labelled accordingly, with coverage displayed alongside. Per-frame processing p50/p95 includes empty frames in completed trials. No blanket speedup follows from faster successful hits on a smaller subset.
- Camera and photo trials, targets, requested sizes and camera time limits are grouped separately. Do not combine different phones, autofocus/lighting conditions or method versions without stratifying exported evidence.
- No backend lookup, server validation, OCR/AI or full-form completeness is measured here. A camera trial still needs a person to point at actual physical labels. Reading a photograph displayed on another screen introduces screen artefacts and is a separate condition.

## Functional verification

With the server running:

```sh
node --test scripts/topgold-scan-benchmark/mobile/device-model-tests.mjs
node scripts/topgold-scan-benchmark/mobile/device-smoke.mjs
pnpm exec eslint --max-warnings=0 scripts/topgold-scan-benchmark
```

The smoke checks use desktop Chromium, a real generated QR for JS/WASM, mocked Native values for routing assertions, and a canvas MediaStream for lifecycle checks. These validate tool behaviour, **not Android accuracy, camera focusing or phone speed**. Screenshot/check evidence is under `docs/reviews/assets/topgold-scanning-2026-10-16/device-ui/`. Temporary server-test records are removed by their own IDs. Smoke browser results are isolated from real phone storage/results.

## Navigation scope

This page is a standalone Vite document with inline acquisition controls and no router, modal, foreground view, custom history entries or completion navigation. It adds no production Next route or navigation state, so the production Back inventory is unchanged. Native Back leaves this document normally; `pagehide` releases camera/worker resources. Returning/reloading retains completed evidence and requires explicitly reopening the camera.
