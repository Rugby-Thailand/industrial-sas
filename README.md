# Industrial SAS

A mobile-first, multi-tenant B2B SaaS Warehouse Management System (WMS) for Thai
manufacturing companies.

The first release targets a single production-grade inbound vertical slice:

`PO → Receive → QC → Build pallet/lot → Print label → Putaway → Inventory ledger`

Current scope and delivery live in the [current plan](./docs/plan/README.md).
[PROJECT_PLAN.md](./PROJECT_PLAN.md) is the approved baseline.

## Current status

**Phases 1 to 4 of the plan are implemented locally: the toolchain and tenant
security slice, the pure inventory primitives and append-only ledger, the
master-data catalogue and its write surfaces, the whole inbound vertical slice
(purchase order → receive → QC → pallet → label evidence → putaway → ledger), and
the Phase 4 dashboard, occupancy map, and export jobs. Every screen and every
function runs and is tested — and none of it has ever answered for a real tenant,
because there is no identity provider.**

That last clause is the honest summary of this repository's state: the code is
complete for the phases above and the _vendors_ are not configured, so every
tenant-bound call denies. The sections below separate those two things
deliberately.

The toolchain is installed, pinned, and green end to end. What is present:

- **A Thai-first application shell** with locale-segmented routing (`/th`,
  `/en`), a supervisor route group and an operator route group, a permanent
  organization/warehouse context bar, a connectivity indicator derived from real
  server acknowledgement rather than `navigator.onLine`, and a setup gate that
  names each unconfigured dependency instead of failing vaguely. Two read
  screens — balances and transaction history — call the ledger's real public
  Convex queries. Everything user-facing resolves through the `next-intl`
  catalogues, whose Thai and English key sets are proved equal by a test.
- A Convex schema for tenancy, identity, authorization, audit, idempotency,
  devices, entitlements, and (disabled) support grants. Every tenant table
  carries a required `orgId` as its first field and every declared index begins
  with it, enforced by construction helpers and proved by a policy module that
  reads the finished schema.
- A tenant-bound accessor (`G-102`) and three registration paths —
  `queryWithOrg`, `mutationWithOrg`, `actionWithOrg` — that resolve the active
  tenant from a verified identity, hand a handler no raw database, and **enforce a
  code-owned permission before the handler runs**. A function that declares no
  non-`PLATFORM` catalogue code cannot be registered, and the static guard fails
  the build if one is written. Authorization facts come from the active tenant's
  own rows through bounded `orgId`-first indexed reads; threshold and
  maker-checker facts come from a server-side callback, never from a request
  field; and each attempt is appended to `auditEvents`.
- Signed Clerk webhook handling that mirrors organizations, users, and
  memberships idempotently, and provisioning that seeds the code-owned permission
  catalogue and eight editable roles in the organization's own transaction.
- The pure inventory primitives, under `convex/model/**` with **no Convex
  imports** (plan §6.2, enforced by the boundary guard): quantity as integer
  thousandths of an item's base UOM with total, bounds-checked arithmetic; exact
  reduced-rational UOM conversion that reports an inexact result as a fraction
  rather than rounding it; GS1 element-string parsing for nine Application
  Identifiers with fail-closed FNC1 placement, check digits, and the century rule
  against an injected reference year; identifier normalization that keeps leading
  zeros and lot-code case; internal LPNs with an injected clock and entropy source
  and a check character that provably catches every single-character substitution
  and transposition; a Bangkok business date computed without `Date`, `Intl`, or
  the host timezone, with Buddhist Era as display only; and FIFO/FEFO ordering
  that is a strict total order with an explanation per candidate.
- **A boundary in those modules that a cast cannot walk through.** Every public
  function re-validates the value it is handed and answers a `Result`, because a
  domain type here is an interface and the values it will meet come from documents,
  scanners, and `JSON.parse`: `{ numerator: 1, denominator: 0 } as Ratio` compiles.
  Nothing throws, nothing rounds, and nothing loops — a forged non-finite
  conversion factor could once reach Euclid's algorithm, whose exit test is
  `b !== 0`, and every remainder of a non-finite operand is `NaN`, so the loop
  never returned; the gcd is private now and every caller validates first.
  The argument the caller chose is validated too, and before the value it
  is applied to: a display option bag and a display calendar are as forgeable as a
  quantity or a date, and an unrecognized calendar used to render every date 543
  years off with nothing on the screen to say so. Where a signature promises an
  immutable collection, something freezes at run time — a `ReadonlyMap` is an
  ordinary `Map` there, so the supported-AI table, the timezone registry, an item's
  conversion table, and a parsed scan's values are shallow-frozen null-prototype
  records or shallow-frozen arrays instead. The contract is narrower than
  "immutable", and stated rather than implied: `ok`/`fail` shallow-freeze the
  `Result` wrapper, and each domain value constructor shallow-freezes the record it
  returns — a `Quantity`, a `Ratio`, an `ExactFraction`, a `BusinessDate`, a parsed
  element, an LPN namespace and a parsed LPN, a resolved scan, an item UOM profile,
  a rotation candidate. `Object.freeze` is shallow, so that is as deep as the
  guarantee goes, and two things are deliberately outside it: the `ScaledInteger`
  and `UomConversionOutcome` discriminated envelopes, which are plain objects around
  frozen payloads, and the structured error a failed `Result` carries. Stock is
  expired when
  its **expiration date** is before the `asOf` date, whatever the configured
  rotation date is; a scan that is a valid bare SSCC, one of this tenant's LPNs
  with a broken check character, or a well-formed LPN with no namespace policy to
  judge it by is a named refusal rather than a fall-through to a lot code, a GTIN,
  or a SKU, and a policy claiming one LPN prefix for two organizations is refused
  before it can classify anything.
- **The master-data catalogue and its write surfaces.** Items, locations, lots,
  handling units, owners, reason codes, suppliers, barcodes, alternate units,
  storage classes, and label templates, each with bounded `orgId`-first reads, an
  idempotent audited write seam, uniqueness enforced by contract, deactivation
  rather than deletion, and Thai-first screens.
- **The inbound vertical slice, end to end.** Purchase-order authoring and a
  previewed chunked import; partial, over, under, unexpected, cancelled, and
  blind receipt rules; scan resolution and exact UOM conversion; lot and expiry
  capture; pallet construction; QC sampling, quarantine, and maker-checker
  dispositions; versioned label evidence with the printer boundary stated;
  explainable putaway with an audited override; and the ledger postings each of
  those owes. Desktop and handheld screens for all of it, and **no field asks an
  operator to type a document ID** — every one is a selector over a bounded
  tenant read or a scan the server resolves, asserted structurally over the
  feature source.
- **The Phase 4 dashboard, occupancy map, and exports.** Six maintained counters
  moved inside the transaction that earns them, each recomputable and verified
  against a fresh derivation; a flat accessible occupancy grid (`three` is absent
  from the dependency graph); and chunked, resumable CSV export jobs that stop
  rather than truncate. An independent AES-256-GCM export envelope with a
  rehearsed restore (`pnpm rehearse:restore`) proves the three refusals a backup
  is defined by — wrong key, tampered archive, and an archive that restores
  cleanly and is short.
- Real unit, accessibility, property, integration, isolation, and end-to-end
  suites over all of it, including a two-tenant `convex-test` world, negative
  tests that prove the guards fail when they should, property-tier negative
  controls that fail against deliberately weakened implementations, Thai
  axe-core assertions, and Playwright checks over locale, auth gates, and
  security headers.

What is deliberately still missing, because claiming otherwise would be wrong:

- **Clerk and Convex must be configured locally.** The app has no sign-in bypass,
  development token, or public tenant-data path. See the development setup guide.
- **No printed label and no printer.** Label templates are authored, versioned,
  and published under maker-checker, and a print job records versioned evidence —
  but nothing renders ZPL to a device. There is no printer transport (`INT-04`),
  and `RG-004`/`RG-029` (a physical label printed in Thai and English, and still
  scannable after handling) are physical gates.
- **No signed download for an export.** Export artifacts are private and fetched
  through a permission-checked query, then saved by the browser. Short-lived
  signed URLs need the file-storage vendor (`INT-08`), and the current channel is
  capped by a document size limit — an export that would exceed it stops with
  `ARTIFACT_LIMIT_REACHED` rather than truncating.
- **No scheduled job runner.** Chunked work — the purchase-order import, export
  jobs, reconciliation, expiry — is driven one bounded page per press or per
  call. Workflow/Workpool (`INT-06`) is not provisioned, so nothing runs on a
  timer.
- **No GS1 element-string resolution at capture.** A scan resolves through the
  tenant's own barcodes and SKUs; a single GS1 string carrying item, lot, and
  expiry together is still entered as separate fields. The kernel that classifies
  such a string exists and is tested; binding it needs a per-tenant LPN namespace
  policy and a mutation argument that accepts a raw scan.
- **No PWA beyond a manifest.** `public/manifest.webmanifest` and its icons are
  present; there is no service worker, no cached reference data, and no intent
  queue (`ADR-0009` §2, §4).
- **No uniqueness or never-reuse for LPNs.** A value module can make a collision
  unlikely and a typo detectable; `INV-0005-05` needs the mutation and table that
  do not exist.
- **No supplier-label corpus** (`RG-005`). The GS1 parser rejects every AI it does
  not implement, a variable-length field a supplier failed to terminate with FNC1
  absorbs the rest of the string, and a scanner that emits a separator where the
  specification has none is now a rejection rather than a tolerated quirk. Only
  real labels can say how often any of that matters.
- **No recorded denial for a read.** A Convex query cannot write, so a denied
  query is refused but not audited (`RG-071`). Mutations and actions are audited.
- **No policy values.** Threshold and maker-checker limits have no table, and the
  step-up freshness window is a code-owned constant until `RG-030`.
- **No uniqueness enforcement.** Convex has no unique constraint, so every
  "unique" key in the schema is unique _by contract_: a bounded index plus the
  check the mutation owes.

CI runs the guards described below and nothing more. Do not run this anywhere but
locally.

What else exists is the design record: twelve accepted ADRs,
the domain glossary, the permission catalogue, the release-gate register, the
approval record, the integration contracts, and runbook skeletons. See
[Documentation](#documentation).

## Documentation

[`docs/`](./docs/README.md) holds the architecture and delivery documentation
derived from [PROJECT_PLAN.md](./PROJECT_PLAN.md). It describes intended
behaviour; every document states its own implementation status. `ADR-0001`,
`ADR-0002`, and `ADR-0006` are `Partial` because the tenant security slice landed;
`ADR-0004` and `ADR-0005` are `Partial` because the pure primitives landed.
Nothing claims a shipped capability.

| Document                                                          | What it is                                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Documentation index](./docs/README.md)                           | Entry point and conventions                                                              |
| [Feature manuals](./docs/manuals/README.md)                       | Current operating and integration guidance for each implemented capability               |
| [ADR-0001…ADR-0012](./docs/adr/README.md)                         | Accepted cross-cutting architecture decisions, with invariants and rejected options      |
| [Domain glossary](./docs/domain-glossary.md)                      | Ubiquitous language, stable term IDs, and vocabulary that must not appear in MVP code    |
| [Pure domain modules](./convex/model/README.md)                   | What lives in `convex/model/**`, why it has no Convex imports, and what is absent        |
| [Permission catalogue](./docs/permissions.md)                     | Code-owned permission codes, seeded roles, warehouse/maker-checker/step-up semantics     |
| [Release gate register](./docs/release-gates.md)                  | Every gate from the plan with owner, required evidence, and status                       |
| [Approval record](./docs/approval-record.md)                      | Dated authorization: accepted decisions, authorized activity, and approvals not supplied |
| [Integration contracts](./docs/integration-contracts/README.md)   | `INT-01`…`INT-08` ports with timeouts, idempotency, privacy, and failure semantics       |
| [Runbooks](./docs/runbooks/README.md)                             | `RB-01`…`RB-09` operational skeletons with explicit `TODO` evidence gates                |
| [Specification coverage matrix](./docs/specification-coverage.md) | Plan requirements mapped to planned code, tests, and docs, with current status           |

Identifiers in these documents are stable: `ADR-0007`, `INV-0003-02`, `RG-025`,
`G-041`, `INT-04`, `RB-03`, `SC-D12`. Later commits change status, never numbers.

## Prerequisites

- Node.js 24 (see [`.nvmrc`](./.nvmrc)); `engine-strict=true` means a mismatched
  version fails the install rather than warning.
- pnpm 10, pinned via `packageManager`. Use `corepack enable` to honour it.

No environment variables, accounts, or cloud resources are needed for the build,
tests, or credential-free preview. A real authenticated development product uses
the separate [development setup runbook](./docs/development-setup.md).

## Local commands

| Command                          | What it does                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Install exactly what the lockfile specifies                                  |
| `pnpm dev`                       | Convex and Next.js together; `Ctrl+C` stops both                             |
| `pnpm dev:web`                   | Next.js only, for isolated frontend work                                     |
| `pnpm dev:backend`               | Convex only, for isolated backend work                                       |
| `pnpm dev:check`                 | Check real dev-product readiness without printing credential values          |
| `pnpm build`                     | Production build (also regenerates `next-env.d.ts`)                          |
| `pnpm start`                     | Serve a previous production build                                            |
| `pnpm format`                    | Rewrite files with Prettier                                                  |
| `pnpm format:check`              | Fail on unformatted files                                                    |
| `pnpm lint`                      | ESLint over the whole workspace                                              |
| `pnpm typecheck`                 | `tsc --noEmit`                                                               |
| `pnpm test`                      | All Vitest tiers                                                             |
| `pnpm verify:workflows`          | CI configuration guard (see below)                                           |
| `pnpm verify:tenant-boundary`    | Tenant boundary guard over `convex/` (see below)                             |
| `pnpm verify:environment`        | Environment contract guard (see below)                                       |
| `pnpm audit:prod`                | Fail on a `high`+ advisory in the production dependency tree                 |
| `pnpm guards`                    | every guard above, then `pnpm audit:prod` (the only one needing the network) |

### Visual baselines

`tests/e2e/visual.preview.e2e.spec.ts` compares screenshots, and Playwright
suffixes each baseline with the platform that recorded it. Both sets are
committed: `-darwin` for developer machines, `-linux` for the `ubuntu-24.04`
runner. A missing baseline is a hard failure — `updateSnapshots` is `"none"` on
CI, so a runner can never quietly record its own and then compare against it.

Re-record after an intentional UI change:

| Platform | Command                                   |
| -------- | ----------------------------------------- |
| macOS    | `pnpm test:e2e visual.preview -u`         |
| Linux    | `node scripts/record-linux-baselines.mjs` |

The Linux recorder runs the pinned `mcr.microsoft.com/playwright:v1.62.1-noble`
image at `linux/amd64` — the runner's own architecture, because font
rasterisation is what these baselines measure — over a throwaway copy of the
repository, and copies only the `-linux` PNGs back. It needs a Docker endpoint
that can run that platform (`DOCKER_HOST` selects it) with the image already
pulled; it does not pull one itself.

`node scripts/verify-environment.mjs --class=<developer\|preview\|staging\|production>`
additionally checks the _current_ machine against that class's contract. The
no-argument form used by `pnpm guards` reads only the tracked template and the
contract source, so it stays credential-free. See
[environment contracts](./docs/environments.md).

### Test tiers

Vitest runs six named projects, each targetable on its own:

| Command                    | Tier                                                               | Location                                                     |
| -------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| `pnpm test:unit`           | Component and pure-module tests                                    | `src/**/*.test.ts(x)`, `convex/model/**/*.test.ts`           |
| `pnpm test:a11y`           | axe-core accessibility assertions                                  | `src/**/*.a11y.test.tsx`                                     |
| `pnpm test:property`       | fast-check property tests                                          | `tests/properties/`                                          |
| `pnpm test:convex-runtime` | Convex-backed integration and isolation tests under `edge-runtime` | explicit `convex-test` file allowlist in `vitest.config.mts` |
| `pnpm test:integration`    | Node cross-module, filesystem, and process tests                   | remaining `tests/integration/` files                         |
| `pnpm test:isolation`      | Node repository and tenant-boundary guards                         | remaining `tests/isolation/` files                           |

End-to-end tests are owned by Playwright, not Vitest, and need browsers first:

```sh
pnpm exec playwright install --with-deps
pnpm test:e2e
```

`pnpm test:e2e` creates an isolated production build in `.next-e2e`, then runs
Playwright against one `next start` server. Vendor variables are blank, so the
suite proves every feature route redirects signed-out users to localized sign-in.
It never reads `.env.local` or touches the developer-owned `.next` directory.

## Continuous integration

Two workflows run on pull requests targeting `main` and on pushes to `main` and
`feat/**`. Both are credential-free: no secrets, no cloud services, no accounts.
If a job needs a secret to pass, it is the wrong job for this repository.

| Workflow                        | Jobs                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `.github/workflows/quality.yml` | `Static analysis`, `Test (unit\|a11y\|property\|integration\|isolation)`, `Production build` |
| `.github/workflows/e2e.yml`     | `Playwright (desktop + handheld Chromium)`                                                   |

- **Static analysis** runs `verify:workflows`, `verify:tenant-boundary`,
  `format:check`, `lint` (`--max-warnings=0`), and `typecheck` (`tsc --noEmit`,
  strict).
- **Test** is a matrix with one job per Vitest project and `fail-fast: false`, so
  a red isolation tier never masks a red unit tier. The failing tier is readable
  from the checks list without opening a log.
- **Production build** runs `pnpm build` with no environment variables, then
  fails if the build modified **any** tracked file (`git diff --exit-code`).
  That check used to name `next-env.d.ts` alone and could not pass: Next writes
  `.next/dev/types/routes.d.ts` into it from `next dev` and
  `.next/types/routes.d.ts` from `next build`, so whichever variant was
  committed was wrong for the other command, and the advice here used to be
  "discard the change by hand". The file is generated and git-ignored now, which
  removes the conflict rather than routing around it, and the widened check
  catches anything else a build might rewrite.
  `tests/integration/generated-artifacts.integration.test.ts` holds that in
  place; `pnpm test:e2e` still pins the file for the length of a run, because the
  two servers must not rewrite it under each other.
- **Playwright** is separate because it is the only job needing a browser. It
  installs Chromium alone — both configured projects are Chromium — and caches
  `~/.cache/ms-playwright` against the resolved `@playwright/test` version.

Shared setup lives in `.github/actions/setup-node-pnpm`: pnpm first (so
`actions/setup-node` can cache the pnpm store), Node from
[`.nvmrc`](./.nvmrc), then `pnpm install --frozen-lockfile`. The pnpm version is
never repeated in CI — `pnpm/action-setup` reads the exact pin from
`packageManager` in `package.json`.

Every workflow declares `permissions: contents: read` at the top level and again
per job, checks out with `persist-credentials: false`, and cancels superseded
runs. Concurrency groups key on `head_ref || ref_name` so a pull request and the
push that created its branch share one group instead of burning two runners;
runs on `main` are never cancelled, because every commit on the trunk needs its
own verdict.

Artifacts are deliberately thin. JUnit reports, the Playwright HTML report, and
Playwright traces upload **only on failure** with a 7-day retention. Build
manifests and diagnostics upload on every run because they are a few KB of route
names and bundle sizes — bounded, non-sensitive, and only useful as a series.
No bundle output or environment values are ever uploaded.

### Action pinning and update policy

Every `uses:` reference is pinned to a full 40-character commit SHA with the tag
in a trailing comment. Tags are mutable; a compromised or retagged action would
otherwise be picked up silently.

| Action                    | Version   | SHA                                        |
| ------------------------- | --------- | ------------------------------------------ |
| `actions/checkout`        | `v7.0.1`  | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node`      | `v7.0.0`  | `820762786026740c76f36085b0efc47a31fe5020` |
| `actions/cache`           | `v6.1.0`  | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |
| `actions/upload-artifact` | `v7.0.1`  | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
| `pnpm/action-setup`       | `v6.0.10` | `0977fd99725f1db4007ccb2928dbb4e90d06cc86` |

Local composite actions are referenced by path (`./.github/actions/...`), not by
SHA: they are versioned by the commit that contains them.

To update an action, resolve the tag to its commit and change both the SHA and
the comment together:

```sh
gh api repos/actions/checkout/commits/v7.0.2 --jq '.sha'
```

`.github/dependabot.yml` does the same thing weekly for the `github-actions`
ecosystem, rewriting SHA and comment in one PR. It is scoped to actions only;
npm dependencies stay hand-reviewed under decision D-29. Review these PRs like
any other supply-chain change — read the diff between the two SHAs rather than
trusting the tag.

### Configuration guard

`pnpm verify:workflows` runs `scripts/verify-workflows.mjs`, a Node-only script
with no dependencies (a linter for the pipeline should not itself be an unpinned
dependency). It fails on:

1. A non-local `uses:` without a full 40-character SHA, or without a version
   comment.
2. Any write permission, including `write-all`.
3. Any `${{ secrets.* }}` reference.
4. A workflow missing top-level `on:`, `permissions:`, or `concurrency:`.
5. A literal `pnpm@<version>` in CI that disagrees with `packageManager`, or a
   `packageManager` field that is not an exact pin.

It does not parse YAML — GitHub rejects malformed workflow files on push, and a
YAML parser would mean a dependency. Validate syntax locally with any parser
already on the machine, for example
`ruby -ryaml -e 'YAML.load_file(ARGV[0])' .github/workflows/quality.yml`.

### Tenant boundary guard

`pnpm verify:tenant-boundary` runs `scripts/verify-tenant-boundary.mjs`, which
parses every production `.ts`/`.tsx` file under `convex/` with the pinned
TypeScript compiler — generated code, tests, and fixtures excluded — and fails
when a module reaches around the tenant boundary:

1. `registration` — a public registration builder (`queryGeneric`,
   `mutationGeneric`, `actionGeneric`, or `query`/`mutation`/`action` from a
   Convex server module) imported, aliased, re-exported, dynamically imported,
   or reached through a namespace anywhere but `convex/lib/tenantFunctions.ts`.
2. `raw-database` — a `.db` read, `["db"]` access, or `{ db }` binding outside
   the four adapters allowed to hold one.
3. `storage-factory` — `createQueryTenantStorage` or
   `createMutationTenantStorage` outside those adapters and the wrapper that
   injects them.
4. `storage-port` — a `Tenant*StoragePort` type outside `convex/lib/tenantDb.ts`
   and its Convex implementation. Feature modules get `TenantDocumentAccess`.
5. `authorization-declaration` — a `queryWithOrg`, `mutationWithOrg`, or
   `actionWithOrg` call whose `permissionCode` is missing, is not a string
   literal, or is not a non-`PLATFORM` code of the catalogue the guard parses out
   of `convex/lib/permissions.ts`. A catalogue it cannot read fails the build
   rather than passing the declaration.
6. `audit-append-only` — a `patch`, `replace`, or `delete` naming `auditEvents`,
   which is the plan's append-only merge gate (§12) made mechanical.
7. `model-purity` — an import, re-export, `require`, `import x = require(…)`, or
   dynamic import in `convex/model/**` that reaches outside it, which includes
   every Convex package. A dynamic specifier the guard cannot read — a template
   literal, a variable — is a violation rather than a pass, because it can name
   `convex/server` at run time. Plan §6.2 makes that directory portable domain
   algebra; the guard is what keeps "pure" a fact rather than a comment, because a
   single `convex/values` import would make the algebra untestable without a
   backend and unreplayable inside a mutation.
8. `allowlist-drift` — an allowlisted path that no longer exists, so renaming a
   file cannot quietly widen the boundary.

Three rules have empty allowlists: no file may declare an unenforceable
permission, none may rewrite an audit row, and no pure domain module may import
Convex. Each other rule's allowlist is a
list of exact repository-relative paths, so a file added tomorrow is denied
without the list being touched. It is AST-only on purpose: `ctx.db` and
`TenantStoragePort` appear in prose all over `convex/lib`, and a text scan would
either flag the comments or be loosened until it flagged nothing.
`tests/isolation/tenant-boundary-guard.isolation.test.ts` proves the guard fails
on each bypass, using synthetic source trees in a temporary directory — the real
`convex/` tree is only ever read.

## Pinned stack

Every dependency is pinned to an exact version (`save-exact=true`, decision
D-29). Floating ranges are not allowed.

| Area                     | Choice                                               | Version        |
| ------------------------ | ---------------------------------------------------- | -------------- |
| Framework                | Next.js (App Router, Turbopack)                      | 16.2.12        |
| UI runtime               | React                                                | 19.2.8         |
| Language                 | TypeScript (strict)                                  | 6.0.3          |
| Styling                  | Tailwind CSS (PostCSS plugin, no config file)        | 4.3.3          |
| Lint                     | ESLint + `eslint-config-next` + typescript-eslint    | 9.39.5         |
| Format                   | Prettier + `prettier-plugin-tailwindcss`             | 3.9.6          |
| Unit / integration tests | Vitest                                               | 4.1.10         |
| Property tests           | fast-check                                           | 4.9.0          |
| Accessibility tests      | jest-axe + axe-core                                  | 11.0.0         |
| E2E tests                | Playwright                                           | 1.62.1         |
| Backend / data           | Convex (schema, wrappers, functions, browser client) | 1.43.0         |
| Identity                 | Clerk Next.js + backend SDK (no instance connected)  | 7.7.4 / 3.16.4 |
| i18n                     | `next-intl` (routing, catalogues, formatters)        | 4.13.4         |

Deferred by decision B-08: Three.js. The MVP uses a 2D SVG occupancy map
instead, and Three.js must not be added unless that decision is explicitly
reversed.

The UI primitives in `src/components/ui/` are **vendored shadcn/Radix source**,
adapted for a warehouse floor — every target clears 48 CSS pixels, colours are
this repository's semantic tokens rather than the registry's palette, and the
notes in each file record what was changed from the generated original and why
(`docs/ui-component-migration-notes.md`). They are vendored rather than depended
on: the runtime dependency is `radix-ui`, and `shadcn` itself is only the
registry CLI plus the `shadcn/tailwind.css` variants `globals.css` imports. No
ReUI component is installed.

### Nothing is installed ahead of the slice that needs it

The manifest used to carry ten runtime dependencies that no file imported —
`zod`, `react-hook-form` + `@hookform/resolvers`, `pdf-lib`, `exceljs`,
`papaparse`, `uploadthing` + `@uploadthing/react`, and `@clerk/nextjs` +
`@clerk/react` — installed against slices that had not been written. They are
removed at that point, along with the `@types/papaparse` that typed one of them;
`svix` moved
to `devDependencies`, where its only importer (the integration tier) already was.
`dependencies` went from 24 entries to 13, and the lockfile from 1,038 resolved
packages to 931.

Installing early looked free and was not. Two of the eight advisories this
repository carried came _only_ from packages nothing imported: a high-severity
one through `@hookform/resolvers`, a moderate one through `exceljs`. An
unimported dependency has no call sites to audit and no test that would notice
it breaking, so it contributes risk and install weight and nothing else.

The rule this leaves: **a dependency lands in the same change as its first
import.** `@clerk/nextjs` has now returned with the identity integration;
`pdf-lib` waits for label generation, and `exceljs`/`papaparse` wait for
master-data import/export.

`@clerk/backend` (webhook signature verification), `@clerk/nextjs` (provider,
middleware, and sign-in UI), `svix` (signed integration fixtures), and
`convex-test` are wired and in use.

### Dependency overrides

Some advisories are against a package this repository does not choose. `next`
pins `postcss` exactly, and `postcss` pins `nanoid`; no change to a direct
dependency can move either. Those are pinned through `pnpm.overrides` in
`package.json`, scoped to the exact path `pnpm audit` reported so nothing
outside it moves:

| Override         | Version   | Why it is safe                                                                                                                                                                                                                                                                                                |
| ---------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `next>postcss`   | `8.5.25`  | `next` pins `8.4.31`; `8.5.25` is what `@tailwindcss/postcss` and `vite` already resolve in this build, so the override **dedupes** to a version this repository was compiling with rather than introducing one.                                                                                              |
| `postcss>nanoid` | `^3.3.18` | Both `postcss` copies resolved `3.3.16`; `postcss` asks for `^3.3.16`, so this is inside its declared range.                                                                                                                                                                                                  |
| `next>sharp`     | `^0.35.3` | `next@16.2.12` declares `^0.34.5`, but `next@16.3.0` declares `^0.35.3` against the same 16.x image optimizer — first-party evidence that 0.35 is API-compatible. `sharp` is an `optionalDependency`, and this application uses no `next/image` and ships no raster assets, so it is never loaded either way. |

Each is a candidate for deletion, not permanence: when `next` ships a release
whose own ranges are clean, the corresponding line should go. `pnpm audit:prod`
is what will say so — it fails on `high` and above against the production tree,
runs in the `static-analysis` CI job, and is the last step of `pnpm guards`
(last because it is the only guard that needs the network).

### Version constraints worth knowing

These pins are deliberate. Raising them without checking the constraint will
break a guard.

- **ESLint is held at 9.x, not 10.x.** `eslint-config-next` depends on
  `eslint-plugin-react`, whose latest release (7.37.5) declares
  `eslint: ... || ^9.7` and crashes under ESLint 10. ESLint 10 is usable here
  only once `eslint-plugin-react` ships ESLint 10 support.
- **TypeScript is held at 6.0.x, not 7.x.** `typescript-eslint` 8.65.0 declares
  `typescript: >=4.8.4 <6.1.0`, and no `typescript-eslint` 9 exists yet.
- **`jsx` is `react-jsx`** in `tsconfig.json` because `next build` mandates it
  and rewrites the file otherwise.
- **`baseUrl` is unset.** TypeScript 6 deprecates it; `paths` resolve relative to
  `tsconfig.json` without it.

## Repository conventions

- Trunk-based development on `main` with short-lived feature branches.
- Secrets are never committed. `.env*` files are ignored; only
  [`.env.example`](./.env.example) is tracked, and it holds names with no values.
- `next-env.d.ts` is generated and git-ignored — its contents depend on whether
  `next dev` or `next build` wrote it last, so no committed value is correct.
  Do not hand-edit it and do not add it back.
- `PROJECT_PLAN.md` is excluded from Prettier and must stay byte-for-byte
  identical to the approved document.
- Type declarations for untyped packages live in `types/`.
- `src/` is organized as plan §8 describes: `app/[locale]/(desktop|handheld|auth)`
  for routes, `components/` for presentation, `features/` for a screen's data
  path, `i18n/` for locale routing and catalogues, and `lib/` for pure decisions.
  The rule that keeps it testable: a decision goes in `lib/` as a pure function,
  and a component reads it. `resolveAppEnvironment`, `resolveLedgerGate`,
  `resolveWorkspace`, `classifyConnection`, and the cursor reducer are all
  covered without rendering anything.
- No user-facing string is written in a component (`INV-0010-01`). Text comes
  from `messages/th.json` and `messages/en.json`, whose key sets, ICU
  placeholders, and Thai-content presence are asserted by
  `src/i18n/messages.test.ts`. Code identifiers — permission codes, stock
  statuses, error codes — stay English (`D-06`) and are rendered verbatim.
- `convex/` holds the schema, its helpers, and the ledger's public functions.
  The credential-free API/type surface in `convex/_generated/` is committed, so
  a clean checkout type-checks against the server's inferred function contracts.
  Run `pnpm codegen` after adding, renaming, or changing a Convex function. The
  browser adapters use those references through `src/lib/convex/clientRef.ts`,
  which exposes wire-format document IDs as strings for route and preview data.
- `convex/model/` holds pure domain modules with no Convex imports (plan §6.2).
  See [`convex/model/README.md`](./convex/model/README.md); the boundary is
  enforced by `pnpm verify:tenant-boundary`, and the tests are colocated
  `*.test.ts` files in the unit tier.
- `pnpm measure:code` reports production and test SLOC against the accepted
  reduction baseline; generated output is reported separately and never counts
  toward the target.

## Next step

The Phase 0 decision gate is closed: `B-01`…`B-12` and `D-01`…`D-30` are accepted
without exceptions, recorded in
[`docs/approval-record.md`](./docs/approval-record.md) (`RG-001`), and
`ADR-0001`…`ADR-0012` are written and accepted (`RG-062`). Local implementation of
the inbound slice per [PROJECT_PLAN.md](./PROJECT_PLAN.md) §9 may therefore proceed,
built against tested adapters and fakes with no vendor credentials.

This commit adds the application shell over the work already done: locale
routing, the two shells, the workspace and connectivity chrome, the shared
formatters, and the first two screens that call real Convex functions. It closes
the "PWA shells, locale routing, Thai/English baseline, and responsive
navigation" line of the plan's Phase 1 deliverables, in the part that does not
need a vendor account.

What comes next, in the order the slice needs it: connect a Clerk development
instance and complete the authenticated smoke test; policy values for thresholds
and maker-checker (`RG-030`, §5 Q26) so those facts
stop being per-operation callbacks; a write-capable sink so a denied read is
recorded (`RG-071`); and then the first feature functions — PO, receipt, QC,
handling unit, label, putaway — each with the screens that drive them, each owing
a permission declaration and the uniqueness checks the indexes only make
affordable.

The open evidence gates are tracked in
[`docs/release-gates.md`](./docs/release-gates.md). The latency benchmark, scanner
spike, and physical label print (`RG-002`, `RG-003`, `RG-004`), along with the other
external gates, block production and pilot validation and the release itself — not
local domain implementation. No budget, pilot site, vendor, hardware, or legal
approval has been supplied, so those gates stay open.
