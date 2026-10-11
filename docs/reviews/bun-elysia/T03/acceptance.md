# T03 acceptance criteria (recorded before experiments)

Recorded 2026-10-11 (UTC timestamp in the external
`implementation/baseline-recorded-at.txt`) at base
`d07f6282bfee73ac8c264f6cab4737487dc52a8e` (tree `035f98f1…`), branch
`codex/bun-security-t03-20261011`, before any install, probe or audit. The
preparation at `4c3db2e` is historical: app `package.json`/`pnpm-lock.yaml`
hashes differ at this base (Vitest/coverage 4.1.11), so graph counts are
derived again here.

## Invariants (must hold throughout)

- pnpm stays authoritative: `packageManager`, `check`, `audit:prod`,
  `audit:full`, install, CI, release and workflow/controller behavior unchanged.
- Unchanged files: `scripts/ci/audit-dependencies.mjs`, `audit-summary.mjs`,
  `report-lib.mjs`, `dependency-exceptions.json`, both `package.json`,
  `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, workflows/actions and
  release scripts. Verified by SHA-256 before/after.
- No active root or release `bun.lock`/`bunfig.toml`. Candidate locks and
  configuration exist only in owned fixtures or temporary probe directories.
- No `.env` reads, secret values, cloud/provider/deploy calls, commits or pushes.
- No dependency lifecycle script executes during any probe; only inert marker
  fixtures demonstrate trust behavior.

## Audit adapter (both `app` and `release`)

Accept only: a clean Bun report; or high/critical advisories whose GHSA,
package, every installed vulnerable version, severity and **every** applicable
parent path (all simple root→package chains in the resolved graph) are listed
by an unexpired exception for that exact scope. Reject:

- unknown high/critical; expired exception; `now === expiresAt` (boundary);
- wrong package, version, severity, path or scope; mixed allowed + unallowed
  paths for the same advisory;
- malformed/empty/missing stdout, non-JSON, unknown severity, unknown package
  (not in graph), unresolvable vulnerable range, contradictory exit status vs
  report contents, registry error text, timeout, signal, spawn error;
- skipped/unsupported/private-registry packages (no silent unaudited package);
- exception records lacking owner/reason/expiry or a scope path list.

Runtime scope: ignore advisories reachable only via dev edges; reject any
high/critical reachable through a production chain with **no** exception
(matching `pnpm audit:prod --audit-level high`).

All-severity summary: accurate counts per severity, public identifiers only,
outage on contradictory/malformed input — reusing `auditSummary` unchanged.

Expiry: deterministic `now` in fixtures; actual clock for real audits.

## Resolved graph

Validate actual resolved versions and parent edges against every root (11) and
release (9) override and its declared selector range; aliases; peer-qualified
snapshot IDs; optional/native OS/CPU metadata; integrity presence/format and
duplicate-ID conflicts; cycles; multiple routes; dev/prod shared reachability.
Fail closed on unknown/unresolved edges, unsupported lockfile schema and
incomplete inventories. Frozen lock must exist before a probe install; manifests
and locks unchanged after. Isolated linker chosen explicitly. A migrated
version mismatch is a blocker, never an upgrade.

Braces seam: enumerate all braces@3.0.3 chains in both scopes, compare to pnpm's
raw reported `findings.paths` on the same frozen graph, explain the
representation difference, and reject unallowed applicable paths. No exception
broadening or silent path dropping.

## Lifecycle policy

Clean isolated app and release probes with `trustedDependencies: []` and
automatic dotenv loading disabled through verified Bun configuration. Inventory
`preinstall`/`install`/`postinstall` and separately `prepare` scripts with
package/version/path/scope/body/SHA-256. Reviewed-blocked stays blocked;
new or changed unreviewed install-time script fails; explicit reviewed trust is
scope/version/path-specific; omitted `trustedDependencies` is shown unsafe and
explicit empty list blocks it, using inert markers only. macOS evidence is not
claimed as Linux evidence.

## Tests

Fixtures for every case above in both scopes. Run only targeted Vitest 4.1.11
files plus existing `dependency-exceptions` and affected CI contract tests. No
full check/build/benchmarks/timings.
