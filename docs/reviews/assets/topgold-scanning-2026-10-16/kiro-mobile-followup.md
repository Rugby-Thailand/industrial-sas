# Follow-up: user prioritizes live mobile camera

The user clarified during your first run: primary outcome is เปิดกล้องมือถือสแกนหน้างาน (live mobile warehouse scanning). Preserve and finish useful static benchmark results, but now extend the evaluation toward the live useBarcodeCamera path. No production edits; same earlier task constraints.

Need bounded, honest measurements using dataset frame replay, NOT claims that desktop times equal phones. Reuse the local Kiro server and a fixed stratified selection or all 153 unique as practical. Compare:

1. Current BrowserMultiFormatReader(undefined) decoder behavior on realistic max-side 1920 frames and/or 1080 (preserve aspect, no invented detail).
2. JS decoder with Code128 + QR format hints, otherwise same pixels.
3. Warm WASM worker on same frame pixels, fast options and hard pass; optionally center ROI plus periodic full-frame recovery (must count lost off-center identities).
4. Native BarcodeDetector only if actual host supports requested formats; record unsupported instead of inventing timing.

Measure exact JOB/location recall vs provisional labels, QR decode yield, product yield separately (not truth accuracy), wrong-kind first results, ambiguous/multiple identities, and decode latency p50/p95 including no-reads, plus repeated subset timing. Measure main-thread blocking / task gap for synchronous JS compared with worker, if feasible. No synthetic camera or CPU throttle should be described as a real phone. Explain fallback scheduling costs (current JS 100ms intervals plus fallback up to 1200ms every1500ms on main thread), decorative scan overlay vs actual full-frame decode, and latest-frame-only backpressure. Is restricting formats compatible with current scan contracts? Report evidence.

If runtime too costly, use a predeclared stratified subset and label n honestly. Do not implement a huge simulator or UI. Keep raw evidence and a reproducible command. Add findings to report or a separate `docs/reviews/topgold-mobile-scanning-kiro-2026-10-16.md`.

Final solution should prioritize live capture -> bounded frame/ROI -> warm single worker -> selected formats -> quick decode -> harder scan when unresolved -> multi-frame confirmation only for risky/disagreeing reads -> canonical business validation. Full-frame periodic pass prevents fixed ROI from permanently missing off-center codes. Stop/cancel releases resources and prevents stale callbacks. Photos may offer an explicit still-frame rescue; avoid running 15 seconds of full-photo retry for every live frame.

Do not run timing simultaneously with another benchmark. No actual phone is attached, so document the remaining iPhone/Android camera validation rather than claim it passed. User target device/browser may arrive later.
