# Barcode UI preview

Interactive HTML for the existing location-first Job scan flow. Thai/English and dark/light themes; responsive layout; no production integration or backend writes.

```sh
node scripts/product-barcode-benchmark/setup-wasm.mjs
node src/features/finishedGoods/jobScan/_prototype/barcode/server.mjs
```

- Location: http://127.0.0.1:3202/?page=location
- Product / JOB: http://127.0.0.1:3202/?page=product
- Curved-label confirmation: http://127.0.0.1:3202/?page=product&scenario=review
- Add `&lang=en&theme=light` for English/light mode.

**Choose image** runs actual local ZXing WASM decoding in a cancellable worker (15 seconds / 140 attempts, with a 20-second outer timeout), using the benchmark's crop, angle, and curved-label fallback. The supplied photos are served from their original attachment paths; nothing is uploaded. Curve fallback results require confirmation. The two sample photo buttons also run the decoder; the Sample states menu shows illustrative UI states without decoding. Clicking a thumbnail opens the full image for checking.

The normal-label photo was verified through the actual decoder. The curved photo reached the worker's time budget in this preview environment; its confirmation layout is available through the clearly labeled Sample states menu. The earlier benchmark's success rate is not a guarantee of this preview worker's timing or physical-phone performance.

**Use camera** requests real camera access and reads full frames; this preview does not validate physical-phone performance. Closing, cancelling, or switching sources stops tracks and invalidates pending reads. Optional dates, quantities, names, and handwriting are never inferred from a barcode.

Location lookup is an in-memory example: `F2-L28-18` is the only mapped code. Other values show unknown-location feedback. A saved ticket is an in-memory receipt only and is cleared on reload. Photo (AI) is shown in its existing toolbar position but disabled in this barcode-focused preview.

Assets depend on local benchmark setup, original attachments, and design-sheet fonts. The preview server only exposes an explicit asset allowlist.
