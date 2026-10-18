# HR client implementation — 2026-10-13

This branch fixes DAILY-01, DAILY-02, DAILY-03, KIRO-10, and KIRO-11 from the reviewed ranking. Work was isolated from the original workspace and its user WIP.

## Changes

- **DAILY-01:** A write owns a versioned recovery record and a live operation owner. Remounts subscribe to pending work; retries preserve the original request ID and command. A normal submission cannot silently become a retry. Today and shortcut preferences persist validated serializable command payloads. Today checks action, business date, and recorded time in a clock receipt, presents prior-day recovery separately, and requires a new click for today's command. This also covers a response settling after its original component unmounted.
- **DAILY-01, legacy/opaque commands:** Old ID-only storage and other HR callers whose executable command is unavailable after reload remain locked. Shared feedback offers authorized status-only reconciliation. A confirmed `COMMITTED` or durable `FENCED` answer becomes `RECONCILED`, never a new form success, navigation, or download. A failed reconciliation retains ownership. The backend fence prevents a delayed original write from applying after a fresh command is permitted.
- **DAILY-01, storage failures:** Fresh writes are refused before sending if the recovery record cannot be read or durably saved. A failed local save does not leave a pending ghost. Existing live pending/uncertain commands retain their in-memory owner and exact retry identity when storage subsequently becomes unavailable. Malformed storage without a usable reference stays blocked with actionable HR guidance; no synthetic ID is sent or hidden storage clearing performed.
- **DAILY-02:** Back to Today uses guarded `returnFromTask` with replacement, consuming the task entry and retaining the actual origin's locale, query, and hash. Direct entry uses Today's safe anchor. Dirty consent and pending-write protection remain active.
- **DAILY-03:** A clean shortcut editor adopts newer preferences and their version. Dirty, sorting, pending, and uncertain drafts keep their original baseline; Cancel explicitly adopts the newest available preferences. Successful receipts remain authoritative while reactive queries catch up.
- **KIRO-10:** Employee editor identity is actor plus record ID. A reactive version update keeps the same form and dirty draft; writes retain the draft's original expected version. A clean form adopts the new record and concurrency version without remounting. Pending writes keep their guard.
- **KIRO-11:** The period's open-day list renders every row in the already bounded server preview, including exceptions formerly hidden beyond the first 200 rows.

Navigation inventory changes are limited to the removed local clock-intent state, the audited terminal receipt Notice, and the customization return action. References name literal caller test cases, including the explicit return → next Back chain, direct entry, dirty/pending state, remount, and Forward.

## Evidence and verification

The historical HR recovery probe was run before changes and reproduced all three failures: prior-day replay as new-day success, preference argument conflict after remount, and stale clean-editor preferences. The original Kiro UI probe reproduced draft loss and the 200-row truncation.

The normal suite now contains registered-backend caller regressions in `HrClientRecovery.test.tsx`, reactive editor/list cases in `HrClientReactive.test.tsx`, actual history traversal in `ShortcutNavigation.test.tsx`, additional employee navigation cases, and hook storage/remount coverage. The historical recovery probe's immediate fresh-submit assumption is intentionally replaced by explicit recovery → fresh-command cases; its archived source and evidence were not edited. The two original Kiro UI probes pass unchanged.

Validation on the final client source:

- `pnpm exec vitest run src/features/hr convex/model/hr tests/integration/hr-*.integration.test.ts` — 270/270 tests in 38 files pass.
- `pnpm exec tsc --noEmit` — pass.
- `pnpm lint` — pass, normal full-repository ESLint.
- `pnpm check:navigation` — pass, all 64 fixtures and the reviewed production inventory.
- `pnpm exec vitest run --config docs/reviews/daily-bug-search-2026-10-13/expanded/kiro/vitest.config.mts hr-ui` — 2/2 pass.
- Scoped Prettier check and `git diff --check` — pass.

## Review follow-up: preference settlement after remount

Independent review exposed a pending-remount variant: a preference write committed version 1, but its original component unmounted before the response arrived. The remounted editor displayed the shared owner's SAVED state while retaining baseline version 0; a subsequent save was refused as stale. The new normal registered-backend caller regression reproduced this before the fix.

ShortcutEditor now consumes each shared SAVED receipt once in its mounted render, adopting the highest confirmed receipt/query/baseline version and clearing only the just-completed command's draft. The original persist callback no longer performs a second adoption. The regressions prove a later edit survives rerender, the next command uses expectedVersion 1 and saves version 2, and a newer reactive version 2 arriving before the older receipt remains authoritative for a version 3 save. Existing identity-change and draft tests remain part of the same validation. This adds no new foreground or navigation behavior; the navigation inventory passes unchanged.

## Dependencies and limits

Backend recovery/date support is supplied by original commits `6979e5049907b25399317f9ee170706bf68a7b5d` and `154c09217f0ba955131524fdf3930765d03abfaf`, assembled here as `35df1c8e` and `06b95440`. The client delta is a separate commit.

Caller navigation tests use JSDOM history and the real shared guards; backend tests use registered Convex functions in the local tenant fixture. No production account, cloud database, secrets, push, PR, or release merge was used. Completely corrupted recovery data with no readable request ID cannot be reconciled automatically; it is deliberately blocked. Other HR writes with opaque persisted commands use status reconciliation after an actual reload; Today/preferences support exact serialized retry. This report does not claim manual browser, physical-device, or production-network validation.
