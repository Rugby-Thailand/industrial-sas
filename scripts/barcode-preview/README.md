# Barcode verification on real components

Run `pnpm exec vite --config scripts/barcode-preview/vite.config.mjs`, then open <http://localhost:3219>.

The harness renders the production location picker, JOB ticket page, shared camera/image scanner, and field replacement dialogs with the application CSS and English/Thai translations. Only authentication, backend access, navigation, upload, and Next image presentation are adapted. Location lookup and saves use synthetic sample responses; no inventory is written. AI and uploads throw if accidentally invoked.

The actual production worker and local reader WASM decode every image. In the browser console, run `await runSyntheticBarcodeRegression()` to check Code128, QR, JOB, product, rotated and multiple codes, printed-text-only negatives, and JOB-only negatives. `await barcodeFixture(["FO12345678", "DEMO-PRODUCT"])` creates a synthetic File for file-input automation. Text printed below each barcode deliberately differs from the encoded value.

Optional private corpus: start the harness with `BARCODE_PRIVATE_MANIFEST=/absolute/path/manifest.json` and run `await runPrivateBarcodeCorpus(2)`. The manifest is an array of `{name, sourcePath, expectedProduct, expectedJob}`. Only allowlisted photographs are exposed locally; expected values are available only to the test runner, never to the decoder. Keep the manifest and photographs outside version control. The supplied ten-photo corpus includes three duplicate pairs (seven unique images).

Image scans always require acceptance before applying results; geometrically corrected reads add a stronger review warning. Several identities require a selection, except a single JOB/product pair which is applied together. Camera denial, cancellation, manual editing, modal close, source switches, and warehouse changes must not allow stale results to populate fields.

This is real-component browser verification with synthetic backend responses. Authenticated backend behavior has separate tests. Physical phone camera hardware and mobile-browser performance need a device run.
