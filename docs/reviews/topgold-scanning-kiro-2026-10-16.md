# TopGold static image scan benchmark (Kiro) — 2026-10-16

Local, headless measurement of the current production image decoder and four alternative pipelines on the real TopGold photos. No production source, dependency or navigation change was made, and no commit/push was performed. Decoding ran locally without calls to an external OCR/AI extraction API; Kiro visually inspected sample images to prepare separate scoring labels. Raw rows, per-image CSV and the benchmark source are listed at the end.

## Answer first

- **Production baseline is slow and loses identities it already saw.** All 153 unique images: location exact 25/58, JOB exact 51/92, JOB+product pair yield 47/92 (41 with production field routing), 4 wrong location reads, 20 input rejections (>16 MP), wall p50 598 ms / p95 14.9 s.
- **The proposed cascade (`cascade`) is faster with fewer false reads, but does not dominate production.** Location exact 23/58 with 0 wrong reads, JOB exact 85/92, pair yield 57/92, wall p50 203 ms / p95 849 ms / max 1.2 s, no timeouts. Production still reads 5 location labels and 5 product codes the cascade misses.
- **Recommendation:** keep the cascade's structure as the default, fix three production defects that cost the most (16 MP rejection, JOB dropped when no product was found, `FOM…` routed to the product field), and add two bounded rescues taken from production: the ticket band/curve product sweep, only when a JOB was found without a product, and the JS ZXing Code128/QR reader on location ROIs, without the all-format fallback that produced the 4 false reads. The combination is **not yet measured**. Rerun this harness on it before you accept it.

## Setup and method

| Item            | Value                                                                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine         | Apple M1 Max, 10 cores, 32 GB, macOS 26.5.2 (darwin 25.5.0 arm64)                                                                                                                                    |
| Browser         | Playwright 1.62.1 Chromium headless 151.0.7922.34 (`chromium-1234`), launched from Node v24.19.0 with `--disable-background-timer-throttling`                                                        |
| Decoder         | `zxing-wasm` 3.1.5 (reader build, `public/barcode/zxing_reader.wasm`); `@zxing/library` 0.23.0 used only by production's JS path                                                                     |
| Serving         | Vite 8.2.0 dev server on 127.0.0.1:3192 (`scripts/topgold-scan-benchmark/kiro/server.mjs`). This is not Next.js. The production worker and pipeline are imported from `src/` unchanged               |
| Dataset         | 166 manifest rows → 163 present (83, 86, 104 absent) → **153 SHA-256-unique** images (59 location, 94 package). The browser computed SHA-256 for all 153, and every hash matched the server manifest |
| Label isolation | Browser receives only `{id, target}` (`LOCATION` for `1_…`, `TICKET` for `2_…`). File names, manifest labels and coordinates are never decoder inputs; scoring happens offline in `analyze.mjs`      |
| Dimensions      | 3024×4032 (55 T, 23 L), 2160×2880 (23 T, 25 L), 3472×4624 (10 T, 4 L), 4624×3472 (6 L), 4032×3024 (4 T, 1 L), 2880×2160, 2776×3701 (1 T each)                                                        |
| Concurrency     | One variant at a time, one image at a time; never concurrent. Mobile replay by the other agent began only after `/tmp/topgold-static-timing-complete` was created, when all timing here was finished |

Timing boundaries:

- **production**: `wallMs` around the real `readBarcodeImage(file, target, signal)`. It includes spawning the per-image worker, WASM fetch and instantiation, `createImageBitmap` JPEG decode inside the worker, the pipeline, and the 20 s hard timeout. Production `elapsedMs` excludes startup and bitmap decode, so it is not used for comparison.
- **prodWarm**: the same `decodeBarcodeBitmap()` called in a persistent, pre-initialised worker. Startup cost is excluded. **It bypasses the worker's 16 MP guard**, so production and prodWarm are compared only on the 133 eligible images.
- **Kiro variants**: run in one persistent worker. `wallMs` covers posting the File, the in-worker `createImageBitmap`, decoding and the reply; the worker reports `bitmapMs` and `decodeMs` separately. The 20 s hard cap terminates the worker and records a timeout; no variant reached it.
- Image bytes are fetched once and cached in the page. Network time is excluded from every variant.
- **Cold setup** (fresh browser profile; worker spawn → `prepareZXingModule` ready): 19.8 ms first, then 13.3–13.8 ms (WASM init 7.8 ms, then 5.7–6.0 ms). On the 133 eligible images, production minus prodWarm, paired per image: p25 39 / p50 61 / p75 100 ms. Output was identical on all 133, so the per-image worker costs about 60 ms on this desktop.
- **Main-thread JPEG decode** (`createImageBitmap`, probe pass): p50 37 ms, max 75 ms.

Run order:

1. setup
2. probe
3. pass 1, variant-major, warm after the first image: production → prodWarm → full1600fast → full1600 → full3000 → roiFast → roiHard → cascade
4. repeat: 16 images × 5 fast variants × 3 rounds, with the variant order rotated each round
5. controls

At the parent's request, production and prodWarm were not repeated; each was measured once on all 153.

### Variants

The alternative WASM variants use `formats: ["Code128","QRCode"]`, default `minLineCount` 2 and checksum-validated (`isValid`) results only. The review-only rescue in cascade stage D uses one scanline. Production retains its existing JS/all-format fallback. The alternative full-frame passes request multiple symbols (`maxNumberOfSymbols` 8); this bounds discovery and does not prove that every visible symbol was found.

| Variant                            | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| production                         | Actual `readBarcodeImage()`; per-image worker; 20 s timeout                                                                                                                                                                                                                                                                                                                                                                                                               |
| prodWarm                           | `decodeBarcodeBitmap()` in a warm worker (no 16 MP guard)                                                                                                                                                                                                                                                                                                                                                                                                                 |
| full1600fast / full1600 / full3000 | Full frame scaled to max side 1600 / 1600 / 3000; `tryHarder` false / true / true                                                                                                                                                                                                                                                                                                                                                                                         |
| roiFast / roiHard                  | Full-photo QR pass at 1600, then production `linearBarcodeRegions()` in both orientations on a ≤2400 px detection copy. Each region is cropped at **native resolution** with quiet-zone padding (12 % + 16 px along the code, 35 % across). Angles tried: 0°, an estimated deskew from the structure tensor (used only when 1.5–20°), then ±6°. `tryHarder` false / true                                                                                                  |
| cascade                            | **A** full1600 `tryHarder:false`; a ticket stops only when it has a JOB-like payload and a Code128 product. **B** native-ROI fast pass on detector regions that no decoded symbol explains (multi-label completeness). **C** full3000 `tryHarder`, then ROI `tryHarder` at [0, deskew, ±4, ±8]. **D** only when still unresolved: `minLineCount:1` plus ±0.15 curve correction on unresolved regions; every result is flagged **review**. Total budget 8 s, never reached |

The cascade's JOB test is `/^FOM?\d{4,}$/`, the format printed in the ticket header. Production's `classifyTicketBarcode` uses `/^FO\d{4,}$/`. Scoring reports both rules.

## Results — all 153 unique images, one pass

Ground truth is the provisional manifest:

- **Location:** denominator 58 (all location rows except 17, whose last digit is unclear). Rows with errors stay in the denominator. Image 2 expects both labels.
- **JOB:** denominator 92 (every package photo except 145/146).
- **Pair yield:** exact JOB and exactly one strict non-JOB Code128. This is _yield_, not product accuracy.
- **Field OK:** the same pair under production's classifier.
- **p50/p95** include failures and errors at their measured wall time.

| Variant      |   Loc exact /58 | Loc wrong | Loc review-only | JOB exact /92 | FOM JOB /12 |    JOB no-read | Pair yield /92 | Field OK /92 |        Errors | Wall p50 | Wall p95 |    Max |
| ------------ | --------------: | --------: | --------------: | ------------: | ----------: | -------------: | -------------: | -----------: | ------------: | -------: | -------: | -----: |
| production   |              25 |     **4** |               0 |            51 |          10 | 27 (+4 review) |             47 |           41 | **20 PIXELS** |      598 |   14,934 | 15,132 |
| prodWarm ¹   |              26 |         4 |               0 |            58 |          10 | 30 (+4 review) |             54 |           48 |             0 |      592 |   14,667 | 15,144 |
| full1600fast |               1 |         0 |               0 |            64 |           8 |             28 |              4 |            4 |             0 |       70 |       88 |     90 |
| full1600     |               7 |         0 |               0 |            78 |           9 |             14 |             19 |           16 |             0 |       83 |      101 |    103 |
| full3000     | 16 (+1 partial) |         0 |               0 |            81 |          10 |             11 |             37 |           31 |             0 |      139 |      232 |    242 |
| roiFast      |              18 |         0 |               0 |            72 |           9 |             20 |             45 |           39 |             0 |      144 |      367 |    525 |
| roiHard      | 22 (+1 partial) |         0 |               0 |            75 |           9 |             17 |             49 |           42 |             0 |      191 |      450 |    650 |
| **cascade**  | 23 (+1 partial) |     **0** |               2 |        **85** |      **11** |              7 |         **57** |           47 |             0 |      203 |  **849** |  1,209 |

¹ prodWarm is not shippable as measured, because it skips the 16 MP guard. On the 133 eligible images production and prodWarm produce identical outputs: location 25/48, JOB 51/82, pair 47/82. Warm p50 is 630 ms against 694 ms for production.

### Location (58 scoreable)

- **Identification.** All 23 location rows the manifest marks `visual` are 0/23 for every variant; the barcode there was not readable earlier either. On the 35 rows marked `barcode`: production 25, cascade 23, roiHard 22, full3000 16. Production and cascade together cover 28/35.
- **Production-only exact reads:** 15, 20, 21, 22, 23. Cascade has review-only reads on 15 and 21; 20, 22 and 23 are no-reads.
- **Cascade-only exact reads:** 9 and 13 (production added a wrong code to each), and 28 (rejected by production's 16 MP guard).
- **Production false reads:** 2 `F1,L3.N1`, 9 `74688272`, 13 `29127276`, 106 `00277`. Inference: full3000 with the same WASM settings produced none of these, so they come from production's JS `decodeBarcodeCanvas` path, probably the all-format fallback reader (EAN/ITF/Code39-like payloads). I have not traced them to a single line. On 2, 9 and 13 production also returned the correct label, so a "unique code" consumer would see an ambiguity rather than an auto-accept. On 106 the only code returned is wrong.
- **Multiple labels (image 2, `F1-L3-11` + `F1-L4-2`).** No variant read `F1-L3-11`. The cascade correctly reports partial (`F1-L4-2` only); production reports `F1-L4-2` plus a false `F1,L3.N1`.
- **Image 17 (uncertain last digit):** no-read for every variant.

### Tickets

- **JOB.** Ticket QR codes encode the JOB number. In every Kiro variant every decoded ticket QR equalled the JOB, and no non-JOB QR payload appeared (full1600: 70 tickets with QR). The QR counts are lower bounds: pass-1 rows kept one format per payload, so a QR and a Code128 with the same text were merged. That was fixed for repeat/control rows. QR yield is not QR accuracy beyond its equality with the manifest JOB.
- **Production drops a JOB it found.** When a ticket has no product, `decodeBarcodeBitmap` returns `[...products]` and discards the JOB set (`barcodeImagePipeline.ts`, final return; `completeTicket` runs only after a product). On 18 tickets (67, 72, 80, 84, 85, 88, 90, 91, 96, 101, 124, 127, 133, 135, 148, 152, 155, 157) production returns nothing after 5.4–15.1 s, while full1600 reads the JOB QR in about 85 ms. prodWarm behaves the same way on the 16 MP tickets 43, 44 and 46. This, together with the 16 MP rejection of 40–49, accounts for most of production's JOB gap (51 vs 78–85).
- **FOM routing.** `classifyTicketBarcode('FOM6909075')` is `productBarcodeText` (`/^FO\d{4,}$/`). For the 12 `FOM…` tickets, production's own field assignment puts the JOB into the product field. That is why field-OK (41) is lower than pair yield (47). Whether `FOM` is an official JOB prefix is a domain decision. The printed header says `JOB NO. FOM…`.
- **Product decode is the bottleneck in every variant.** Best pair yield: cascade 57/92; production and cascade together reach 62/92.
  - Production-only pairs: 50, 56, 61, 103, 156 (band/curve sweep).
  - Cascade-only pairs: 40–42, 45, 47–49 (16 MP), 53, 54, 63 (production marked them review), 58, 84, 139, 140, 150.
- **No JOB for any variant:** 81, 112, 122, 143, 165, 166. 103 is read only by production.
- **No wrong or multiple JOB values** in any variant on real photos.
- **Images 145/146 (product labels, no JOB):** every variant correctly returned no JOB. No product barcode was decoded either; production spent about 15 s on each.

### Manual product check (printed text under the product barcode)

`kiro/manual-products.json`: 18 tickets examined, 14 legible (2 of those medium confidence), 4 illegible or partially covered (81, 90, 152, 165). Printed text is the human-readable line and is assumed, not proven, to equal the payload.

| Variant             |                Match /14 | Mismatch |     No read |
| ------------------- | -----------------------: | -------: | ----------: |
| production          | 8 (40 rejected by 16 MP) |        0 | 5 + 1 error |
| prodWarm            |                        9 |        0 |           5 |
| full1600 / full3000 |                    3 / 4 |        0 |     11 / 10 |
| roiFast / roiHard   |                    7 / 8 |        0 |       7 / 6 |
| cascade             |                        9 |        0 |           5 |

No variant decoded a product that disagreed with legible print. Every variant missed 112, 142, 148 and 155. The cascade and ROI variants also missed 50, and production also missed 84. The sample is too small to bound the product misread rate.

### Review-required results

- **Production:** 4 tickets (51, 53, 54, 63), whole result flagged by the curve path.
- **Cascade stage D:** 15 `F2-L27-13` (matches the manifest), 21 `F2-L28-14` (matches) **plus a garbage candidate `F(UL2W-'4`**, and 56 product `MPCT-ZPBOXR3642R2-BOX-F` (unverified). This confirms that `minLineCount:1` output must stay review-only.
- **Cascade stage reached:**
  - Location: A/B 16, C 8, D 35.
  - Ticket: A 4, B 34, C 19, D 37.
  - Budget hits: 0.

## Repeated timing — fixed stratified subset, 3 rounds

Subset (selected after pass 1, fixed before repeats), 6 location and 10 ticket images:

- **Location:** 4 easy, 2 multi-label, 20 read by production only, 7 cascade rescue, 74 visual/no-read, 28 >16 MP
- **Ticket:**
  - Easy, >16 MP and FOM: 70 easy, 43 >16 MP, 58 FOM (cascade only)
  - Hard photos: 84 rotated, 142 glare under film, 152 blur, 81 tape/no-read
  - Expensive or special: 80 (production 9.9 s), 145 product label, 99 wrinkled

| Variant  | Round p50 (ms)  | Round p95 (ms)        | Median per-image spread | Outputs identical across rounds |
| -------- | --------------- | --------------------- | ----------------------: | ------------------------------- |
| full1600 | 72 / 65 / 65    | 105 / 101 / 101       |                     4 % | yes                             |
| full3000 | 128 / 123 / 122 | 240 / 236 / 233       |                     3 % | yes                             |
| roiFast  | 151 / 136 / 129 | 313 / 309 / 298       |                     9 % | yes                             |
| roiHard  | 176 / 176 / 170 | 447 / 443 / 425       |                     6 % | yes                             |
| cascade  | 205 / 201 / 197 | 1,160 / 1,170 / 1,117 |                     4 % | yes                             |

Timings are stable within about 10 % and decoding is deterministic. The cascade's p95 on this subset (about 1.15 s) is higher than its full-set p95 because the subset over-samples hard images.

## Controls (synthetic, not counted as photos)

The controls are JPEGs generated in the browser:

- blank (2160×2880)
- gray noise
- text-only: printed "JOB NO. FO69100219" and "F1-L3-10" with pipe characters and irregular stripes
- two side-by-side composites of real photos: tickets 50+51, locations 1+4

| Control                   | production                            | full1600 | full3000 | roiHard | cascade                     |
| ------------------------- | ------------------------------------- | -------- | -------- | ------- | --------------------------- |
| blank / noise / text-only | none (4.1 / 6.9 / 5.1 s)              | none     | none     | none    | none (0.12 / 1.44 / 0.29 s) |
| 2 tickets                 | 2 JOBs + product `SSD-OB3P422T-BOX-F` | 2 JOBs   | 2 JOBs   | 2 JOBs  | 2 JOBs                      |
| 2 locations               | both                                  | none     | none     | both    | both                        |

No control produced a false identity. Every variant that read a composite reported both identities. None picked one silently.

## Incremental wins and losses

- **tryHarder false → true (full1600):** +14 JOB, +15 pairs, +6 locations for +13 ms p50. `tryHarder:false` is useful only as stage A.
- **1600 → 3000:** +3 JOB, +18 pairs, +9 locations for +56 ms p50. Resolution matters for the dense product Code128 and the small location bars.
- **Full-frame → native ROI (roiHard vs full3000):** +12 pairs, +6 locations, −6 JOB (likely cause, not traced: the ROI variants read QR only at 1600). +52 ms p50, +218 ms p95.
- **Cascade vs roiHard:** +10 JOB, +8 pairs, +1 location, 2 review locations; +12 ms p50, +399 ms p95.
- **Cascade vs production:**

  | Change               | Count |
  | -------------------- | ----- |
  | JOB exact            | +34   |
  | Pairs                | +10   |
  | Field-routed pairs   | +6    |
  | Location wrong reads | −4    |
  | Location exact       | −2    |

  Plus 3× faster p50 and 17.6× lower p95. The cascade loses 5 location reads (JS reader) and 5 product pairs (band/curve sweep).

## Recommendation for the parent

Parent follow-up: mobile diagnostics subsequently traced several wrong live-fallback values to the primary **Code128** reader itself (`mobile/raw/diagnose.jsonl`). Removing all-format fallback alone therefore cannot be treated as a complete false-read fix. The static wrong-read attribution above remains a hypothesis; require canonical identity validation and measure the proposed rescue before shipping. The final assessment is `docs/reviews/topgold-scanning-final-2026-10-16.md`.

1. Prepare a bounded working bitmap for photos above 16 MP rather than rejecting this whole size group; for example test `createImageBitmap` resizing while retaining originals for region crops. Twenty images share the 3472×4624/4624×3472 dimensions. All 20 can enter the alternative pipelines, but that does not mean all 20 are successfully decoded. The resized-production proposal itself has not been benchmarked.
2. For tickets, always return the JOB even when no product is found. Report a partial result, and do not spend the 15 s attempt budget silently.
3. Decide whether `FOM…` is a JOB number. If it is, widen `classifyTicketBarcode` (12/92 tickets here).
4. Make the cascade (A→B→C, D review-only) the default image path. Then add, and measure, two bounded rescues:
   - the production band/curve sweep, only when a JOB was found but no product;
   - the JS ZXing Code128/QR primary reader on unresolved location ROIs, without the all-format fallback.
     Expected upper bound from the union: location 28/58, pairs 62/92. This is not measured as a single pipeline.
5. Keep the session-reused worker. Production's per-image worker costs about 60 ms (p50) on desktop and probably more on phones; this is unmeasured here. Keep terminate-on-cancel.

## Not tested

- Live camera frames, autofocus, torch, real Android or iPhone CPUs, Safari/WebKit decode behaviour or memory limits. The mobile follow-up is owned by the other agent.
- Network, Next.js hosting, or the AI/OCR detail fields: delivery date, part name, quantity.
- Native `BarcodeDetector`, html5-qrcode, binarizer variants, perspective rectification.
- A tuning/evaluation split. The cascade parameters were fixed before pass 1 and not tuned afterwards, so there is no held-out claim.
- True product accuracy beyond 14 legible manual reads; true QR accuracy beyond equality with the provisional JOB.
- `F1-L3-11` in image 2 and the 23 visually identified location photos are no-reads everywhere. I did not check whether their bars are physically decodable.

## Artifacts

All raw data is under `docs/reviews/assets/topgold-scanning-2026-10-16/kiro/`.

| Path                                          | Content                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| `raw/setup.jsonl`, `raw/probe.jsonl`          | Cold/warm startup; per-image SHA-256, bytes, dimensions, main-thread `bitmapMs` |
| `raw/pass1.jsonl`                             | 1,224 rows (8 variants × 153), run order, browser/platform metadata             |
| `raw/repeat.jsonl`, `raw/controls.jsonl`      | Repeat rounds (240 rows) and synthetic controls (25 rows)                       |
| `per-image-pass1.csv`, `per-image-repeat.csv` | Scored per-image rows including the manifest hash                               |
| `summary-pass1.json`, `summary-repeat.json`   | Aggregates for all images, the 133 eligible images, and per round               |
| `manual-products.json`                        | Manual printed product codes, with confidence                                   |

The benchmark source is in `scripts/topgold-scan-benchmark/kiro/`: `server.mjs`, `runner.js`, `variants.worker.js`, `drive.mjs`, `analyze.mjs`. To reproduce, run:

```sh
node scripts/topgold-scan-benchmark/kiro/server.mjs &
node scripts/topgold-scan-benchmark/kiro/drive.mjs setup
node scripts/topgold-scan-benchmark/kiro/drive.mjs probe
node scripts/topgold-scan-benchmark/kiro/drive.mjs pass1
KIRO_SUBSET=4,2,20,7,74,28,70,43,58,84,142,152,81,80,145,99 \
  node scripts/topgold-scan-benchmark/kiro/drive.mjs repeat
node scripts/topgold-scan-benchmark/kiro/drive.mjs controls
node scripts/topgold-scan-benchmark/kiro/analyze.mjs pass1 repeat
```

`drive.mjs` appends to the JSONL files, so remove the old raw files before a clean rerun. The source passes `node --check`, scoped ESLint (0 errors, 0 warnings, no lint exceptions) and Prettier.
