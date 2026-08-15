# Phase 5A acceptance record

Date: 2026-08-15
Fixed point reviewed: worktree based on `132a6194625b867ff7b1b5fd29421f4fb06d8c77`

## Decision

**PASS for the Phase 5A code gate.** The existing-design and new-design branches
both reach an acknowledged factory packet in the Convex runtime suite. Thai and
English production routes pass the responsive browser and automated WCAG checks.
Private upload, attachment, current-object verification, packet access, tenant
isolation, retry, and orphan-cleanup paths are exercised separately at their
actual storage and HTTP seams.

This is an automated acceptance record against local production code. It is not
a pilot-site training acknowledgement or a deployed production rehearsal.

## Recorded walkthrough

### Existing released design

1. Sales creates an order and adds a line using the customer's product code.
2. The server finds only an `ACTIVE` master card for the same customer and code,
   pins its released revision, and creates no design request.
3. Sales releases the order, Production issues the immutable packet snapshot,
   and the factory acknowledges it.
4. The runtime assertion verifies `designSource: EXISTING`, `HANDED_OFF`, the
   pinned revision, no design request, and packet `ACKNOWLEDGED`.

Recorded by `tests/integration/order-to-ship-runtime.integration.test.ts`.

### New design and private file

1. A new customer product creates an `AWAITING_DESIGN` line and one design
   request.
2. Engineering creates the full structured card, obtains a revision-bound upload
   grant, uploads through the private gateway, binds the returned storage object
   to that grant, and attaches the verified file.
3. The maker submits; an independent user releases; Engineering fulfils the
   request with that released revision.
4. Production issues the packet from the pinned snapshot and the factory
   acknowledges it. Repeating every request ID returns the stored result instead
   of applying the transition twice.

Recorded by `tests/integration/order-to-ship-runtime.integration.test.ts`,
`tests/integration/private-file-gateways.integration.test.ts`, and
`tests/integration/private-file-storage.integration.test.ts`.

### Thai, English, accessibility, layout, and handheld operation

- Thai: sales, engineering, and packet routes pass light/dark Axe scans.
- English: the same three routes pass light/dark Axe scans, and the workflow
  remains in English while moving across the three route contexts.
- The printable packet exposes the full specification and usable approved-file
  controls.
- At handheld width the packet has no document overflow and its acknowledgement
  action is reachable.

Recorded by `tests/e2e/order-to-ship.preview.e2e.spec.ts`,
`tests/e2e/order-to-ship.preview.handheld.e2e.spec.ts`, and
`tests/e2e/accessibility.preview.e2e.spec.ts`: **27/27 passed** on isolated ports.

## Security and isolation evidence

- Cross-tenant discovery is refused for every Phase 5A aggregate, relationship,
  upload/download grant, and the HTTP file gateway.
- A grant can attach only the exact storage ID completed through its gateway.
- Failed binding removes orphaned bytes and releases the claim for a safe retry.
- Legacy files require row/batch-bound upload grants; verified legacy releases
  require explicit independent legacy approval provenance.
- Submission and packet issue fail when an `AVAILABLE` storage object has since
  disappeared.

## Quality results

| Gate                                              | Result                                                |
| ------------------------------------------------- | ----------------------------------------------------- |
| TypeScript strict check                           | PASS                                                  |
| ESLint                                            | PASS                                                  |
| Unit/integration/isolation/a11y Vitest            | 165 files, 2,679 tests PASS                           |
| Phase 5A browser/a11y/handheld check              | 27 tests PASS                                         |
| Production build                                  | PASS, 54 pages including Thai/English Phase 5A routes |
| Tenant/workflow/native-control/environment guards | PASS                                                  |
| Production dependency audit                       | PASS, no known high-severity vulnerability            |

The repository-wide browser run recorded 210 passes, one intentional visual
capture skip, and one pre-existing handheld execution of a desktop-shell
navigation test timing out because its collapsed sidebar link was outside the
viewport. The Phase 5A browser projects and routes all passed; this unrelated
shell-test issue is not counted as Phase 5A acceptance evidence.
