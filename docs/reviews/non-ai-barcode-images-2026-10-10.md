# Non-AI barcode integration verification

Production scope: shared camera/image acquisition, warehouse location resolution,
JOB ticket intake, individual JOB/product field scanning, and destination scanning.
The implementation runs a pinned local ZXing reader in an owned cancellable worker.
It does not infer barcode identities from printed text or upload selected images.
Existing backend lookup, permissions, field replacement, duplicate-unit review,
and save validation remain authoritative.

The implementation plan is [saved here](../plans/non-ai-barcode-images.md).
Worktree: `industrial-sas-barcode`; branch: `fix/non-ai-barcode-images`;
comparison base: `b232565f322c7f1fd7279b2184435949eea4436d`.

## Photo and browser evidence

- Supplied private photos: 20/20 exact JOB/product matches over two final rounds.
  There are ten files, including three repeated pairs, hence seven unique photos.
  Final elapsed times were 117–1,023 ms in round one and 117–778 ms in round two
  on this desktop browser. Earlier cold runs were slower; this is not a mobile
  performance guarantee.
- Both curved-image files required explicit corrected-read review in both rounds.
  The search used 16 attempts for those photos; other photos used 1–7 attempts.
  Expected identities are supplied only to the regression runner, not the decoder.
- Synthetic actual-worker cases cover Code128, QR, JOB, product, rotation, multiple
  identities, printed-text-only negatives, and a JOB-only negative for product
  intake. Checked-in fixtures contain synthetic identities only.
- Real-component browser suite: 18 passed, two existing desktop-only cases skipped
  on mobile. Twelve passing cases exercise barcode behavior across desktop/mobile,
  including denied camera access, image acquisition, lookup, paired intake, repeated
  units, save payloads, cancellation, replacement/Escape, 320 px layout, Thai/English,
  dark/light themes, and WCAG A/AA checks.
- Production smoke suite: 82 passed, including desktop/mobile execution of the
  actual compiled Next.js worker and a direct unredirected WASM request. This caught
  and fixed a locale-proxy redirect that the Vite component harness could not detect.
- Formatting, TypeScript, and ESLint passed; 193 unit/accessibility test files
  passed with 2,217 tests. Production build, test discovery, and the production
  dependency audit passed. Clean-tree verification runs after committing the
  reviewed changes.

## Standards

Final independent standards re-audit: zero documented violations and zero
remaining heuristic findings. Client boundaries, fixture privacy, worker cleanup,
bitmap disposal, object URL revocation, and stale-result guards passed review.
The initial possible duplicated-classification smell was resolved by sharing the
existing pure `classifyTicketBarcode` helper.

## Spec

Final independent requirements re-audit: zero remaining findings. The initial P2
finding was fixed: accepting another photo of a complete matching JOB/product pair
now creates another physical-unit row. Compatible incomplete rows can still be
filled. Domain, component, and browser regressions require duplicate review before
the two-unit save and verify both saved items.

Standards: 0 remaining findings. Spec: 0 remaining findings.

## Limits and reproduction

The [HTML component harness](../../scripts/barcode-preview/README.md) renders the
production UI with synthetic backend responses. It verifies request envelopes and
absence of image uploads/AI calls, but does not claim a live authenticated inventory
write. Physical iOS/Android camera hardware and mobile-browser performance have not
been tested. Unsupported formats and browser APIs surface actionable errors.
Selected files are limited to 25 MiB and 16 megapixels; processing has bounded
attempts, an internal deadline, and an outer worker termination deadline.

Run `pnpm check`, `pnpm build`, `pnpm test:e2e`, and `pnpm test:e2e:workspace`.
The harness README documents private-corpus reproduction without committing
customer photographs or identities. See the pinned WASM and licenses under
`public/barcode/`.
