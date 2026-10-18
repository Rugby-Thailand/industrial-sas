# TopGold scan experiments (2026-10-16)

Research harnesses only. Production scanners were not changed.

For the Android USB **real-camera test page**, see [`mobile/DEVICE-TEST.md`](mobile/DEVICE-TEST.md). Start with `node scripts/topgold-scan-benchmark/mobile/device-server.mjs`, then connect the authorised phone with `node scripts/topgold-scan-benchmark/android-usb.mjs --open`. The page is at <http://localhost:3194/> and does not require the app backend.

- `kiro/`: actual photo worker baseline, warm pipeline, multiscale, generic barcode regions/deskew, cascade and controls. Reproduce commands and caveats are in `docs/reviews/topgold-scanning-kiro-2026-10-16.md`.
- `mobile/`: default/hinted JS, live JS fallback, full-frame/overlay WASM and native detector on identical resized frames; repeated timing and synthetic live scheduling. Reproduce commands are in `docs/reviews/topgold-mobile-scanning-kiro-2026-10-16.md`.
- `summarize.mjs`: parent audit of the photo results; keeps location/JOB denominators fixed, includes failures in latency, and compares warm/cold on the same eligible input set.
- `webkit-smoke.mjs`: functional check on desktop WebKit after timing jobs finish. This does not test a real iPhone.

Data is read from the user's Downloads folder (or `TOPGOLD_DATASET`), never copied into the repository. Scoring labels/hashes and raw decoded results are under `docs/reviews/assets/topgold-scanning-2026-10-16/`. The local decoder receives ids, targets and pixels, not filenames/expected payloads.

Run timing jobs sequentially. The mobile driver waits for `/tmp/topgold-static-timing-complete`; this is coordination between benchmark processes, not a safety/permission gate. For standalone reruns, verify no other timing is active before creating that marker. Use new run names: the harnesses append JSONL and do not overwrite an earlier run.

The parent's unused initial server/runner scaffold was removed after Kiro's scoped harnesses replaced it. The saved task prompt records that earlier setup.

Final interpretation and mobile implementation plan: `docs/reviews/topgold-scanning-final-2026-10-16.md`.
