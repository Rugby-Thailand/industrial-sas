# Non-AI barcode integration verification

Production scope: shared camera/image acquisition, warehouse location resolution,
JOB ticket intake, individual JOB/product field scanning, and destination scanning.
Selected images decode locally in an owned cancellable worker with a pinned
first-party ZXing WASM reader. Barcode identities come from barcode pixels.
Backend permissions, identity resolution, replacement confirmation, duplicate-unit
review, and save validation remain authoritative.

The [saved plan](../plans/non-ai-barcode-images.md) preceded implementation.
Worktree: `industrial-sas-barcode`; branch: `fix/non-ai-barcode-images`.
Initial base: `b232565`; integration base: main `41c73ff`.
The merge preserves exact location lookup, location registration, storage format,
camera framing, manual crop/retry, and the separately invoked AI location workflow.
Image selection alone never invokes AI or uploads the image.

## Photo and browser evidence

- Supplied private product photos: **20/20 exact JOB/product matches**, with no
  extra codes, over two final rounds. Ten files contain seven unique photos.
  Final desktop timings were 132–6,255 ms in round one and 131–613 ms in round
  two; earlier warm runs were faster. These are not mobile latency guarantees.
- Both curved-image files required corrected-read review in both rounds, using
  six search attempts after moving the small curved-bar probe earlier; other
  photos used 1–11 attempts. Expected identities are
  supplied only to the regression runner. Private photos and expected customer
  identities are excluded from the PR.
- Eleven synthetic actual-worker cases cover Code128, QR, Code39 product codes,
  JOB/product pairing, rotation, multiple codes, crop isolation, printed-text-only
  negatives, and a JOB-only negative for product intake.
- Workspace browser suite: **42 passed, two existing mobile skips**, including
  a fresh CI-mode run with empty dependency caches. Coverage
  includes the six existing warehouse photo fixtures in Thai/English on
  desktop/mobile, distinct linear/QR choices, camera denial, crop/retry,
  cancellation, replacement/Escape, duplicate physical units, save payloads,
  320 px layout, both languages/themes, and WCAG A/AA checks. Existing explicit
  AI camera/review behavior remains covered.
- Production build and smoke suite: **88 passed**. The actual compiled Next.js
  worker decodes a product, glare location, noisy location, and empty crop on
  desktop/mobile. The public WASM request succeeds without a locale redirect.
- Formatting, TypeScript, ESLint, and **203 unit/accessibility test files with
  2,333 tests** passed. Test discovery, credential-free local Convex codegen,
  and production dependency audit passed. Clean-tree verification follows the
  merge commit.

## Audit findings resolved

Independent Standards and Spec re-audits report zero remaining meaningful
findings. Worker cancellation, bitmap disposal, object URL revocation, and stale
source/session guards passed review. Barcode classification shares the canonical
`classifyTicketBarcode` helper.

A repeated complete JOB/product pair creates another physical-unit row and
requires duplicate review before saving. Compatible incomplete rows remain
fillable. Domain, component, and browser regressions verify both saved units.

The established location geometry reader runs inside the owned worker at its
existing image scale. It corrects a disagreeing noisy singleton Code128 read;
multiple valid WASM identities and all QR candidates survive for explicit choice.
Regressions cover engine-set disagreement, invalid-result exclusion, and cleanup.
Exception handling uses the library's stable `getKind()` in minified builds.

GitHub CodeQL findings prompted two additional fixes: full-label review now uses
an image-only dialog instead of navigating to uploaded file contents; the worker
checks message origins and permits only the app's pinned WASM URL. Unit boundary
regressions and desktop/mobile full-review accessibility flows pass. A concurrent CPU-heavy run exhausted the 15-second search deadline on one curved
label. Moving the small curved-bar probe ahead of large-band rotations reduced
its search from 16 attempts to six; repeated exact-match rounds passed afterward.
Busy devices can still reach the bounded timeout and use crop/retry.

Explicit
verification-harness dependency preoptimization prevents cold-start page reloads
from interrupting the synthetic worker loop.

## Limits and reproduction

The [HTML component harness](../../scripts/barcode-preview/README.md) renders the
production UI with synthetic backend responses. It verifies lookup/save envelopes
and absence of automatic image uploads/AI calls, but does not perform a live
authenticated inventory write. Physical iOS/Android camera hardware and mobile
performance have not been tested.

Verified paired-label support is Code128 JOB/product labels. Standalone QR and
Code39 product codes are covered. Mixed-format pairs may need manual cropping or
separate field scans. Unsupported browser APIs surface actionable errors.
Files are limited to 25 MiB and 16 megapixels. Processing is bounded by image
search/decode deadlines and an outer worker termination deadline.

Run `pnpm check`, `pnpm build`, `pnpm test:e2e`, `pnpm test:e2e:workspace`,
`pnpm ci:codegen`, `pnpm ci:test-discovery`, and `pnpm audit:prod`.
The harness README documents private-corpus reproduction without committing
customer product photos. Existing warehouse fixtures are retained from main;
new product fixtures use synthetic identities. Pinned WASM licenses are under
`public/barcode/`.
