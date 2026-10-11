# T03 implementation handoff — Bun dependency security, resolved graph and lifecycle parity

Status: **KIRO_CORRECTED_FINAL_AUDIT_FINDINGS (uncommitted; not approved).** Both independent final audits requested changes on `f92f437ac281519fff93d527ccb1241b5e3cd2dd`. The scoped corrections are recorded in [`final-audit-corrections.md`](final-audit-corrections.md): the installed store now refuses nested package-local `node_modules`, both manifest loaders reject duplicate keys, audit HOME cleanup is attempted on setup and close paths, with removal failures settled as refusals, and the 26 recorded test type errors are fixed. New independent non-author audits and exact-version full gates are pending. Earlier results below, including the initial-audit fixes, are historical evidence.
Base `d07f6282bfee73ac8c264f6cab4737487dc52a8e` on
`codex/bun-security-t03-20261011`. Implementation agent: Kiro, claude-opus-5.5,
high effort, no delegation. Segment 1 ended 2026-10-11T08:53:25.369190Z
(partial). Segment 2 started 2026-10-11T08:54:42.161041Z and ended
2026-10-11T09:10:20.627055Z with observed exit 0. Segment 1 was paused
from 08:25:18.176199Z through 08:47:52.491768Z for the entire root
performance condition, including quota waits. Exact external process receipts
govern these times; no external timeout was hit.

pnpm remains the authoritative installer and audit gate. Every addition is
opt-in. At the original implementation freeze the additions were untracked; they were
subsequently committed as `07cf888b651e5b67009bfe0ea6cc2a8460b63d63`,
then the delivery ledgers as `4474baae87147ef9cd0ffe5bc0c36c5aae622669`.
The original 23 baseline hashes in [`source-manifest.json`](source-manifest.json)
still verify. There is no active root or release `bun.lock`/`bunfig.toml`.
Acceptance was recorded before any experiment in [`acceptance.md`](acceptance.md).

Kiro refactor (after the Codex fixes): see [`refactor.md`](refactor.md). It
makes two scoped changes. The audit child now keeps raw output bytes per stream
and decodes them once, so UTF-8 split across chunks survives, the bound counts
raw bytes and no rescanning occurs. A duplicate root package reader was
removed. Four scoped suites: 146 passed, exit 0. All adoption barriers below
are unchanged.

## Result

| Area                                           | Candidate decision on the real graph                                                            | Status                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------- |
| pnpm baseline gates (unchanged, current clock) | `pnpm audit:prod` 0; `audit-dependencies --scope=app` 0; `--scope=release` 0                    | Unchanged                          |
| Bun audit, app, exceptions                     | **Fails**: braces@3.0.3 has 3 chains, 2 not excepted                                            | **Blocker**                        |
| Bun audit, release, exceptions                 | **Fails**: braces@3.0.3 has 37 chains, 36 not excepted                                          | **Blocker**                        |
| Bun audit, app, runtime (`--prod`)             | Passes (raw `{}`, exit 0)                                                                       | Parity                             |
| Bun audit, release, runtime                    | Fails: every release chain is production                                                        | Stricter; no pnpm equivalent today |
| Bun audit, summary (all severities)            | app high 1/moderate 4; release high 1/moderate 1 — equal to pnpm                                | Parity                             |
| Lockfile graph parity                          | Fails: platform metadata rewrites, 3 peer-edge differences (see below)                          | **Blocker** for T04/T05            |
| Installed graph (isolated, darwin-arm64)       | release identical; app has 3 extra Bun edges (`debug → supports-color`)                         | **Real difference**                |
| Overrides vs resolved parent edges             | Initial claim withdrawn: the audit found selector/provenance errors; corrected proof is pending | Unproven                           |
| Lifecycle (install-time scripts)               | app 5 = pnpm `ignoredBuiltDependencies`; release 1 (`esbuild`); all reviewed-blocked; passes    | Parity (macOS)                     |

The candidate is stricter than the current gates, so T04/T05 cannot switch
on this evidence. The exception was not broadened and no path was dropped.

## Braces path seam (reconciled)

Evidence: [`braces-path-reconciliation.json`](braces-path-reconciliation.json).

- Both lock graphs give identical all-simple-path sets: 3 app and 37 release
  chains, all `braces@3.0.3`. App chains are development-only (eslint-config-next
  and two shadcn chains). Every release chain is production through
  `vercel` builders (`@vercel/backends`, `@vercel/node`, `@vercel/static-config`
  and others to `ts-morph`).
- In the matched raw `pnpm audit --json` captures, `findings.paths` hold exactly
  the one excepted path per scope.
- Why they differ: pnpm 10.33.2 `lockfileToAuditTree` uses
  `lockfileWalkerGroupImporterSteps`, which keeps a shared `walked` set. Each
  peer-qualified snapshot is emitted once, at the first position reached, with
  siblings claimed before descent, and dev roots spread before prod roots. The
  registry therefore sees one route per snapshot. `pnpmAuditTreePaths`
  reimplements that walk, and on both real locks it returns exactly the single
  reported path (asserted in `bun-audit-adapter` "matched real registry reports").
  The excepted path is a compression artifact of pnpm's request, not the only
  route through which `braces` is installed.
- Bun's raw JSON has no versions or paths. The adapter derives every installed
  vulnerable version and every simple chain from the graph. `auditProblems`
  (unchanged) requires every path to be excepted, so both scopes fail.
- Resolving this is a risk decision outside T03: either a reviewed PR that
  lists every chain, with owner, reason and expiry, or a fix. The research
  doc's requirement to reject an advisory that reaches a package through both
  an allowed and an unallowed chain is met.

## What was built

| File                                                                                        | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/ci/bun-audit.mjs`                                                                  | Validates the raw `bun audit --json` child result and fails closed on: spawn error, timeout (SIGKILL deadline 120 s), signal, exit ∉{0,1}, stderr `audit request failed`/`error:`, empty/non-JSON/non-object output, registry `error`/`message` objects, malformed entries (id, GHSA URL, title, range), unknown severity, exit 0 with advisories, exit 1 with `{}`. It also fails on coverage gaps: non-default registry tarballs, `.npmrc` registry/scope lines, `bunfig` registry/scopes. It then rebuilds a pnpm-shaped report (GHSA, package, each installed vulnerable version, every chain) and calls the unchanged `auditProblems` (exceptions; runtime with `[]`) or `auditSummary`. An advisory matching no installed version or path, or naming a package absent from the lock, throws. Runtime mode drops only dev-only chains, as `pnpm audit --prod` does. CLI: `--scope --bun-dir --mode=exceptions\|runtime\|summary [--bun] [--replay=<stdout>:<exit>]`. The corrected live child uses a private temporary HOME/XDG_CONFIG_HOME, PATH/NO_COLOR and `--no-env-file`; it bounds each output stream to 8 MiB and rejects a latched overflow even after exit 0. Global config isolation and owned cleanup are covered by inert child tests. |
| `scripts/ci/lockfile-graph.mjs`                                                             | Strict parsers for the pnpm v9 YAML subset and bun.lock v3 (rejects anchors, block scalars, tabs, nested flow, duplicate keys, comments, unknown versions/workspaces/resolutions). Builds one normalized graph with aliases (`npm:` and pnpm alias references), peer-qualified snapshot IDs, nested bun keys, optional peers, os/cpu/libc and integrity. Checks: unresolved/unknown edges, unreachable entries, sha512 integrity present/valid/consistent, overrides against actual resolved parent edges (exact values only; parent, parent-range and child-range forms; Bun's one-level limit), declared-range drift unexplained by an override, exact root pins, platform-installed sets, all simple paths (cycle-safe, multiple routes, production flag, throws rather than truncating at 50 000) and pnpm/bun comparison. The CLI requires `trustedDependencies: []` and an existing `bun.lock`.                                                                                                                                                                                                                                                                                                                                                    |
| `scripts/ci/installed-graph.mjs`                                                            | Reads `node_modules/.bun` or `.pnpm` symlinks, which is what packages actually resolve, including optional-peer links. Dangling links or missing stores throw.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `scripts/ci/lifecycle-policy.mjs`                                                           | Inventories each materialized manifest: `preinstall/install/postinstall` (plus an implicit `binding.gyp` install) separately from `pre/prepare/post` prepare scripts, recording scope, name, version, path, body and SHA-256. It never runs scripts. Policy: `trustedDependencies` must be declared. Each install-time script must match a reviewed entry for that scope, version, event and body hash. `blocked` must not be trusted. `trusted` must be listed and must cover the installed path. Trust that would also run another version of the same name fails, as do stale entries and changes to the reviewed prepare-inventory digest.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `scripts/ci/semver-range.mjs`                                                               | Dependency-free node-semver range evaluation for advisories and selectors; unsupported syntax throws. Cross-checked against semver 7.8.5: 1258 checks, 0 mismatches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `tests/fixtures/bun-lifecycle/reviewed-scripts.json`                                        | Candidate review. app: the five pnpm-reviewed packages, blocked. release: esbuild 0.27.0, blocked, because pnpm 10 blocks it by default (there is no release review list). Prepare digests: app 55, release 27.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `tests/fixtures/bun-lifecycle/marker-probe.mjs`                                             | Inert trust probe. Loopback registry with two synthetic packages, a synthetic `.env` it creates itself, async children with deadlines. Never part of `pnpm test`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `tests/fixtures/bun-audit/*`, `marker-probe-darwin-arm64.stdout`                            | Byte-identical frozen raw captures, renamed so Prettier leaves the bytes alone. Hashes and originals are in the manifest.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `tests/integration/bun-{audit-adapter,resolved-graph,lifecycle-policy}.integration.test.ts` | 32 + 31 + 18 cases.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

No `package.json` script was added. CLI usage is explicit `node scripts/ci/…`.

## Fixture coverage (both scopes via `describe.each`)

- **Audit**: clean; exact allowed advisory with full path list; unknown high,
  critical and unexcepted package; expired, `now == expiresAt` boundary and
  `expiresAt-1`; wrong package/version/severity/path/scope; mixed
  allowed+unallowed (both paths retained); malformed (11 shapes), unknown
  package, unparsable range, out-of-range version; registry error/request
  failure/contradictions (8 shapes × 3 modes); timeout (including deadline hit
  then exit 0), signal, ENOENT, exit 2; skipped/private registry; invalid
  exception records; all-severity counts. Runtime: dev-only ignored, production
  high rejected despite an exception, moderate allowed but counted. Real matched
  captures: old pnpm decision passes, new decision fails, summaries equal,
  app runtime clean, release runtime not.
- **Graph**: YAML/lock schema refusal; pnpm aliases and peer-qualified snapshots;
  `npm:` alias impostor; required versus optional peers; dangling snapshot,
  orphan record and tarball resolution; unresolved bun edges, missing/invalid/
  conflicting integrity, unreachable entries; cycles, multiple routes, dev/prod
  shared reachability, truncation refusal; pnpm audit-tree emulation;
  platform-compatible/incompatible/missing installs and `none` rewrites;
  parent-scoped and range-qualified override mismatches, floating values,
  inactive overrides, declared-range drift, exact root pins; scope parity pass,
  migrated-mismatch blocker, omitted trust and missing lock; installed-layout
  links, peer-variant merge, dangling links; the current repository locks;
  semver.
- **Lifecycle**: inventory split; reviewed-blocked stays blocked; omitted trust;
  new, changed, implicit node-gyp and version-bumped scripts; trust limited to
  scope, version and path (other-scope review, second path, second version);
  prepare inventory required and changes detected; linked siblings and empty
  stores; the real review equals pnpm's list; frozen marker observations.

Mutation spot checks (10 fail-open edits, modules restored and hash-verified):
9 were caught at first run. The one survivor (timeout check removed) exposed a
weak assertion that accepted any problem; the test now asserts exact messages
and the mutant is caught.

## Tests run (only targeted suites; Vitest 4.1.11)

| Command                                                                                                                                       | Exit | Result              |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------- |
| `pnpm exec vitest run --project integration` bun-audit-adapter, bun-resolved-graph, bun-lifecycle-policy, dependency-exceptions, ci-workflows | 0    | 5 files, 133 passed |
| same, ci-test-discovery, ci-release-policy, ci-guards, bun-checker                                                                            | 0    | 4 files, 54 passed  |
| `pnpm exec prettier --check .`                                                                                                                | 0    | all files formatted |
| `pnpm exec eslint --max-warnings=0` on the 9 new code files                                                                                   | 0    | clean               |

No full `pnpm check`, build, `bun --check`, typecheck or benchmark was run.
No performance was measured or is claimed.

## Commands and receipts

Probe installs ran in `/tmp/t03-probe-*/{app,release}/{migrate,frozen,scripts-visible}`.
Each had a private HOME, TMPDIR, XDG_CONFIG_HOME and Bun cache, an
`env -i` environment, a probe-local `bunfig.toml` (`env = false`,
`linker = "isolated"`, `exact = true`, `globalStore = false`;
`ignoreScripts = true` except scripts-visible), and `trustedDependencies: []`.
No `.env` file existed in any probe.

| Step                                                                                                                                                                   | Exit                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile --ignore-scripts --store-dir <worktree>/.cache/t03-pnpm-store` (root; then `tools/release`)                                            | 0, 0; all baseline hashes unchanged                                    |
| `node scripts/ci/install-bun-checker.mjs` → `bun 1.4.3+c6da4a4d3`, TS 7.0.2; archive sha256 `80afd4c0…a3403` (= pin); binary sha256 `28c7dd0a…3f79`; `--verify` passed | 0                                                                      |
| `bun install --lockfile-only` (migrate pnpm-lock → bun.lock v3; moves overrides into the probe package.json)                                                           | 0, 0                                                                   |
| `bun install --frozen-lockfile` on the preserved lock copy (lock existence asserted first; lock/manifest/bunfig hashes equal before and after)                         | 0, 0                                                                   |
| `bun pm untrusted` (ignore-scripts and scripts-visible installs)                                                                                                       | 0; reports **0 untrusted** in both scopes despite real blocked scripts |
| `bun audit --json` / `--json --prod` (app; release)                                                                                                                    | app 1 / 0; release 1 / 1; stderr empty                                 |
| `pnpm audit --json` / `--prod` (app; release)                                                                                                                          | 1 / 0; 1 / 1                                                           |
| `node tests/fixtures/bun-lifecycle/marker-probe.mjs --bun=…` (attempt 5, final)                                                                                        | 0, stderr empty                                                        |
| Final replays/policies (`final-receipts/commands.txt`)                                                                                                                 | see Result table                                                       |

External evidence (`industrial-sas-delivery-preserved-20261011/T03/implementation/`):
`raw-audit/`, `candidate-locks/{app,release}/` (with before/after hashes),
`logs/`, `lifecycle/`, `replay/`, `final-receipts/`, `mutations/`,
`installed-graph-comparison-darwin-arm64.json`, `bun-default-trusted.txt`
(367 names), `bun-v1.4.3-src-install-lockfile.rs` (sha256 `3e6d9ccc…4ee6`) and
`failed-receipts/`. Failed receipts are preserved:

- attempt 1 stalled because `spawnSync` blocked the loopback registry; the
  coordinator stopped it (diagnosis in `marker-probe-coordinator-stall.json`);
- attempt 2's raw JSON (non-canonical tarball URL) was lost when a move and a
  rerun ran in one parallel batch, and its README records this;
- attempt 3 was misfiled;
- attempt 4 was superseded by attempt 5, which added the `--no-env-file` cases.

## Lifecycle and dotenv findings (darwin-arm64, Bun 1.4.3, inert markers only)

| Case                                                         | esbuild-named marker                                                                                       | plain marker | Runtime `bun -e` sees `.env` |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------- |
| `trustedDependencies` omitted                                | **ran** (default trust; requires canonical registry tarball URL, per `lockfile.rs has_trusted_dependency`) | blocked      | no (`env=false`)             |
| `trustedDependencies: []`                                    | blocked                                                                                                    | blocked      | no                           |
| `["esbuild"]` / `["t03-untrusted-marker"]`                   | only the listed one ran                                                                                    |              | no                           |
| `["esbuild"]`, dotenv enabled                                | ran                                                                                                        | blocked      | **yes**                      |
| `["esbuild"]`, `ignoreScripts = true`                        | blocked                                                                                                    | blocked      | no                           |
| `["esbuild"]` + `--no-env-file` (global or install position) | ran                                                                                                        | blocked      | no                           |

**Dotenv limitation:** every trusted marker that ran received the synthetic
`.env` value (`postinstall:from-dotenv`). This held with `env = false` and with
`--no-env-file` in either position. Those settings stop only runtime loading.
They do **not** keep `.env` values out of install lifecycle scripts. For
future Bun installs the controls are therefore:

- explicit `trustedDependencies: []` (or `ignoreScripts`), so no dependency
  script runs;
- no real `.env*` file in the install directory.

CI checkouts have none (`.gitignore`). A developer worktree with `.env.local`
does, so a trusted script there could read it. T04 must address this before
any package is trusted.

Bun's default trust list includes `esbuild`, `msgpackr-extract`, `sharp`,
`bufferutil` and `utf-8-validate`. Without `trustedDependencies: []`, Bun would
run esbuild's and msgpackr-extract's install scripts, which pnpm blocks today.

## Limitations and unresolved items

1. **Braces exception blocker** (both scopes): see above. Not resolved by T03.
2. **Release runtime audit fails**: pnpm has no release `--prod` gate, so this
   is a new, stricter decision, not a regression. Wiring it into any gate
   requires the braces decision first.
3. **bun.lock platform metadata**: Bun writes `cpu`/`os` `"none"` for values it
   does not recognise (`loong64`, `mips64el`, `riscv64`, `wasm32`, `netbsd`,
   `openharmony`): 26 app and 17 release packages. It rewrote `systeminformation`'s
   OS list to `!aix` and dropped `libc` on 82 app and 27 release packages.
   Installed darwin-arm64 sets still match. Linux glibc/musl selection without
   `libc` is **unverified**: both `-gnu` and `-musl` variants could install
   on Linux.
4. **Peer edges**: the lock-only lookup emulation reports 3 differences that
   the installed graph does not (`zod-validation-error → zod`,
   `@napi-rs/wasm-runtime → @emnapi/*`). Lockfile parity for peers needs the
   installed reader. The installed graph shows one real app difference: Bun
   links optional peer `supports-color` under `debug@3.2.7`/`debug@4.4.3`,
   which pnpm leaves unlinked. That changes `debug` colour detection at
   runtime, and `supports-color@7.2.0` becomes production-reachable.
5. **`bun pm untrusted` is blind** on pnpm-migrated locks (0 reported). The
   policy uses the manifest inventory instead.
6. **Platforms**: all install, lifecycle and installed-graph evidence is
   macOS 26.5.2 arm64. There is no Linux evidence. Linux CI inventories
   (optional natives, implicit `binding.gyp`, libc variants) must be derived on
   Linux before T04/T05. The review file may need per-platform entries.
7. **Reviewed release decision**: blocking esbuild in release is a maintainer
   decision recorded as a candidate, matching current pnpm default behavior.
8. **Raw-report freshness**: the captures are dated 2026-10-11 (UTC times in
   `raw-audit/captured-at.txt`). Advisories change; the fixtures prove
   behavior, not current advisory state. Real audits use `Date.now()`.
9. **Not integrated**: no CI, workflow, package script or default changed.
   The adapter's live mode runs `bun` from PATH unless `--bun` is given.
10. **Nested package layouts are refused, not modelled** (final-audit
    correction). The real pnpm app store fails closed on
    `resolve@2.0.0-next.7`'s published `test/**/node_modules` fixtures. The
    release pnpm store passes (268 entries, 1 root; darwin-arm64). See
    [`final-audit-corrections.md`](final-audit-corrections.md).

## Current-main reconciliation risk

Graph counts are for `d07f628` (app 1076 nodes/59 roots, release 365/1). T02
(Elysia/TypeBox) will change the app lock. Before any integration, the
coordinator must rerun the migration, frozen install, raw audits, the three
CLIs and the review-file derivation on the final integrated head. The prepare
digest and install entries will fail closed if anything changed.

## Rollback

Revert the scoped candidate commit(s), including the corrected shared readers and tests, or delete the new files listed in the final source manifest. The original implementation manifest is historical; it must not validate modified source. Original additions: (`scripts/ci/{bun-audit,
installed-graph,lifecycle-policy,lockfile-graph,semver-range}.mjs`,
`tests/fixtures/bun-audit/`, `tests/fixtures/bun-lifecycle/`, the three
`tests/integration/bun-*.integration.test.ts`, `docs/reviews/bun-elysia/T03/`).
No baseline file changed. pnpm install and audit stay fully operational.

## Not done (out of scope)

Delivery ledgers, defaults, locks, dependencies, CI/release, exception changes,
commits, pushes and PRs.
