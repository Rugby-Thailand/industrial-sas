# AI usage Design 1 and main-target review

Date: 2026-10-11 (Asia/Bangkok).

The report now uses the user-selected Design 1: a compact period/filter/CSV toolbar, a confirmed-USD and estimated-THB statement, and separate cards for job-ticket photos, location-label photos, and AI Search. This month remains the default. The app shell, themes, language support, and surrounding workflows retain their incumbent appearance.

## Scope and fixed points

The requested target is `main`. HR attendance and AI Search are required dependencies absent from the reviewed main commit, so this PR includes their checkpoint `075b10e865ae649d7e8d2be99db0dafa6e1899c8`. The full baseline review compared `c64a882239696122e593e493aea771a1792841e5...2fcb86c5247f5ba7c1024ebc71fa314ccdb7509c`; the UI review compared `2fcb86c...bd4c8a011b0fdd676c042db8461501308c4a9ac5`.

The three-layout prototype remains in the separate preview worktree/branch. No prototype switcher, synthetic comparison records, or fixed FX assumption is included in production.

## Independent code review

Standards and Spec were reviewed independently against the same pinned baseline. The Design 1 delta introduced zero additional findings on either axis.

The repair batch addresses:

- Cross-site employee metadata in HR member selectors: employee IDs/codes are returned only within permitted site scope. A generic linked flag keeps unavailable accounts disabled without disclosing protected employee metadata; server uniqueness enforcement remains authoritative.
- Employment bounds at checkout: an open shift is checked against its own business date. Editing employment to exclude that date prevents a new event, while a valid final-day overnight checkout remains allowed.
- Search transport purity: network calls, timeout handling, and durable usage accounting move to the adapter layer. The model retains deterministic request construction and response validation. One request, the deadline after accounting acknowledgement, and final accounting are preserved.
- Schedule immutability: the validated, copied workday array is frozen and readonly.

The final repair is `213a45dca82fed84d5ea05926a3c796f0c6c1ffd`, rebased onto unchanged main `c64a882239696122e593e493aea771a1792841e5`. Both reviewers inspected the immutable repair delta from `9df064064f303e60992e9ea9103fca02612ab31c`, including its regression cases, without duplicating tests or accessing deployed data.

- **Standards:** S1 scope disclosure, S2 impure transport, and S4 mutable validated array are resolved. Zero open hard, blocking, or actionable smell findings; one nonblocking P3 advisory remains (S3 below). The relocated transport function and pure request/decoder code are byte-for-byte preserved.
- **Spec:** the original P1 HR-001 and P2 HR-021 findings are resolved. Zero open Spec findings and zero new actionable repair defects. Refused commands do not write attendance events or checkout idempotency receipts; a restored employment range allows the same request to write once and replay. Valid final-day overnight checkout remains permitted.

The Standards advisory about trusted low-level HR calendar helpers remains nonblocking technical debt. Inspected production callers validate dates/minutes and obtain timezone offsets from the supported whitelist; no externally reachable invalid operand was identified. A broad Result-signature rewrite would exceed the demonstrated defect. It is not reported as a customer incident or an unresolved permission defect.

## Real UI evidence

Screenshots and their source-build manifest are in [.impeccable/review/design-one](../../.impeccable/review/design-one/manifest.json). They show the real running `/th/ai-usage` report with designated local test fixtures and existing tracked provider operations. The FX source is visibly a local QA estimate. No new provider call was made for this UI verification.

Desktop 1280×800, mobile 390×844, tablet 768×1024, and the user preview at 643×898 were inspected, including lower report content. Thai light and English dark states, mobile filters, and the filtered AI Search report are captured. There was no horizontal overflow or new browser error. The one detector pass returned no findings.

Mobile filters update both totals and CSV scope; clearing filters restores the full report. Escape closes the filter Sheet and restores focus. The month range updated correctly to October 11 after midnight in Bangkok. The real fixture total remained USD 0.0007701, with estimated THB 0.0272 at the administrator-saved QA rate 33.53 and fee 5.5%.

The [finish review](../../.impeccable/review/design-one/finish-review.md) records **ship** with all ten captures valid and no material visual fixes. The [documentation review](../../.impeccable/review/design-one/documentation-review.md) preserves the incumbent system. Preexisting shared StatusBadge glyph fallback drift is documented but not canonized or repaired as part of this report extension.

## Validation

Executed from a separate clean checkout at `213a45d`, with its own frozen-lockfile dependency installation and no copied credentials:

| Check                                     | Result                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm check`                              | Passed: formatting, typecheck, zero-warning lint, **242 files / 2,919 tests**     |
| `pnpm build`                              | Passed, credential-free production build                                          |
| `pnpm ci:codegen`                         | Passed against a throwaway loopback backend; generated files match pinned tooling |
| `pnpm ci:test-discovery`                  | Passed: 242 Vitest files, 11 Playwright specs                                     |
| `pnpm ci:clean-tree`                      | Passed after generators and build                                                 |
| `pnpm audit:prod`                         | Passed; no known runtime vulnerabilities                                          |
| Application and release dependency audits | Passed with the existing exact-chain, expiring exceptions                         |
| Workflow/action pin validation            | Passed; actionlint reported no problems                                           |

Dependency and workflow checks were run on the same unchanged manifests/scripts before the repair settled; the diff verifies those inputs are identical at the final code revision. GitHub quality, browser suites and CodeQL are verified separately against the published PR head before readiness is reported.

This pass did not rerun the historical live Search evaluation or production deployment checks. The existing HR pilot limits and launch decisions remain documented in [the HR delivery review](hr-phase-1-implementation.md).

No production merge or deployment is part of this verification. The main-target PR is left open for merge after its required checks pass.
