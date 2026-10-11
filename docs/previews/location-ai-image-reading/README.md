# Location image reading preview

An interactive HTML preview for the location picker on `/en/finished-goods/scan`.

The location input has two independent 48 px controls:

- **Barcode / QR** opens the camera immediately. The preview automatically simulates detecting `F2-L28-18`, applies the sample warehouse match and closes acquisition without calling AI.
- **AI** opens the camera immediately for a single photo, with image selection available as an alternative. Capture/selection starts AI reading automatically, followed by editable code review and confirmation before a sample warehouse lookup.

Images can be selected from a real file input or captured with the browser camera. A native phone-camera input remains available when the browser camera fails. Switching acquisition icons starts a fresh camera session and discards outstanding results. AI reads one captured/selected photo automatically; it never reads live frames continuously. The web shutter plays a short local sound when audio is available.

## Open

From the repository root:

```sh
python3 -m http.server 3186 --bind 127.0.0.1 --directory docs/previews/location-ai-image-reading
```

Open <http://localhost:3186/>. Start with either icon beside the location input; both immediately request camera access. In AI mode, **Try the sample label → Review code → Use this code** demonstrates the complete flow. Choose a different sample AI response to explore multiple codes, unreadable text, provider failure or an unavailable location. English/Thai and light/dark controls are in the header.

## Preview boundary

AI, barcode decoding and warehouse resolution use sample responses; an uploaded photo does not determine the returned code. No image leaves the browser, no provider is called and no job record is saved. Crop controls show an overlay; crop encoding belongs to production implementation. The main sample warehouse recognizes only `F2-L28-18` and `F2-L28-1`. Other codes or the annex warehouse remain unselected.

The sample photo comes from `tests/fixtures/barcode-photos/location-18.webp`. Its provenance is recorded beside the copied asset. Production work is defined in [the implementation plan](../../plans/location-ai-image-reading-2026-10-10.md).

## Verification

Verified in the collaborative browser: file selection and WebP preview; crop overlay; editable AI review and confirmation; multiple-candidate selection; exact position suffix; unreadable/provider/unavailable states; manual entry; image replacement, cancel, warehouse changes, typing, source switching and scanner closure suppressing stale responses. Both icon entry points and the camera-first paths are covered by the latest revision.

Camera denial, capture, and track cleanup were checked with synthetic browser media. Actual phone hardware and real AI/provider/backend extraction have not been tested by this preview. Thai layouts at 320 px and 390 px and Thai/English desktop layouts were captured; the checked layouts had no horizontal overflow. Prettier and inline JavaScript syntax checks passed.
