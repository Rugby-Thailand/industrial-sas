# Minimal UI — implementation and audit

All seven phases in the [implementation plan](../plans/minimal-ui-2026-10-08.md) are implemented. The [real UI walkthrough](minimal-ui-walkthrough-2026-10-08.md) contains 78 action/state pairs, with 156 desktop/mobile screenshots. The [interactive gallery](minimal-ui-gallery-2026-10-08.html) supports searching and viewing either size.

## Result

The planner uses a white canvas, stronger text/status/control contrast, smaller desktop controls and flatter content. Desktop navigation starts as a 64 px rail; mobile navigation starts closed. Products use desktop tables and mobile lists that retain identifiers, quantities, units, formats and next actions. Product references, QR/dimension details and setup remediation use disclosure rather than dominating the task.

Packing, location activation, reservation, verification, physical placement, moving and stacking retain separate steps. Copied dimensions require their own check. Ticket location assignment remains distinct from inventory storage. Sign-in validates and preserves the requested planner return path and query. Setup headings now reflect whether both required integrations are configured.

Latest main was integrated through `0e9ea3a`, retaining PR #43's record deletion/selection behavior and PR #44's proportional map canvas/camera controls. Original uncommitted work remains in the original checkout; this work uses `codex/minimal-ui-redesign` in a separate checkout.

## Test/fix loops

| Finding                                                                               | Correction and verification                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repeated ticket identities could be saved without review                              | Require an explicit duplicate review; invalidate it when identities change. Real duplicate-blocked/reviewed/saved screenshots plus automated coverage.                         |
| Quantity `1,2` could be interpreted incorrectly                                       | Shared strict quantity parser rejects malformed grouping, negative and nonfinite values. Real correction flow plus parser/serialization tests.                                 |
| Failed photo extraction and late camera callbacks could lose or change submitted data | Preserve editable tickets on failure, use synchronous acquisition guards, freeze submissions and reuse request identity on retry. Deferred callbacks and failed-request tests. |
| Mobile storage rows omitted product identity/format details                           | Restore product SKU/name, counting unit, format and dimensions, with fallback metadata tests.                                                                                  |
| Draft preview nested interactive elements inside an image role                        | Use a group role with keyboard-operable location controls; accessibility and keyboard tests.                                                                                   |
| Mobile scan location and packing footer overflowed                                    | Wrap location identity and align the sticky footer with mobile gutters. Refreshed real screens report zero document/main horizontal overflow.                                  |
| Clerk controls were below the intended mobile target size                             | Apply 44 px field/social/continue controls and verify their actual browser rectangles. Real sign-in, invalid email and completed return-route screenshots.                     |
| Setup used an incomplete heading when configured                                      | Match headings to configuration; test all four integration combinations and capture the configured state.                                                                      |
| Merged record checkbox touch area overlapped the thumbnail by 4 px                    | Retain 12 px horizontal spacing. Real mobile rectangles meet at x=48 with zero overlap.                                                                                        |
| Selected map details skipped a heading level in table view                            | Add the missing level-two location-details heading. Chrome confirms H1 → H2 → H3 at both sizes; map tests pass.                                                                |

## Real browser coverage

T3 preview captured product search/filter, required fields, packing split/measurement copy/draft/review/create, building/zone creation and activation, desktop inspector/mobile sheet, reserve/wrong-code/verification/store, move pickup/transit/place, stack support limits/identity/place, manual ticket validation/duplicate review/save, record filtering/selection/assignment, navigation, draft discard/continue, setup, public pages and real Clerk sign-in return.

After integrating main, real checks also covered record actions, single-delete cancellation, bulk-delete confirmation/completion, map 3D, zoom, fit and table selection. Only the walkthrough's two QA scan tickets were deleted. Assigning those tickets to QA storage A did not move their stored pallets from QA storage B.

Chrome completed the remaining screenshots after the user explicitly selected it. The final catalogue, table-details, Thai and dark-mode examples have zero document/main horizontal overflow at 1440 × 1000 and 390 × 844 CSS viewports.

Axe was run against the real document during the T3 walkthrough and used to find/fix visual accessibility issues. The open Radix modal menu was audited in its active-menu scope: whole-page heading/region checks and its hidden background are not meaningful within that scope. Escape was separately verified to close the menu and return focus to its record-actions trigger. The final table heading fix was verified through Chrome's actual DOM hierarchy. These checks are evidence for the exercised states, not an accessibility certification.

## Validation

- Final full suite: **1,140 tests passed, zero failures**.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed with zero warnings.
- `NEXT_DIST_DIR=.next-build pnpm build`: passed; walkthrough used the real production build for the final affected states.
- Changed-source formatting and `git diff --check`: passed.
- `pnpm audit --prod --audit-level high`: no known vulnerabilities found.
- Gallery assets and paired links are checked before committing.

## Standards

The parallel Standards review found no hard documented-standard violations. It identified the mobile record touch-area overlap, which was corrected and verified in the actual browser. No remaining actionable new smell was reported. Upstream record business logic and camera/layout behavior remain intact.

## Spec

The parallel Spec review found no remaining actionable implementation issues after integration. It confirmed the compact layout retains deletion confirmation, page-scoped selection, permission/pending guards, stable retry identities, cancelled QR lookup protection, scan acquisition guards and the authoritative map behavior. Real screenshot evidence covers the requested desktop/mobile workflows.

Standards: one UI concern corrected, zero outstanding hard violations. Spec: zero outstanding implementation findings.

## Practical limits

Mobile screenshots use responsive browser viewports; an actual phone camera and software keyboard were not exercised. Photo/AI failure recovery and camera callback races have automated coverage, rather than a physical-camera or live-AI walkthrough. Physical warehouse actions were simulated on local QA records through the product's explicit confirmations. Existing development-key and report-only CSP messages were present in local browser logs; no production deployment was performed.

The original three preparation batches and five stored QA units remain in the local demo environment. The [completion follow-up](minimal-ui-completion-2026-10-09.md) added two batches with three awaiting-placement units, bringing the QA product to five batches and eight units. The QA product/building/locations remain available for inspection. The two QA scan tickets were removed by the tested deletion flow. Temporary login helpers and the standalone axe script were removed before delivery.

The evidence review found a missing successful ordinary floor-verification pair. Chrome follow-up states 83–86 close it with fresh QA pallet P-000005. Both screenshots of state 85 visibly include Destination verified and the separate Confirm stored action; state 86 captures the saved result. The follow-up also exercised the remaining units from the second batch, all within the local QA locations.
