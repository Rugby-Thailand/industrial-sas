# Industrial SSA

A mobile-first, multi-tenant B2B SaaS Warehouse Management System (WMS) for Thai
manufacturing companies.

The first release targets a single production-grade inbound vertical slice:

`PO → Receive → QC → Build pallet/lot → Print label → Putaway → Inventory ledger`

Scope, non-goals, assumptions, delivery phases, and the decisions that must be
accepted before domain implementation are recorded in
[PROJECT_PLAN.md](./PROJECT_PLAN.md).

## Current status

**Toolchain scaffold plus one slice of real code: the tenant security schema. No
warehouse management functionality exists.**

The toolchain is installed, pinned, and green end to end. What is present is the
foundation and nothing more:

- A Next.js App Router shell with one page whose only job is to prove the
  toolchain builds and renders.
- A Convex schema for tenancy, identity, authorization, audit, idempotency,
  devices, entitlements, and (disabled) support grants — declarations only. Every
  tenant table carries a required `orgId` as its first field and every declared
  index begins with it, enforced by construction helpers and proved by a policy
  module that reads the finished schema. Nothing reads or writes a document: there
  is no Convex function, no auth wrapper, no tenant-bound accessor, no webhook, no
  seed, and no deployment. **Tenant isolation is a property of the declared shape
  here, not a runtime guarantee.**
- Real integration and isolation suites over that schema, including negative tests
  that prove the guards fail when they should. The unit, a11y, property, and e2e
  tiers are still placeholder files that assert nothing about the domain and should
  be deleted as real suites land.
- Clerk, UploadThing, and the rest of the dependency list remain installed and
  **not wired up**: no auth, no middleware, no vendor configuration.

There is no authentication, no authorization, no runtime tenant enforcement, no
Convex deployment, and no uniqueness enforcement — Convex has no unique constraint,
so every "unique" key in the schema is unique _by contract_: a bounded index plus
the check the future mutation owes. CI runs the guards described below and nothing
more. Do not run this anywhere but locally.

What else exists is the design record: twelve accepted ADRs,
the domain glossary, the permission catalogue, the release-gate register, the
approval record, the integration contracts, and runbook skeletons. See
[Documentation](#documentation).

## Documentation

[`docs/`](./docs/README.md) holds the architecture and delivery documentation
derived from [PROJECT_PLAN.md](./PROJECT_PLAN.md). It describes intended
behaviour; every document states its own implementation status. `ADR-0001`,
`ADR-0002`, and `ADR-0006` are `Partial` because the tenant security schema
landed; nothing claims a shipped capability.

| Document                                                          | What it is                                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Documentation index](./docs/README.md)                           | Entry point and conventions                                                              |
| [ADR-0001…ADR-0012](./docs/adr/README.md)                         | Accepted cross-cutting architecture decisions, with invariants and rejected options      |
| [Domain glossary](./docs/domain-glossary.md)                      | Ubiquitous language, stable term IDs, and vocabulary that must not appear in MVP code    |
| [Permission catalogue](./docs/permissions.md)                     | Code-owned permission codes, seeded roles, warehouse/maker-checker/step-up semantics     |
| [Release gate register](./docs/release-gates.md)                  | Every gate from the plan with owner, required evidence, and status                       |
| [Approval record](./docs/approval-record.md)                      | Dated authorization: accepted decisions, authorized activity, and approvals not supplied |
| [Integration contracts](./docs/integration-contracts/README.md)   | `INT-01`…`INT-08` ports with timeouts, idempotency, privacy, and failure semantics       |
| [Runbooks](./docs/runbooks/README.md)                             | `RB-01`…`RB-09` operational skeletons with explicit `TODO` evidence gates                |
| [Specification coverage matrix](./docs/specification-coverage.md) | Plan requirements mapped to planned code, tests, and docs, with current status           |

Identifiers in these documents are stable: `ADR-0007`, `INV-0003-02`, `RG-025`,
`G-041`, `INT-04`, `RB-03`, `SC-D12`. Later commits change status, never numbers.

## Prerequisites

- Node.js 22 (see [`.nvmrc`](./.nvmrc)); `engine-strict=true` means a mismatched
  version fails the install rather than warning.
- pnpm 10, pinned via `packageManager`. Use `corepack enable` to honour it.

No environment variables, accounts, or cloud resources are needed. Every command
below passes with no `.env.local` present.

## Local commands

| Command                          | What it does                                                        |
| -------------------------------- | ------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Install exactly what the lockfile specifies                         |
| `pnpm dev`                       | Next.js dev server on port 3000                                     |
| `pnpm build`                     | Production build (also regenerates `next-env.d.ts`)                 |
| `pnpm start`                     | Serve a previous production build                                   |
| `pnpm format`                    | Rewrite files with Prettier                                         |
| `pnpm format:check`              | Fail on unformatted files                                           |
| `pnpm lint`                      | ESLint over the whole workspace                                     |
| `pnpm typecheck`                 | `tsc --noEmit`                                                      |
| `pnpm test`                      | All Vitest tiers                                                    |
| `pnpm verify:workflows`          | CI configuration guard (see below)                                  |
| `pnpm guards`                    | `verify:workflows` + `format:check` + `lint` + `typecheck` + `test` |

### Test tiers

Vitest runs five named projects, each targetable on its own:

| Command                 | Tier                                              | Location                 |
| ----------------------- | ------------------------------------------------- | ------------------------ |
| `pnpm test:unit`        | Component and module tests                        | `src/**/*.test.ts(x)`    |
| `pnpm test:a11y`        | axe-core accessibility assertions                 | `src/**/*.a11y.test.tsx` |
| `pnpm test:property`    | fast-check property tests                         | `tests/properties/`      |
| `pnpm test:integration` | Cross-module tests, later `convex-test`           | `tests/integration/`     |
| `pnpm test:isolation`   | Multi-tenant isolation (blocking gate in Phase 1) | `tests/isolation/`       |

End-to-end tests are owned by Playwright, not Vitest, and need browsers first:

```sh
pnpm exec playwright install --with-deps
pnpm test:e2e
```

Playwright starts its own dev server on port 3100 (`PLAYWRIGHT_PORT`) so it does
not collide with `pnpm dev`.

## Continuous integration

Two workflows run on pull requests targeting `main` and on pushes to `main` and
`feat/**`. Both are credential-free: no secrets, no cloud services, no accounts.
If a job needs a secret to pass, it is the wrong job for this repository.

| Workflow                        | Jobs                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `.github/workflows/quality.yml` | `Static analysis`, `Test (unit\|a11y\|property\|integration\|isolation)`, `Production build` |
| `.github/workflows/e2e.yml`     | `Playwright (desktop + handheld Chromium)`                                                   |

- **Static analysis** runs `verify:workflows`, `format:check`, `lint`
  (`--max-warnings=0`), and `typecheck` (`tsc --noEmit`, strict).
- **Test** is a matrix with one job per Vitest project and `fail-fast: false`, so
  a red isolation tier never masks a red unit tier. The failing tier is readable
  from the checks list without opening a log.
- **Production build** runs `pnpm build` with no environment variables, then
  fails if `next build` changed the tracked `next-env.d.ts`. Note that
  `next dev` writes a different variant of that file (it points at
  `.next/dev/types/routes.d.ts` instead of `.next/types/routes.d.ts`), so after
  running `pnpm dev` or `pnpm test:e2e` locally, discard the change with
  `git restore next-env.d.ts` rather than committing it.
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

| Action                    | Version  | SHA                                        |
| ------------------------- | -------- | ------------------------------------------ |
| `actions/checkout`        | `v7.0.1` | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node`      | `v7.0.0` | `820762786026740c76f36085b0efc47a31fe5020` |
| `actions/cache`           | `v6.1.0` | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |
| `actions/upload-artifact` | `v7.0.1` | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
| `pnpm/action-setup`       | `v6.0.9` | `0ebf47130e4866e96fce0953f49152a61190b271` |

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

## Pinned stack

Every dependency is pinned to an exact version (`save-exact=true`, decision
D-29). Floating ranges are not allowed.

| Area                     | Choice                                            | Version |
| ------------------------ | ------------------------------------------------- | ------- |
| Framework                | Next.js (App Router, Turbopack)                   | 16.2.12 |
| UI runtime               | React                                             | 19.2.8  |
| Language                 | TypeScript (strict)                               | 6.0.3   |
| Styling                  | Tailwind CSS (PostCSS plugin, no config file)     | 4.3.3   |
| Lint                     | ESLint + `eslint-config-next` + typescript-eslint | 9.39.5  |
| Format                   | Prettier + `prettier-plugin-tailwindcss`          | 3.9.6   |
| Unit / integration tests | Vitest                                            | 4.1.10  |
| Property tests           | fast-check                                        | 4.9.0   |
| Accessibility tests      | jest-axe + axe-core                               | 11.0.0  |
| E2E tests                | Playwright                                        | 1.62.1  |
| Backend / data           | Convex (schema declared; no functions, no deploy) | 1.43.0  |
| Identity                 | Clerk (installed, not wired)                      | 7.6.4   |
| Files                    | UploadThing (installed, not wired)                | 7.7.4   |
| i18n                     | `next-intl` (installed, not wired)                | 4.13.4  |

Deferred by decision B-08: Three.js. The MVP uses a 2D SVG occupancy map
instead, and Three.js must not be added unless that decision is explicitly
reversed. No ReUI or shadcn/ui components are installed yet.

Also installed and equally unwired, ahead of the slices that need them: `zod`,
`react-hook-form` + `@hookform/resolvers` (forms and validation), `pdf-lib`
(label generation), `exceljs` and `papaparse` (master-data import/export),
`svix` (webhook signature verification), and `convex-test` (integration tier).
Nothing imports them yet.

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
- `next-env.d.ts` is generated but tracked. Do not hand-edit it.
- `PROJECT_PLAN.md` is excluded from Prettier and must stay byte-for-byte
  identical to the approved document.
- Type declarations for untyped packages live in `types/`.
- `convex/` holds the schema and its helpers. There is no `convex/_generated/`:
  nothing has been deployed, and no command in this repository needs a Convex
  project.

## Next step

The Phase 0 decision gate is closed: `B-01`…`B-12` and `D-01`…`D-30` are accepted
without exceptions, recorded in
[`docs/approval-record.md`](./docs/approval-record.md) (`RG-001`), and
`ADR-0001`…`ADR-0012` are written and accepted (`RG-062`). Local implementation of
the inbound slice per [PROJECT_PLAN.md](./PROJECT_PLAN.md) §9 may therefore proceed,
built against tested adapters and fakes with no vendor credentials.

The tenant security schema is the first slice of that work. What it does not
include, and what comes next, is everything that turns a declared shape into an
enforced one: the tenant-bound accessor (`G-102`), the auth wrapper, Clerk webhook
sync, role and permission seeding, and the mutations that owe the uniqueness checks
the indexes above only make affordable.

The open evidence gates are tracked in
[`docs/release-gates.md`](./docs/release-gates.md). The latency benchmark, scanner
spike, and physical label print (`RG-002`, `RG-003`, `RG-004`), along with the other
external gates, block production and pilot validation and the release itself — not
local domain implementation. No budget, pilot site, vendor, hardware, or legal
approval has been supplied, so those gates stay open.
