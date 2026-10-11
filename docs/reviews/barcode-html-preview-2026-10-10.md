# Barcode HTML preview verification

Date: 2026-10-10. Result: interactive preview complete; production application unchanged by this work.

The [preview source](../../src/features/finishedGoods/jobScan/_prototype/barcode/README.md) provides location selection and product/JOB scanning in the existing warehouse shell. Thai and English, dark and light, independent image/camera acquisition, seven manual optional fields, field scanner dialogs, explicit replacement confirmation, and an in-memory save receipt are included. The [plan](../plans/barcode-html-preview-2026-10-10.md) was saved before implementation.

Verified in the T3 collaborative browser:

- Actual photo 3 decoding, first in the page and then in the worker, returned `FO69070018` and `TDK-MPD-0131070-TRW-F`. Accepting the result filled only those two identities, left all seven optional fields empty, and enabled Save. Save displayed the matching in-memory receipt.
- The curved photo 2 reached the worker's 15-second budget in this environment. Unreadable-image feedback remained usable and identities stayed blank. Its confirmation UI is separately available as a clearly labeled sample state. The earlier benchmark's 10/10 result is not claimed for this preview worker.
- The sample curved-label state required explicit acceptance. Replacing both existing JOB and product values required separate confirmations, without applying the first change before the second confirmation.
- Image cancellation returned to the picker and did not apply a late result. Photo decoding runs in a terminable worker with a 20-second outer timeout.
- Sample location `F2-L28-18` resolved to the sample slot and continued to the product page. Unknown-location feedback was distinct from barcode-read failure. Sample camera denial retained the image picker.
- Both language and theme controls worked. Escape closed the field scanner and restored focus to its originating control. Dialog and main content had unique element IDs.
- Inspected desktop at 1280 px and mobile at 390 and 320 px, including English/light mode. A 320 px header overflow was corrected; final checks found no horizontal overflow and mobile controls met the 48 px height target.
- Focused ESLint, JavaScript syntax checks, and changed-file Prettier checks passed. The impeccable detector reported only the inherited Geist font; it was retained to match the existing application visual authority.

Location mappings, preview failure states, and saves are in-memory examples. Real camera acquisition is implemented but was not validated on a physical phone. Photo (AI) is disabled in this preview. No AI calls, image uploads, or production data writes occur.

Screenshots:

- [Location, desktop](assets/barcode-html-preview-2026-10-10/location-desktop.png)
- [Location, mobile](assets/barcode-html-preview-2026-10-10/location-mobile.png)
- [Product curved-label confirmation, desktop](assets/barcode-html-preview-2026-10-10/product-review-desktop.png)
