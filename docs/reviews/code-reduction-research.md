# Code-reduction research

**Snapshot:** commit `a6ceb2e` (`main`), 2026-08-22
**Goal evaluated:** reduce both authored production code and authored test code by at least 50%, comparing a behavior-preserving refactor with an explicit de-scoping scenario.

> This is the pre-implementation evidence snapshot. The two baseline failures
> and the generated-reference policy described below were corrected in the first
> reduction slice; current status and next gates are tracked in
> [`code-reduction-plan.md`](./code-reduction-plan.md).

## Executive verdict

**A 50% reduction in production SLOC is not supported by the evidence if all current behavior and architectural guarantees must remain.** Exact duplication is too small, the largest files contain real domain behavior rather than copied blocks, and the repository deliberately implements unusually strong runtime validation, tenant isolation, audit, idempotency, and test guarantees. A preserve-all-behavior program has a credible production reduction range of roughly **9k–16k SLOC (17%–30%)**, subject to prototypes. It does not close the **26,276-SLOC** production gap.

**A 50% test reduction is more plausible, but not yet proven.** The test suite repeatedly exercises internal seams beneath the tenant wrapper and maintains separate unit, property, integration, isolation, accessibility, and E2E tiers. Replacing layered tests with contract suites and table-driven scenarios could plausibly remove **14k–25k test SLOC (31%–57%)**. The upper bound must be demonstrated by mutation/coverage evidence; it should not be booked before the replacement harness exists.

**Reaching 50% in both requires de-scoping.** The least implausible route is to remove the Phase 5A order-to-ship slice (**8,445 production / 3,193 test SLOC**), revert or radically simplify the recent storage-layout planner (**5,723 production / 974 test SLOC**), and then complete the architectural consolidations below. That changes product behavior. Calling it a refactor would be inaccurate.

Two further cautions:

1. Removing comments can halve _physical lines_ much faster than it reduces code. The broader production inventory contains **16,336 comment lines**. That is valuable cleanup where comments restate ADRs or have gone stale, but it removes zero production SLOC and must not be counted toward a code target.
2. The baseline is currently red. The normal full test run reports two deterministic failures among 2,733 tests: a native `<select>` at `src/features/storageLayouts/StorageLayoutScreens.tsx:170` violates `tests/integration/native-select-guard.integration.test.ts:135-138`, and a bounded array `.filter()` at `convex/storageLayouts/zones.ts:493-500` is flagged by `tests/isolation/tenant-boundary-guard.isolation.test.ts:125-128`. `pnpm lint` and `pnpm typecheck` pass. A reduction branch needs a green or explicitly accepted baseline before behavior preservation can be measured.

## Reproducible baseline

### Primary denominator

The primary measure is `cloc` code lines, not physical lines. The broad inventory includes authored application files under `src/` and `convex/`; it excludes tests and generated artifacts. Top-level build configuration is outside this denominator.

| Scope                               | Code (SLOC) | Blank | Comments | 50% ceiling | Required deletion |
| ----------------------------------- | ----------: | ----: | -------: | ----------: | ----------------: |
| Main authored application           |  **52,551** | 4,708 |   16,336 |      26,275 |        **26,276** |
| Authored tests and test support     |  **43,745** |     — |        — |      21,872 |        **21,873** |
| Tooling under `scripts/` (separate) |   **4,935** |     — |        — | not in goal |                 — |

The test total consists of **27,466 SLOC under `tests/`** and **16,279 colocated test SLOC** under `src/` and `convex/`.

For a narrower cross-check, the following TS/TSX-only rule produces **52,007 production SLOC** across 291 files and **43,725 test SLOC** across 196 files:

```sh
find src convex tests -type f \( -name '*.ts' -o -name '*.tsx' \) |
  awk '
    function test(p) { return p ~ /(^|\/)tests\// || p ~ /\.(a11y\.)?test\.tsx?$/ }
    function generated(p) { return p ~ /convex\/_generated\// || p ~ /\.d\.ts$/ }
    { if (generated($0)) print > "/tmp/generated";
      else if (test($0)) print > "/tmp/test";
      else print > "/tmp/prod" }
  '
pnpm dlx cloc --list-file=/tmp/prod
pnpm dlx cloc --list-file=/tmp/test
```

The broad denominator is retained for the target because authored CSS and non-TS application files inside `src/` and `convex/` are code too. The narrow count is recorded so future measurements do not silently change the denominator.

### Included

- Production TypeScript/TSX in `src/**` and `convex/**`, excluding colocated tests.
- Authored application CSS/configuration in the broad count.
- Tests in `tests/**`, including the 4,167 physical lines of shared fixture/support TypeScript.
- Colocated `*.test.ts`, `*.test.tsx`, and `*.a11y.test.tsx` files.
- Vendored shadcn/Radix source in `src/components/ui/**`. It is authored and maintained here, not a package artifact; the README explicitly calls it adapted vendored source (`README.md:462-469`).

### Excluded and reported separately

- `convex/_generated/**` and `next-env.d.ts`, currently ignored at `.gitignore:35-53`. The local Convex output is only 436 physical lines; counting or deleting it cannot materially affect the target.
- `.next*`, `node_modules`, Playwright reports, caches, and coverage output.
- Generated operator-manual HTML: 43 tracked files / 9,056 physical lines under `docs/manual-html/**`. The authoring guide says it is generated from one catalogue and overwritten (`docs/manuals/operator-manual-authoring.md:3-7`, commands at `:13-25`); the generator names the output directory and marker at `scripts/manual/html.mjs:26-43`.
- `scripts/**`: 4,935 SLOC. It is a separate tooling-reduction opportunity, not a way to satisfy “main app and tests.” The package exposes custom environment, tenant, select, schema, manual, E2E, and restore gates at `package.json:30-43`.
- Message catalogues: `messages/en.json` and `messages/th.json` are content, not application SLOC.

### Feature slices

These current-snapshot inventories are non-overlapping with generated artifacts and explain why a 50% target is partly a product-scope decision:

| Slice                  | Production SLOC | Test SLOC | Evidence/interpretation                                                                                                                                                                                                            |
| ---------------------- | --------------: | --------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 5A order-to-ship |       **8,445** | **3,193** | Added as a substantial workflow slice; commit `600ea61` alone added 11,982 net production physical lines and 3,704 net test physical lines.                                                                                        |
| Storage-layout planner |       **5,723** |   **974** | The implementation includes the 3,238-line `StorageLayoutScreens.tsx` plus storage schema, functions, geometry, and tests. The recent history from `284edf4` through planner follow-ups added 5,766 net production physical lines. |
| Inbound slice          |       **8,339** | **5,311** | This is the repository's stated first-release path, `PO → Receive → QC → … → Inventory ledger` (`README.md:1-9`); removing it contradicts the declared product goal.                                                               |

Dropping all three would remove 22,507 production SLOC and 9,478 test SLOC, yet would still not reach 50% production by itself and would remove the application's primary workflow.

## Hard evidence

### 1. Clone removal is a small lever

`jscpd` over `src`, `convex`, and `tests`, excluding generated Convex output, found **1,435 duplicated physical lines (1.13%)** at a 12-line/80-token threshold. A more permissive production-only run found **2,358 duplicated lines (3.23%)** at 8 lines/50 tokens. Representative clones are small repeated list mappings and handler shells, such as:

- `convex/masterData/catalogue.ts:521-553` versus `:941-953` and `:1186-1196`;
- `convex/lib/authorizationLookupsConvex.ts:95-122` versus `convex/lib/tenantContextLookups.ts:104-127`;
- `convex/engineering/files.ts:546-575` versus `convex/production/packets.ts:716-733`;
- test setup around `tests/integration/master-data-catalogue.integration.test.ts:28-73`, `tests/integration/master-data-writes.integration.test.ts:21-65`, and the corresponding isolation suites.

Therefore “extract duplicated blocks” has an empirical ceiling far below 50%. Most repetition is structural rather than text-identical.

### 2. Client function references and wire types are a hand-maintained parallel type system

Seven files under `src/lib/convex/*Api.ts` contain **1,767 production SLOC**. They manually restate function paths, arguments, return shapes, status unions, row shapes, and page envelopes. The rationale is explicit in `src/lib/convex/ledgerApi.ts:1-19`: generated files are ignored, so the client makes typed `makeFunctionReference` claims. Direct drift tests add 253 SLOC in `tests/integration/ledger-client-contract.integration.test.ts` and `tests/integration/inbound-client-contract.integration.test.ts`; broader contract guards take the test cost above 300 SLOC. The first test describes why it re-reads server modules at `tests/integration/ledger-client-contract.integration.test.ts:31-43`.

This repository policy conflicts with current first-party guidance. Convex says `npx convex codegen` generates `convex/_generated/`, that the output **should be committed**, and that CI may regenerate it to verify correctness ([Convex codegen reference](https://docs.convex.dev/cli/reference/codegen)). Convex also recommends reusing validators and deriving types with `Infer`, and says the generated client provides end-to-end argument/return type safety ([Convex TypeScript practices](https://docs.convex.dev/understanding/best-practices/typescript#inferring-types-from-validators)).

Recommendation: commit the generated type surface or establish a credential-free `codegen --dry-run`/verification workflow, import generated function references, and keep only genuinely presentation-specific view types. Prototype this first: the repo's no-vendor-configuration build requirement is real (`README.md:557-563`), and codegen must remain reproducible on a clean checkout.

Expected non-overlapping saving: **1.4k–1.7k production SLOC** and **0.25k–0.35k test SLOC**, after retaining a small amount of presentation-specific typing.

### 3. Schema, validators, server document interfaces, and client row types repeat one fact in several forms

One entity currently appears as:

1. schema fields and indexes (`convex/schema.ts:670-683` for `items`);
2. a return validator (`convex/masterData/catalogue.ts:188-195`);
3. a hand-written server document interface (`convex/masterData/catalogue.ts:197-205`);
4. a hand-written projector (`convex/masterData/catalogue.ts:233-245`);
5. a hand-written client row interface (`src/lib/convex/masterDataApi.ts:38-69`).

The pattern repeats for warehouses, locations, lots, handling units, owners, reason codes, suppliers, storage classes, barcodes, UOMs, and label templates. Convex's documented `Infer<typeof validator>` mechanism supports making validators the source of TypeScript types rather than restating interfaces.

Recommendation: create domain contract modules containing reusable field/return validators and inferred types. Keep database-document types generated from the schema; keep explicit projectors only where the wire shape intentionally differs. Do not introduce a generator merely to move authored code into templates unless generated output is also measured.

Expected non-overlapping saving after the client-reference change: **1.5k–3k production SLOC**. Risk is medium-high because IDs are intentionally renamed and some wire shapes omit sensitive/internal fields.

### 4. Shared list/write modules exist, but the oldest/largest call sites still carry private copies

The newer customer module uses `listEnvelope` and `writeEnvelope` (`convex/sales/customers.ts:36-51`). In contrast:

- `convex/masterData/catalogue.ts:89-182` defines private list args, error/page validators, refusal conversion, page request conversion, indexed paging, and status terms;
- `convex/masterData/writes.ts:87-147` defines private write envelope helpers;
- purchasing and receiving only partially adopt the shared modules (`convex/purchasing/orders.ts:35-45`, `convex/receiving/receipts.ts:42-50`).

The catalogue then repeats validator → document interface → query registration → pagination → projection for each entity; compare `listItems` at `convex/masterData/catalogue.ts:188-247`, `listLocations` at `:357-410`, and `listSuppliers` at `:802-850`. Writes likewise repeat normalization, fingerprinting, uniqueness metadata, store call, and envelope conversion; compare `createLocation` and `updateLocation` at `convex/masterData/writes.ts:415-503` with `createCustomer` and `updateCustomer` at `convex/sales/customers.ts:95-172`.

Recommendation: first migrate all call sites to the existing shared envelopes. Then introduce narrow `defineTenantList` and `defineAuditedWrite` modules only for the repeated invariant-bearing shell. The interface must remain small: table, index/equality builder, permission, validators, projector/normalizer. Domain state transitions stay explicit handlers.

Expected saving: **2.5k–4k production SLOC** and **2k–4k test SLOC** through one contract suite for each deep module. Risk is high if the factory grows enough options to mirror every handler; in that case it is a shallow module and should be rejected.

### 5. The tenant runtime is a good seam, but tests layer across its internals

The architecture requires one tenant accessor and thin public functions (`docs/adr/0002-convex-tenant-boundary-and-index-discipline.md:37-48`). The current implementation exposes several interfaces along the same path:

- `TenantStoragePort` at `convex/lib/tenantDb.ts:562-642`;
- `TenantIndexReader` at `:670-717`;
- `TenantDocumentAccess` at `:719-816`;
- Convex query/mutation adapters in `convex/lib/tenantStorage.ts`;
- `queryWithOrg`, `mutationWithOrg`, and `actionWithOrg` at `convex/lib/tenantFunctions.ts:904-1049`.

Those internal seams are tested independently and then again together. Large examples include:

- `tests/integration/tenant-db-primitives.integration.test.ts` (424 physical lines);
- `tests/integration/tenant-document-access.integration.test.ts` (467);
- `tests/integration/tenant-index-reads.integration.test.ts` (581);
- `tests/integration/tenant-storage.integration.test.ts` (981);
- their isolation counterparts (1,246 lines combined for document access, index reads, and storage);
- `tests/integration/tenant-functions.integration.test.ts` and authorization/context suites above them.

Some tests pin implementation shape rather than observable behavior, for example exact method keys, hidden property names, and frozen wrapper objects at `tests/integration/tenant-document-access.integration.test.ts:89-130`, and the exact four reader methods at `tests/integration/tenant-index-reads.integration.test.ts:119-169`.

Recommendation: make the external tenant-runtime interface the test surface. Keep storage adapters as internal seams and run a single contract suite against the in-memory and Convex adapters. Preserve explicit two-tenant negative cases and the independent isolation tier; the ADR requires isolation to remain blocking and tiers to stay separable (`docs/adr/0012-delivery-release-and-quality-gates.md:63-73`, `:102-105`). Delete tests below the external seam once equivalent mutation/negative-control evidence exists.

Expected saving: **1k–2k production SLOC** and **4k–7k test SLOC**. The test saving is the strongest full-behavior opportunity. Security risk is high, so this must be replace-then-delete, never delete-then-rebuild.

### 6. Tests are comprehensive but often over-specified

The repository has six named Vitest projects/tier rules at `vitest.config.mts:32-103`, plus Playwright. Keeping the tiers is an accepted architectural constraint; keeping every current assertion is not.

Reduction candidates:

- **Property-test negative controls test the tests.** Five property files contain deliberately weakened reimplementations and assert that fast-check finds a counterexample. The policy is stated at `tests/properties/inventory-ledger.property.test.ts:1-14` and exemplified at `:397-423`; another large block starts at `tests/properties/quantity-uom.property.test.ts:369`. These are useful while designing generators, but they are not product behavior. Once mutation testing or a reviewed generator contract replaces them, approximately **0.4k–0.7k test SLOC** can go.
- **Runtime immutability is asserted repeatedly.** There are 81 `Object.isFrozen` assertions. Immutability is documented behavior in `convex/model/README.md:46-88`, so it cannot simply be dropped; a reusable immutable-result contract can verify it once per constructor family instead of at many individual call sites.
- **Feature suites restate setup and entity matrices.** Integration and isolation together contain 25,603 physical lines; fixtures contain another 4,167. Table-driven scenario definitions can exercise the same operation matrix across tenant A, tenant B, missing IDs, wrong warehouse, replay, and denial without restating setup. Exact-clone detection already finds repeated setup across the master-data and inbound suites.
- **Client path tests exist because client references are handwritten.** Generated references delete the reason for those tests, not merely the tests.

A reasonable non-overlapping test budget is in the scenario tables below. Any replacement must retain observable outcomes, denial non-disclosure, two-tenant data, public return validation, and the independent isolation project.

### 7. Vendored UI is large but deliberately customized

`src/components/ui/**` plus `src/hooks/use-mobile.ts` is 2,531 production SLOC (3,343 physical lines including tests/support). The repository chose vendoring to enforce 48px targets, Thai wrapping, scanner-safe shortcuts, localized accessible names, and shell composition (`README.md:462-469`; `docs/ui-component-migration-notes.md:49-76`). Commit `304f0b8` added roughly 2,556 net production and 1,028 net test physical lines.

Knip reports many unused vendored exports, especially sidebar, kanban, select, card, and sheet variants. Removing an unused export name alone saves almost nothing; delete the implementation only after proving no registry/runtime use. Replacing all vendored primitives with a dependency would trade local SLOC for dependency code and could regress the documented warehouse-specific behavior.

Recommendation: prune verified unused primitive implementations and collapse repetitive route/page shells, but do not book the entire vendored layer as removable.

Expected saving: **0.8k–1.5k production SLOC** and **0.5k–1k test SLOC**.

### 8. Dead-code inventory is useful but small and noisy

Knip currently reports **4 unused files, 85 unused exports, and 38 unused exported types**. Two files are verified dead preview-era E2E helpers:

- `tests/e2e/support/accessibility.ts` (28 physical / 18 code lines);
- `tests/e2e/support/select.ts` (148 physical / 82 code lines).

No file imports them, and both still describe removed preview behavior (`seedPreviewWarehouse` at `tests/e2e/support/accessibility.ts:4-13`). Delete these 100 test SLOC immediately.

The other two “unused files” are generated manual assets referenced by generated HTML, so they are false positives for deletion. Many unused exports are public Convex registrations or vendored registry variants and likewise require manual verification. The whole verified/likely production dead-code budget is only **0.2k–0.6k SLOC**, not a path to 50%.

### 9. History says architectural deletion works; local cleanup does not

- Commit `a6ceb2e` removed the synthetic preview mode and its parallel E2E world: 19 preview files, 3,930 deletions. Across all TS/JS, production netted **-855** and tests **-1,690** even after replacement authenticated-workflow tests were added. This is the strongest precedent: remove an alternate execution/data path, retain one real path.
- Commit `8d848d0` (“consolidate building floor controls”) netted only **-17 production** and **+27 test** physical lines. Component-level consolidation did not reduce the codebase materially.
- Since `b7ff5d4`, the repository added 23,655 net production and 8,807 net test physical lines. The 50% target would effectively erase all of that growth and more unless the same behavior is compressed through code generation/deep modules.

## Scenario A: preserve all behavior

The following deletion budget avoids overlap by assigning each line family to one initiative. Ranges are estimates unless marked exact; they require a prototype and before/after `cloc` measurement.

### Production budget

| Priority  | Initiative                                                               | Production SLOC removed | Confidence                          | Notes                                                                  |
| --------- | ------------------------------------------------------------------------ | ----------------------: | ----------------------------------- | ---------------------------------------------------------------------- |
| P0        | Generated Convex references; delete hand-maintained client mirror        |             1,400–1,700 | High after clean-checkout prototype | Current mirror is exactly 1,767 SLOC; retain only view-specific types. |
| P0        | Adopt shared list/write envelopes and deepen CRUD/list registration      |             2,500–4,000 | Medium                              | Excludes validator/type consolidation below.                           |
| P1        | Canonical validators + `Infer`; remove repeated document/wire interfaces |             1,500–3,000 | Medium                              | Excludes the seven client API files already counted.                   |
| P1        | Deepen tenant runtime; make adapters internal                            |             1,000–2,000 | Low-medium                          | Security-sensitive; implementation may shrink less than tests.         |
| P1        | Prune verified dead code and unused vendored implementations             |                 200–600 | Medium                              | Knip is a lead list, not proof.                                        |
| P2        | Collapse route/page shells and repeated UI/form scaffolding              |             1,500–3,000 | Low-medium                          | Preserve route boundaries and message scoping.                         |
| P2        | Consolidate storage-planner geometry/forms without feature loss          |               800–1,500 | Low                                 | The 3,238-line screen is complex, but exact clones are scarce.         |
| **Total** |                                                                          |        **8,900–15,800** |                                     | **17%–30% of 52,551**                                                  |

Even the optimistic total leaves **10,476 production SLOC** still to remove. Comment cleanup (up to 16,336 lines) can improve readability and physical LOC, but cannot close a SLOC gap.

### Test budget

| Priority  | Initiative                                                             | Test SLOC removed | Confidence         | Notes                                                           |
| --------- | ---------------------------------------------------------------------- | ----------------: | ------------------ | --------------------------------------------------------------- |
| P0        | Delete generated-reference drift tests                                 |           250–350 | High after codegen | Direct contract files contain 253 SLOC; wider guards add some.  |
| P0        | Delete two dead preview E2E support files                              |     **100 exact** | High               | Verified unreferenced.                                          |
| P0        | Replace tenant internal-layer suites with one adapter/runtime contract |       4,000–7,000 | Medium-low         | Preserve the independent isolation project and negative cases.  |
| P1        | Table-drive master-data/inbound/order-to-ship operation matrices       |       4,000–7,000 | Low-medium         | Keep scenarios, remove repeated setup/assertion shells.         |
| P1        | Consolidate unit/property overlap at deep module interfaces            |       2,000–4,000 | Low-medium         | Requires mutation testing or equivalent adequacy evidence.      |
| P1        | Shared UI render/accessibility/interaction harnesses                   |       1,000–2,000 | Medium             | Accessibility tier remains separate.                            |
| P2        | Remove property-test negative-control reimplementations                |           400–700 | Medium             | Only after generator adequacy is proved elsewhere.              |
| P2        | Fixture/scenario-builder normalization not counted above               |       2,000–4,000 | Low-medium         | Must avoid double-counting setup removed by operation matrices. |
| **Total** |                                                                        | **13,750–25,150** |                    | **31%–57% of 43,745**                                           |

The range straddles 50%; therefore the correct statement is **“test 50% is a stretch goal to validate,” not “test 50% is feasible.”**

## Scenario B: reach 50% with explicit de-scoping

This budget separates product deletion from refactoring and does not pretend behavior is preserved.

### Production

| Non-overlapping action                                          |    Production SLOC removed |
| --------------------------------------------------------------- | -------------------------: |
| Remove Phase 5A order-to-ship                                   |            **8,445 exact** |
| Revert/remove the storage-layout planner slice                  |            **5,723 exact** |
| Preserve-behavior architectural consolidation on remaining code | **8,900–15,800 estimated** |
| **Total**                                                       |          **23,068–29,968** |

The 50% requirement is 26,276 SLOC. It is reached only in the upper half of the consolidation range. If the prototypes deliver the lower half, another feature must be simplified or removed. Removing inbound would easily close the arithmetic gap, but inbound is the declared first release and should not be treated as expendable.

### Tests

| Non-overlapping action                                 |           Test SLOC removed |
| ------------------------------------------------------ | --------------------------: |
| Delete Phase 5A tests                                  |             **3,193 exact** |
| Delete/rewrite storage-planner tests                   |               **974 exact** |
| Preserve-behavior test consolidation on remaining code | **13,750–25,150 estimated** |
| **Total**                                              |           **17,917–29,317** |

The 50% requirement is 21,873 SLOC. Again, the target is possible only after the replacement contract/scenario harness proves the upper half of the range.

## Recommended sequence and acceptance gates

1. **Freeze the metric.** Add a read-only LOC script that prints broad authored production SLOC, test SLOC, tooling SLOC, generated lines, vendored UI SLOC, and comment lines separately. Fail only on agreed budgets, never on total repository lines.
2. **Restore a green baseline.** Resolve or explicitly accept the two storage-layout guard failures before deleting tests.
3. **Take verified deletions first.** Remove the two dead E2E helpers and manually verify Knip candidates. Expected effect is small but certain.
4. **Prototype Convex codegen on a clean checkout.** Acceptance: no vendor credentials, `pnpm typecheck` and `pnpm build` work, generated output is reproducible, and client hooks retain inferred argument/return types. Only then delete manual client references and drift tests.
5. **Adopt existing envelopes before inventing a new factory.** Move `masterData`, purchasing, and receiving onto `listEnvelope`/`writeEnvelope`; measure. Introduce a registration module only if its interface stays smaller than the repeated handlers.
6. **Deepen the tenant runtime test seam.** Add one contract suite that runs against both the in-memory adapter and Convex adapter. Demonstrate that it catches foreign-row leakage, unbounded reads, ownership bypass, malformed cursors, write smuggling, and denial disclosure. Delete lower-layer suites only after this proof.
7. **Table-drive feature scenarios.** Convert one representative slice first. Compare mutation score or seeded-fault detection, branch coverage, runtime, and SLOC. Proceed only if behavior evidence is no weaker.
8. **Make the product decision.** If production SLOC remains above 26,275 after the measured preserve-behavior work, choose explicitly among: keep a lower reduction target, remove Phase 5A, simplify/revert the storage planner, or accept generated/external code as a transfer rather than a true complexity reduction.

Every reduction commit should pass the repository's accepted gates: formatting, lint, strict typecheck, unit/property/integration/isolation, accessibility, E2E smoke, and static tenant/ledger checks (`docs/adr/0012-delivery-release-and-quality-gates.md:63-73`). Track behavior with test outcomes and seeded-fault detection, not only coverage percentage.

## Bottom line

- **Dedupe alone:** disproven as a route to 50% (1.13% whole-repo exact duplication; 3.23% with a permissive production threshold).
- **All behavior preserved:** credible production target **17%–30%**; test target **31%–57%**, with the high end unproven.
- **50% both:** requires product de-scoping plus architectural consolidation. The least disruptive arithmetic is removal of Phase 5A and rollback/simplification of the storage planner, while retaining the inbound first-release path.
- **Do not count:** generated manuals, build artifacts, ignored Convex output, or comment deletion as authored code savings.
