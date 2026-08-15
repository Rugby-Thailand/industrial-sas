# Phase 5A Claude Implementation Checkpoint Review

Decision: **FAIL — do not merge or begin Phase 5B**
Reviewed: 2026-08-15
Implementation agent: Claude CLI 2.1.226
Specification: [Figma order-to-ship operating plan](../figma-order-to-ship-operating-plan.md) and `PROJECT_PLAN.md` Phase 5A

## 1. Scope and fixed point

The fixed point was the exact worktree state before Claude started:

- Commit: `132a6194625b867ff7b1b5fd29421f4fb06d8c77`
- Branch: `main`
- Baseline quality: lint, typecheck, tenant-boundary verification, and all 2,449 tests passed.
- Existing dirty files were recorded before Claude ran and were excluded from attribution.

Claude created or changed the Phase 5A domain, schema, permission, sales, engineering, production-packet, ADR, and typed frontend-interface files. It did not create application routes or feature UI.

The first Claude session ended with `API Error: Connection closed mid-response`. Subsequent Claude sessions reached the account's monthly spend limit before UI implementation could start.

## 2. Automated evidence

| Check                          | Result                                      | Evidence                                       |
| ------------------------------ | ------------------------------------------- | ---------------------------------------------- |
| Targeted Phase 5A domain tests | PASS                                        | 4 files, 145 tests                             |
| Full test suite                | PASS                                        | 154 files, 2,610 tests                         |
| Integration project            | PASS, but no new Phase 5A integration tests | 30 files, 585 tests                            |
| Isolation project              | PASS, but no new Phase 5A isolation tests   | 14 files, 320 tests                            |
| Accessibility project          | PASS, but no Phase 5A UI exists             | 8 files, 74 tests                              |
| Typecheck                      | PASS                                        | `tsc --noEmit`                                 |
| Lint                           | PASS                                        | `eslint . --max-warnings=0`                    |
| Tenant-boundary guard          | PASS                                        | 80 Convex production files checked             |
| Production build               | PASS                                        | 48 generated pages; no Phase 5A routes         |
| Format check                   | FAIL before reviewer formatting             | 11 touched files required Prettier             |
| Phase 5A E2E                   | NOT PRESENT                                 | No order/design/factory-packet browser journey |

Green existing suites do not establish Phase 5A release readiness because all new tests are pure-domain tests. No new public Convex function, tenant relationship, retry/concurrency path, private-file operation, or UI journey is exercised in its integration/isolation/E2E tier.

## 3. Standards

- **P0 — Hard violation:** `convex/engineering/masterCards.ts:586-589` patches a previously `RELEASED` revision's `status` to `SUPERSEDED`. ADR-0013 decision 10 / `INV-0013-02` and glossary `G-127` permit changing only `supersededByRevisionId`. Existing packets consequently no longer pin a `RELEASED` revision.
- **P0 — Hard violation:** `convex/engineering/masterCards.ts:564-606` releases a revision with `uniqueness: []`, then directly changes the card's `designKey`. It never checks whether another card for that customer already owns the key, violating `convex/lib/schemaPolicy.ts` and ADR-0013 `INV-0013-01`; exact-match lookup can become ambiguous.
- **P1 — Hard violation:** `convex/model/orderToShip/designSpecification.ts` defines/key-encodes only style, dimensions, board grade, and colour count. Glossary `G-125` says a box specification includes flute and finishing, while `G-122` says key equality means design equality. Distinct factory designs can collapse to one key.
- **P1 — Hard module-seam violation:** lifecycle and design-substitution rules remain inside public Convex handlers in `convex/engineering/designRequests.ts`. `PROJECT_PLAN.md` §6.2 and ADR-0002 require thin functions calling pure domain modules.
- **P2 — Hard documentation drift:** `docs/permissions.md` still claims eight default roles and no WMS operation exists, while `convex/lib/permissions.ts` adds four roles and the slice exports operations. ADR-0006's verification contract also still says eight.
- **P2 — Judgment call, Divergent Change / Mysterious Name:** `masterDataStore` now handles customer orders, revisions, requests, and packets. Extract and rename the generic idempotent tenant-write facility; keep master-data policy in the master-data module.
- **P3 — Judgment call, Duplicated Code:** `convex/lib/masterDataStore.ts` adds `insertedFields`, but the generic create path duplicates insertion mapping with `String(value)`, preserving divergent `[object Object]` audit output.

Standards summary: 7 findings. Worst issues: released-revision mutation and missing release-time uniqueness enforcement.

## 4. Specification

- **P0 — Exact matching implements the wrong identity.** The specification requires matching by customer + customer product code. Lines contain no customer product code; they automatically pin using style, dimensions, board grade, and colour count. Distinct products or artwork can therefore reuse the wrong revision.
- **P0 — Private files are explicitly nonfunctional, yet metadata alone permits release.** The required private `FileStoragePort` is absent and access always refuses, while submission merely checks that one metadata row exists. A nonexistent dieline can be approved.
- **P1 — The master-card model is a six-field stub.** It omits bilingual identity, cut-sheet/tolerances, flute/layers, printing, packing, route, notes, calculations, materials, quality requirements, and approval records required by the plan.
- **P1 — Factory packets omit production evidence.** They contain no route, approved-file evidence, release evidence, SO reference, or customer-PO reference.
- **P1 — Phase 5A UX is absent.** No customer-order register/detail/form, engineering queue/editor/comparison, factory queue, printable packet, bilingual copy, or responsive/accessibility states exist. The only frontend addition is a function-reference module.
- **P1 — Similar-design confirmation and import/migration are missing.** Similarity is explicitly deferred and no line import or previewed resumable legacy migration exists.
- **P1 — Release-gate evidence is overstated.** Touched tests are pure model tests only; no Phase 5A integration, isolation, concurrency, retry, accessibility, or E2E suite exists.
- **P2 — Engineering queue persistence is partial.** `designRequests` stores neither priority nor due date and lacks the required `IN_PROGRESS` / `IN_REVIEW` lifecycle and overdue visibility.

Specification summary: 8 findings. Worst issues: unsafe automatic design reuse and approval without durable private-file evidence.

## 5. UX, color, layout, and accessibility

Decision: **Not reviewable / failed by absence.**

The production build lists no sales, customer-order, engineering, master-card, or factory-packet routes. No new English or Thai messages were added. Therefore there is no evidence for:

- Navigation and task discoverability.
- Color/status semantics or contrast.
- Layout, spacing, typography, or responsive breakpoints.
- Form validation, loading, empty, error, denied, stale, and success states.
- Keyboard operation, focus management, touch targets, or screen-reader semantics.
- Dense-list scanability, printing, revision comparison, or factory presentation.

Existing accessibility tests passing does not cover an absent interface.

## 6. Database and domain design

### Blocking findings

- A released revision is mutated to another status despite the declared immutability contract.
- Release bypasses the documented customer/design-key uniqueness contract.
- The key used for automatic exact reuse is incomplete and is not the approved business identity.
- File metadata can satisfy a release prerequisite without verified bytes or storage state.
- Factory packets snapshot an incomplete specification and omit route/file/release evidence.
- Required queue attributes and lifecycle states are absent.

### Positive evidence

- New tenant tables use the repository tenant-field and `orgId`-first index conventions.
- The tenant-boundary static guard recognizes the new production files.
- List functions use the new capped page-envelope pattern rather than obvious unbounded collection.
- Public functions declare code-owned permissions.
- Pure modules cover several customer-order, revision, design-specification, and packet transition rules.

These positives do not offset the P0 invariant violations.

## 7. Feature, security, and privacy

- Automatic design reuse can choose the wrong released design, which is a core product/safety defect.
- Existing factory packets may reference a revision whose status was later changed away from `RELEASED`.
- File access fails closed, which is safe in isolation, but the release workflow incorrectly treats unverified metadata as sufficient approval evidence.
- No integration evidence proves cross-tenant refusal for new relationships or functions.
- No retry/concurrency evidence proves idempotent behavior through the real Convex function/storage seam.
- No UI exists to evaluate role-specific action exposure or information leakage.

## 8. Performance and boundedness

Static review found no obvious new unbounded `.collect()` in the Phase 5A modules, and list interfaces use capped page requests. However, release readiness still lacks:

- Query/read-set measurements for customer/order/card/request/packet lists.
- Concurrency tests for duplicate order lines, revision release, exact-key ownership, and packet issue/acknowledgement.
- Hot-key tests for one customer/product design key and one popular order/factory queue.
- Payload and subscription review for the future structured master-card editor and file previews.
- Production-scale import/migration design and chunking evidence.

Performance status: **unverified**, not failed by a measured regression.

## 9. Required remediation order

1. Remove dimension/style-based automatic exact reuse. Add customer product code and require the approved customer + customer-product identity; keep similarity as separately displayed human-confirmed suggestions.
2. Restore released-revision immutability and enforce release-time uniqueness in the same transaction.
3. Implement the complete structured master-card model, route, quality requirements, calculation evidence, approval evidence, and packet snapshot.
4. Wire and verify private file storage; do not allow release from metadata-only files.
5. Move remaining lifecycle rules behind pure domain-module interfaces.
6. Add public-function integration, tenant-isolation, authorization, retry, and concurrency tests.
7. Implement bilingual responsive customer-order, engineering, and factory-packet UX with accessibility and E2E evidence.
8. Implement previewed resumable import/migration and representative legacy fixtures.
9. Re-run the complete process in `docs/order-to-ship-review-process.md` before Phase 5B.

## 10. Final decision

| Severity | Count |
| -------- | ----: |
| P0       |     4 |
| P1       |     8 |
| P2       |     4 |
| P3       |     1 |

Decision: **FAIL.** Zero Phase 5A release gates are accepted, and Phases 5B–5F have not started. Claude CLI cannot continue until the account spend limit is raised or reset.
