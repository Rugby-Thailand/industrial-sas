# Order-to-Ship Implementation Review Process

Status: **Required for every Phase 5A–5F increment**
Prepared: 2026-08-15
Primary specification: [Figma order-to-ship operating plan](./figma-order-to-ship-operating-plan.md)

## 1. Purpose

This process prevents a phase from being called complete because it compiles or because its happy path renders. Every increment is reviewed independently across:

1. Specification and business behavior.
2. Domain and database design.
3. Tenant isolation, authorization, security, and privacy.
4. UX, visual design, responsive layout, and accessibility.
5. Feature correctness, failure behavior, concurrency, and recovery.
6. Performance, boundedness, and operational readiness.
7. Test quality and release evidence.

An implementation phase cannot start its successor until its critical findings are fixed and its release evidence is recorded.

## 2. Review fixed point and scope

Before implementation:

- Record the Git commit, branch, and complete dirty-worktree status.
- Preserve user-owned changes and identify which paths the implementation agent is authorized to edit.
- Record a green or failing baseline for lint, typecheck, tests, tenant-boundary verification, build, and relevant E2E journeys.
- Name the exact specification sections and release gate being implemented.
- List deliberate non-goals so adjacent roadmap work is not mistaken for a requirement.

After implementation, review only the delta from that fixed point. Pre-existing failures must be reported separately from regressions.

## 3. Mandatory automated gate

Run the narrowest checks during development and the complete gate before phase acceptance:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:property
pnpm test:convex-runtime
pnpm test:integration
pnpm test:isolation
pnpm test:a11y
pnpm verify:tenant-boundary
pnpm verify:native-select
pnpm build
pnpm test:e2e
```

Also run `pnpm audit:prod` before a release candidate. Environment-dependent E2E or build failures may be marked blocked only with the command, output, owner, and follow-up date recorded.

No gate may be replaced by an implementation-agent summary. The reviewer runs the commands independently.

## 4. Two-axis code review

Run two reviews independently so one cannot hide the other.

### 4.1 Standards review

Check the diff against repository ADRs, tenant patterns, permission conventions, the domain glossary, sibling modules, and the baseline code smells. Report documented-standard violations separately from judgment-call smells.

Mandatory questions:

- Do pure rules remain under `convex/model/**` with no Convex imports?
- Are public Convex modules thin callers of deep domain modules?
- Are names drawn from the glossary and used consistently?
- Does one interface hide lifecycle, authorization, audit, idempotency, and persistence complexity from UI callers?
- Is duplicated transition or validation logic centralized?
- Are error and result shapes consistent with existing modules?

### 4.2 Specification review

Trace every changed behavior to a requirement and every requirement to code and evidence.

Report:

- Missing or partial requirements.
- Incorrect implementations of stated requirements.
- Unrequested scope or speculative abstractions.
- Release-gate claims without executable evidence.

## 5. Domain and database design review

Review the schema and every access path together; a table without a safe reader/writer is not complete.

### 5.1 Tenant and index discipline

- Every tenant table uses `tenantFields` and every tenant index begins with `orgId`.
- Every external or human identifier has a bounded lookup contract.
- Conditional uniqueness is enforced in the mutation, not assumed from an index.
- Every referenced document is re-read through tenant-bound access and checked for organization and warehouse/site ownership.
- List queries use an index, deterministic ordering, a capped page size, and a stable continuation cursor.
- No tenant `.filter()` or unbounded `.collect()` is introduced.

### 5.2 Aggregate and lifecycle integrity

- The aggregate owning each transition is explicit.
- Status transitions are fail-closed and cannot skip required states.
- Partial quantities are authoritative; a headline status is a projection rather than the only evidence.
- Released revisions, approvals, ledger rows, production history, and shipment evidence are immutable.
- Cancellation and correction use explicit reasoned transitions or compensating records.
- Idempotency keys cover every externally retryable mutation.
- Maker-checker compares durable actor identities and remains enforced inside the write transaction.

### 5.3 Inventory integrity

- Only the inventory-ledger module changes physical stock.
- Factory, QC, reservation, and shipping modules submit validated transaction intents rather than writing balances.
- Reservations remain separate from on-hand inventory.
- Reversal, expiry/status changes, allocation changes, and concurrent requests cannot create negative available stock or double allocation.

### 5.4 Schema evolution

- Changes follow expand–migrate–contract and remain readable during rollout.
- Backfills are bounded, resumable, idempotent, observable, and safe to retry.
- New permissions and default-role changes include a migration plan for existing tenants; reseeding must not overwrite tenant-customized roles.
- Legacy imports have preview, validation, duplicate reporting, and rollback/reconciliation evidence.

## 6. Feature and bug review

For every public command and screen, test:

- Happy path.
- Empty and first-use path.
- Invalid input at every field and domain seam.
- Unauthorized, wrong warehouse/site, and cross-tenant identifiers.
- Duplicate submission and network retry.
- Stale data and two-user concurrent actions.
- Partial success, cancellation, rejection, reversal, and recovery.
- Browser refresh, back/forward navigation, deep link, and expired session.
- Thai and English values, long identifiers, long customer/product names, and zero/large quantities.

Every defect report includes severity, prerequisites, exact steps, expected result, actual result, evidence, affected tenant/role, and regression test location.

## 7. UX and visual review

Review real screens at minimum at 360×800, 768×1024, 1280×800, and 1440×900, in Thai and English.

### 7.1 Information architecture and workflow

- Navigation labels match role vocabulary and make the next task obvious.
- Users can identify the customer PO, SO, FO, SKU, revision, quantity, due date, owner, and blocking exception without opening several pages.
- Primary, secondary, destructive, and approval actions have clear hierarchy.
- Dense operational lists support scanability, filtering, sorting, pagination, and persistent context.
- Status and exception history explain who acted, what changed, when, and why.

### 7.2 Color and state

- Use design tokens; no arbitrary status colors in feature code.
- Text meets WCAG 2.2 AA contrast: 4.5:1 for normal text and 3:1 for large text and meaningful UI graphics.
- Status is never communicated by color alone; pair color with text and, where useful, an icon or shape.
- Destructive, blocked, warning, success, draft, and informational treatments are visually distinct in both light and dark/high-contrast conditions supported by the app.
- Focus indicators remain visible against every surface.

### 7.3 Layout, spacing, and typography

- Use the existing spacing scale and align fields, labels, columns, and action rows to a consistent rhythm.
- Avoid large empty cards, double containers, uneven card padding, clipped Thai text, and tables that force page-level horizontal scrolling.
- Preserve readable line length, heading hierarchy, numeric alignment, and tabular digits for quantities/codes where available.
- On narrow screens, convert dense tables into intentional row cards or controlled horizontal regions rather than shrinking text below the design system minimum.
- Interactive targets are at least 44×44 CSS pixels and keep adequate separation for warehouse use.

### 7.4 Interaction and accessibility

- Every control has a programmatic label, useful accessible name, and keyboard path.
- Validation moves focus or provides a clear error summary and associates messages with fields.
- Loading preserves layout; empty states explain the next action; errors provide recovery; denied states do not leak record existence.
- Dialog focus is trapped and restored; menus and comboboxes follow expected keyboard behavior.
- Live updates do not unexpectedly steal focus or silently replace user input.
- Run automated axe checks, then keyboard-only and screen-reader smoke tests for primary journeys.

The UX review records screenshots for every breakpoint/state combination that materially differs.

## 8. Performance and scalability review

### 8.1 Backend

- Prove each list/detail lookup uses the intended index and bounded page size.
- Flag N+1 document reads, repeated authorization lookups, whole-aggregate rewrites, and hot global counter documents.
- Review transaction read/write sets for avoidable Convex OCC conflicts.
- Load-test hot customer/SKU/FO/allocation scenarios and concurrent retries at the scale envelope in `PROJECT_PLAN.md`.
- Ensure calculation, import, export, reconciliation, and migration jobs are chunked with progress, retry, and dead-letter evidence.

### 8.2 Frontend

- Avoid subscribing a page to unrelated tenant-wide data.
- Paginate or virtualize operational lists before they can become large.
- Prevent waterfalls by resolving required IDs in bounded parallel queries or an appropriate deep query interface.
- Measure production build size and route loading behavior after adding large editors, tables, drawing previews, or calculation libraries.
- Verify optimistic states never imply a durable inventory, approval, or shipment result before server confirmation.

Performance findings include a reproducible dataset/volume, measured result, target, environment, and proposed fix. “Looks fast” is not evidence.

## 9. Security and privacy review

- Permission checks are server-side; hidden buttons are not authorization.
- File upload and every download perform current tenant/permission checks and use private storage.
- Commercial cost and selling-price fields do not enter factory packets unless explicitly authorized.
- Audit records exclude credentials, bearer tokens, unnecessary PII, and private file contents.
- Error messages do not reveal cross-tenant record existence.
- Step-up and maker-checker remain enforced for high-risk actions on shared devices.

Run targeted isolation tests for every new table, list, detail, mutation, file operation, and relationship traversal.

## 10. Phase-specific review matrix

| Phase | Required business evidence                                                                     | Additional risk focus                                                                                      |
| ----- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 5A    | Existing-design and new-design orders reach a pinned, acknowledged factory packet              | Revision immutability, author/releaser separation, exact matching, private files, bilingual engineering UX |
| 5B    | Material shortage is explained, procured, received, and makes an FO ready exactly once         | BOM/UOM math, allocation concurrency, supplier-PO linkage, re-evaluation triggers                          |
| 5C    | Configured route executes with full genealogy and balanced inventory effects                   | Claims, partial quantities, material issue/return, WIP, scrap/rework, hot-step contention                  |
| 5D    | Accepted output becomes available once and rejected output cannot ship                         | Inspection evidence, disposition approval, stock status, rework loops, completion reversal                 |
| 5E    | Concurrent orders cannot double reserve and dispatch consumes reservation/inventory atomically | Availability, partial shipment, cancellation/reversal, close policy, customer visibility                   |
| 5F    | Representative migrated orders finish all branches under pilot load                            | Import integrity, reconciliation, observability, runbooks, rollback, training                              |

## 11. Severity and acceptance decision

| Severity | Definition                                                                                                       | Phase decision                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| P0       | Tenant leak, inventory corruption, security/privacy breach, irreversible data loss                               | Stop immediately; phase fails.                                                 |
| P1       | Core journey wrong/unusable, invalid approval, duplicate financial/inventory effect, inaccessible primary action | Phase fails until fixed and regression-tested.                                 |
| P2       | Important exception/role/breakpoint incomplete, boundedness or performance risk before pilot scale               | Must be fixed or explicitly accepted with owner/date before release candidate. |
| P3       | Polish, maintainability, or low-frequency improvement with safe workaround                                       | May enter tracked backlog.                                                     |

Acceptance requires:

- Zero open P0/P1 findings.
- Every P2 fixed or recorded as a dated, owner-approved exception.
- Green mandatory automated gate or documented external blocker.
- Standards and specification reviews attached.
- UX screenshots/accessibility evidence attached.
- Database/performance/security checklists completed.
- Release-gate and specification-coverage statuses updated to the evidence actually obtained.

## 12. Review report template

Each phase review produces one report containing:

1. Fixed point, scope, specification, and changed paths.
2. Automated commands and exact results.
3. Standards findings.
4. Specification findings.
5. Database and domain findings.
6. Feature/bug findings.
7. UX/color/layout/spacing/accessibility findings with screenshots.
8. Performance findings with measurements.
9. Security/privacy findings.
10. P0–P3 totals, accepted exceptions, residual risks, and `PASS`, `CONDITIONAL PASS`, or `FAIL` decision.
