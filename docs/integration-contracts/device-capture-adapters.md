# INT-08 — Device capture adapters: scanner, camera, GPS, signature, photo

Status: **specification.** No scanner abstraction, camera decoder, geolocation, signature
capture, or photo capture exists. No device permission is requested anywhere in the
current scaffold.

Owner ADRs:
[ADR-0008](../adr/0008-adapter-ports-and-release-gates.md),
[ADR-0005](../adr/0005-warehouse-location-and-stock-identity.md) (identifier parsing),
[ADR-0009](../adr/0009-degraded-online-connectivity.md) (offline behaviour),
[ADR-0010](../adr/0010-thai-first-i18n-and-accessibility.md) (accessibility).

## 1. Capabilities and MVP status

| Adapter           | Capability                                       | MVP status                                                                       |
| ----------------- | ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `ScannerPort`     | Barcode input from an HID keyboard-wedge scanner | **In scope**, primary input (D-04)                                               |
| `CameraScanPort`  | Barcode decoding from the device camera          | **In scope**, secondary fallback (D-04, §5 Q8)                                   |
| `PhotoPort`       | Still-image capture for QC evidence              | **In scope** for QC attachments (§2.1)                                           |
| `GeolocationPort` | Device position                                  | **Deferred**: no MVP use; port defined so nothing improvises later (§5 Q46, Q47) |
| `SignaturePort`   | Signature capture                                | **Deferred**: outbound/POD concern, a standing non-goal (§2.3)                   |

RFID and NFC are deferred (§5 Q8). GPS and signature adapters exist in this document as
contracts only; no code, no permission prompt, and no data collection are planned for the
MVP.

## 2. Direction and trust boundary

Every capture happens in the browser and is therefore untrusted input (§6.1):

- A scan is a **string**, not an identity. Resolution to an item, lot, or handling unit
  happens server-side.
- A decoded barcode from the camera carries the same trust as a typed one.
- A photo is a file whose authorization is decided server-side before upload
  ([`FileStoragePort`](./file-storage-port.md)).
- Device metadata is recorded as context, never as an authorization factor
  (`ADR-0006`).

## 3. Port operations

```ts
type ScannerPort = {
  subscribe(handler: (scan: RawScan) => void): Unsubscribe;
  status(): ScannerStatus;
};

type CameraScanPort = {
  start(options: CameraScanOptions): Promise<CameraScanSession>;
  stop(session: CameraScanSession): Promise<void>;
};

type PhotoPort = {
  capture(options: PhotoOptions): Promise<CapturedImage>;
};
```

`RawScan` carries the exact characters received, the terminator, the elapsed input time,
and the source adapter. The raw string is persisted with every parsed scan
(`INV-0005-12`).

## 4. Timeouts and retries

| Operation                  | Budget                          | Behaviour on expiry                                                    |
| -------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| HID scan assembly          | 300 ms between characters       | Treat as complete; a partial scan is rejected, not guessed             |
| Scan resolution round trip | 1 s target, part of scan-to-ack | Show pending; block the step if resolution is required                 |
| Camera decode attempt      | 10 s per attempt                | Offer manual entry or HID retry                                        |
| Camera permission prompt   | User-driven                     | Fall back to HID; never block the flow                                 |
| Photo capture              | User-driven                     | Cancel returns no image; the step states whether evidence is mandatory |
| Photo upload               | 60 s, resumable                 | Attachment marked pending (see `INT-03`)                               |

Scans are debounced, and a repeat of the same payload inside a short window raises a
plausible-duplicate warning while the `requestId` prevents double posting (§5 Q30).

## 5. Idempotency

- A scan carries no domain effect by itself. The effect comes from the intent the operator
  confirms, which carries a `requestId` (`INV-0003-01`).
- A double scan produces one intent, or two intents with one `requestId` — never two
  postings.
- A photo capture is idempotent per capture session: re-uploading the same image against
  the same entity is deduplicated by content hash.

## 6. Data and privacy

| Data               | Personal data?                     | Handling                                                                 |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------ |
| Raw scan strings   | No                                 | Stored with the parsed result for diagnosis (`INV-0005-12`)              |
| Camera frames      | Not retained                       | Decoding is local; frames are never uploaded                             |
| QC photos          | Possibly incidental (hands, faces) | Private ACL, permission-gated, in the ROPA (`RG-057`)                    |
| Device identifiers | Indirectly identifying             | Recorded as audit context, retained with audit data                      |
| Geolocation        | Yes, if ever collected             | Not collected in the MVP; enabling it requires a lawful basis and notice |
| Signature images   | Yes                                | Not collected in the MVP; would be personal data with its own retention  |

Permissions are requested at the moment of use with an explanation, never on app start.
Denying camera or photo permission must leave a usable workflow (HID scanning plus text
entry), which is also an accessibility requirement (`ADR-0010`).

## 7. Failure semantics

| Situation                               | Behaviour                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| Scanner emits no terminator             | Assembly timeout applies; the operator sees an explicit "incomplete scan" error              |
| Scanner emits an unknown symbology      | Parser precedence exhausts and the scan is rejected explicitly (`INV-0005-11`)               |
| Camera unavailable or permission denied | Fall back to HID and manual entry; record which path was used                                |
| Camera decodes the wrong value          | Raw scan retention makes it diagnosable; confirmation screens show what was read             |
| Photo capture unavailable               | QC step states whether evidence is mandatory; a mandatory-evidence disposition stays blocked |
| Offline during capture                  | Safe intents queue as pending; correctness-sensitive steps are blocked (`ADR-0009`)          |
| WebView too old for a required API      | Detected at startup with an explicit unsupported-device message rather than silent failure   |

## 8. Configuration

Scanner behaviour is device configuration on the customer's hardware, not application
configuration. The application adapts to what it receives; it does not require a specific
scanner profile beyond a reliable terminator (`OPS-0008-02`).

## 9. Verification

- Unit tests: HID assembly with varied inter-character delays, terminator handling,
  partial-scan rejection, debounce and duplicate-window logic.
- Property tests: parser precedence over the fixture corpus, including ambiguous inputs
  that must be rejected (`RG-005`).
- E2E: synthetic HID scan events through the handheld receipt flow (plan §12).
- Accessibility: every capture flow is completable by keyboard/HID alone
  (`INV-0010-08`).
- Physical acceptance: the actual scanner, Android WebView, gloves, and warehouse lighting
  (`RG-003`).

## 10. Release gates

`RG-003` scanner spike, `RG-005` barcode corpus and fixtures, `RG-010` scan-to-ack
latency, `RG-070` fleet confirmation, `RG-042` accessibility audit. See the
[register](../release-gates.md).

## 11. Open questions

- Exact scanner models and terminator configuration in the pilot fleet (`RG-003`).
- Whether Web `BarcodeDetector` is available on the pilot devices or a WASM decoder is
  required (§5 Q8).
- Maximum photo resolution acceptable over warehouse Wi-Fi.
- Whether any pilot workflow ever needs geolocation; if not, the adapter stays a document
  only.
