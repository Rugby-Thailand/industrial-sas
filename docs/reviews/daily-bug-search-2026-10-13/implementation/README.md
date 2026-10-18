# Daily bug fixes — 13 October 2026

แก้ครบ **21 รายการที่ยืนยันจากงานวิจัย** และ **2 บั๊กที่พบเพิ่มระหว่างตรวจสอบ** รวม 23 รายการ: P1 3, P2 11, P3 9 งานแบ่งระหว่าง Kiro (Claude Opus 5.5) และ Codex subagents (GPT-6.1-Sol) พร้อมตรวจอิสระก่อนรวมงาน

Reviewed code: `b0a24dc9a93b62e8afda782b09d4c4a8642f32da`.
Baseline: `218493e280bdf25d2aa4cf955048b2c336cfae62`, a local snapshot preserving the original uncommitted workspace.
Integration branch: `codex/daily-bugfix-integration-20261013`.

## Coverage

| Priority | ID       | Fixed behavior                                                                                                         | Evidence report                                     |
| -------- | -------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| P1       | DAILY-01 | HR remount/cold recovery retains the original command; old-day receipts cannot confirm today's clock.                  | [HR client](hr-client.md), [backend](hr-backend.md) |
| P1       | INV-04   | Stale legacy pallet measurements cannot overwrite newer dimensions.                                                    | [Inventory](inventory.md)                           |
| P1       | INV-02   | Replaying an old zone save cannot rewrite its child geometry.                                                          | [Kiro storage](kiro-storage.md)                     |
| P2       | INV-03   | Product edits carry their loaded revision and retain conflicted drafts.                                                | [Inventory](inventory.md)                           |
| P2       | KIRO-03  | Current/former employees cannot self-review by unlinking or relinking, including retained legacy history.              | [HR backend](hr-backend.md)                         |
| P2       | KIRO-05  | Employment overlap precedes period/queue employee limits; incomplete reads remain explicit.                            | [HR backend](hr-backend.md)                         |
| P2       | INV-05   | Discrete quantities reject fractional values consistently.                                                             | [Inventory](inventory.md)                           |
| P2       | INV-09   | All ticket acquisition and submission paths enforce the same 50-ticket limit.                                          | [Inventory](inventory.md)                           |
| P2       | INV-01   | Authorized exact layout retries resolve before mutable preconditions; same-root position/archive variants are covered. | [Kiro storage](kiro-storage.md)                     |
| P2       | KIRO-10  | Reactive employee versions do not remount and discard dirty drafts.                                                    | [HR client](hr-client.md)                           |
| P2       | ROOT-01  | HR date/deadline reads refresh while keeping live drafts mounted and server time authoritative.                        | [Shared fixes](root.md)                             |
| P2       | DAILY-02 | Back to Today consumes the customization task and preserves its real origin.                                           | [HR client](hr-client.md)                           |
| P3       | KIRO-07  | Untouched correction sides retain original seconds and milliseconds.                                                   | [HR backend](hr-backend.md)                         |
| P3       | KIRO-11  | All bounded open-day preview rows remain available for resolution.                                                     | [HR client](hr-client.md)                           |
| P3       | INV-06   | Omitted floor offsets clear stored overrides and match validated inheritance.                                          | [Kiro storage](kiro-storage.md)                     |
| P3       | INV-07   | Search uses native cursor boundaries and truthful continuation through empty pages.                                    | [Inventory](inventory.md)                           |
| P3       | DAILY-03 | Clean shortcut editors adopt live preferences; dirty drafts retain their baseline.                                     | [HR client](hr-client.md)                           |
| P3       | ROOT-03  | Late async completion cannot act on a replacement warehouse/workflow owner.                                            | [Shared fixes](root.md)                             |
| P3       | ROOT-02  | Malformed personal request links return the scoped NOT_FOUND result.                                                   | [HR backend](hr-backend.md)                         |
| P3       | INV-08   | Job search includes displayed location names.                                                                          | [Inventory](inventory.md)                           |
| P3       | INV-10   | Unsubmitted photo Blob URLs are released; submitted preview ownership survives correctly.                              | [Inventory](inventory.md)                           |
| P2       | ROOT-04  | Mobile inspector history is consumed before its editor opens. Added during verification.                               | [Inventory follow-up](inventory.md)                 |
| P2       | ROOT-05  | Delayed picker focus cannot steal focus from a user's search field. Added during verification.                         | [Shared fixes](root.md)                             |

The [original ranking](../expanded/final-ranking.md) remains unchanged as research evidence. The five excluded policy candidates were not implemented.

## Independent review gate

- **Standards: PASS.** [Report](review-standards.md). No hard violation remains; one non-blocking possible duplication advisory concerns layout replay adapters.
- **Spec/correctness: PASS.** [Report](review-spec.md). No concrete missing requirement, correctness/security blocker, or unintended scope remains.

Both reviewers inspected the exact code SHA above. The standards reviewer independently reproduced a shortcut pending-remount defect in the first candidate; the follow-up now consumes the confirmed receipt once, keeps later edits, and saves with the correct next revision. Its original failing probe passes after the fix. Documentation-only commits follow the reviewed code without changing its source.

## Final verification

| Check                                                                | Result                                                                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Full Vitest, `pnpm exec vitest run --maxWorkers=4`                   | **282 files / 3,315 tests passed**, no skipped tests reported                                   |
| `pnpm typecheck` (Next route generation and TypeScript)              | Passed                                                                                          |
| `pnpm lint`                                                          | Passed, zero warnings                                                                           |
| `pnpm check:navigation`                                              | Passed: 64 fixtures, 43 route/error policies, 186 owners, 26 intents                            |
| `pnpm exec next build --webpack`                                     | Production build passed on the final code                                                       |
| `pnpm ci:codegen`                                                    | Pinned credential-free local Convex code generation matched; backend unchanged since this check |
| `pnpm ci:test-discovery`                                             | 282 Vitest files and 11 Playwright spec files discovered                                        |
| Prettier on all 87 changed paths before these final review documents | Passed                                                                                          |
| Diff whitespace checks                                               | Passed                                                                                          |

The normal full-repository `format:check` reports **55 pre-existing files**, exactly the same paths on the unmodified snapshot and candidate. The changes introduce no new formatting failures; unrelated design/research artifacts and existing `tsconfig.json` were preserved. Consequently, this report does not claim that the aggregate `pnpm check` command is green.

The default Turbopack build refuses this isolated worktree's external `node_modules` symlink. The final production build was verified with Next's supported webpack mode without changing application configuration. Verification covers local registered backend handlers, schema/auth/tenant boundaries, components, native-history simulation, accessibility suites and production compilation. It does not claim a deployed-browser session, physical-camera testing, or production-network/OCC timing.

## Workspace preservation and delivery

The original `main` workspace contains extensive pre-existing uncommitted work. The baseline snapshot and implementation branches isolate that work from the reviewed patch. The approved patch is merged locally into the integration branch above and applied back to the original workspace without staging or committing that existing work. Concurrent edits outside the patch are retained. No remote push, PR, deployment, or production data write is part of this delivery.
