# Non-AI product barcode benchmark

This is an isolated experiment using the ten original user attachments. It does not alter the application or call the AI ticket extractor. Expected values are held on the server and used only by the summary script; the browser decoder receives image names and hashes only.

```sh
node scripts/product-barcode-benchmark/setup-wasm.mjs
node scripts/product-barcode-benchmark/server.mjs
```

Open `http://127.0.0.1:3187` in a browser and run one round at a time. Results save to `docs/reviews/assets/product-barcode-non-ai-2026-10-10/`. Then run:

```sh
node scripts/product-barcode-benchmark/summarize.mjs --verify
```

The manifest references original attachments outside the repo, rather than committing approximately 18 MB of photos. On another machine, supply those same original JPEGs and update their `sourcePath` entries. Keep the names, SHA-256 values and comparison expectations intact. Photos 8/9/10 are exact byte duplicates of 1/2/3. The original images are 2160 × 2880.

The setup downloads the pinned `zxing-wasm` 3.1.5 npm package, verifies its SHA-512 integrity and extracts it into the ignored `.cache` directory. WASM and images are served locally; scanning has no external requests. `package.json` and the lockfile are unchanged.

## Rounds

- `baseline`: installed `@zxing/browser` 0.2.1, full image with defaults, `TRY_HARDER`, and Code128-only hints.
- `bands`: installed JS decoder, nine overlapping full-width bands.
- `js-targeted`: installed JS decoder, one lower band with a bounded angle sweep; this is not an exhaustive JS search.
- `wasm-full`, `wasm-bands`, `wasm-angles`: ZXing-C++ WASM with Code128 + QR, defaults including two matching linear scanlines. Angles: 0°, ±2°, ±4°, ±6°, ±8°, ±10°.
- `wasm-fast`: full image, then the same overlapping bands prioritized for this pallet ticket layout, stopping on product candidates. Soft wall-clock budget 5 seconds / maximum 140 attempts.
- `wasm-optimized`: an experimental central crop plus column-wise quadratic correction after failed lower bands. Soft budget 15 seconds / 140 attempts. Curved attempts use `minLineCount: 1`, `tryDownscale: false`, and default checksum validation. Any resulting product is marked `reviewRequired`; it must be reviewed or rescanned before operational use.

The curvature parameters and band order were selected while optimizing this seven-image dataset. There is no held-out accuracy estimate. A successful decode is not a database product match, and filtering `FO…` is specific to this app's job identity convention. Several product candidates require a selection in an eventual application integration.

Timing includes canvas preparation and decoder work after image loading, but excludes JPEG loading, AI and network lookups. Yielding uses MessageChannel in the final pipeline to avoid background timer clamping. Cold starts, CPU contention and browser visibility caused large variations; do not treat desktop timings as mobile performance guarantees. A synchronous decode may exceed the soft time limit. Use a worker and cancellation handling before shipping.

The raw manual crop diagnostics explain the curved image failure; they are not counted as automatic full-photo successes. The automatic final pipeline uses the same crop grid and parameters for all files and never reads expected payloads.

Validation: actual browser decoding through the T3 preview, script syntax checks, ESLint, changed-file Prettier, manifest/hash comparisons, and exact payload evaluation. No production camera or authenticated product lookup was tested.
