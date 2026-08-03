# Industrial SSA

A mobile-first, multi-tenant B2B SaaS Warehouse Management System (WMS) for Thai
manufacturing companies.

The first release targets a single production-grade inbound vertical slice:

`PO → Receive → QC → Build pallet/lot → Print label → Putaway → Inventory ledger`

Scope, non-goals, assumptions, delivery phases, and the decisions that must be
accepted before domain implementation are recorded in
[PROJECT_PLAN.md](./PROJECT_PLAN.md).

## Current status

**Workspace scaffold only. No warehouse management functionality exists.**

The toolchain is installed, pinned, and green end to end. What is present is the
foundation and nothing more:

- A Next.js App Router shell with one page whose only job is to prove the
  toolchain builds and renders.
- Placeholder test files for each test tier, so every guard has something to run.
  They assert nothing about the domain and should be deleted as real suites land.
- Dependencies for Convex, Clerk, and UploadThing are installed but **not wired
  up**: no schema, no ledger, no auth, no middleware, no vendor configuration.

There is no authentication, no authorization, no tenant model, no database
schema, no CI, and no deployment. Do not run this scaffold anywhere but locally.

## Prerequisites

- Node.js 22 (see [`.nvmrc`](./.nvmrc)); `engine-strict=true` means a mismatched
  version fails the install rather than warning.
- pnpm 10, pinned via `packageManager`. Use `corepack enable` to honour it.

No environment variables, accounts, or cloud resources are needed. Every command
below passes with no `.env.local` present.

## Local commands

| Command                          | What it does                                        |
| -------------------------------- | --------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Install exactly what the lockfile specifies         |
| `pnpm dev`                       | Next.js dev server on port 3000                     |
| `pnpm build`                     | Production build (also regenerates `next-env.d.ts`) |
| `pnpm start`                     | Serve a previous production build                   |
| `pnpm format`                    | Rewrite files with Prettier                         |
| `pnpm format:check`              | Fail on unformatted files                           |
| `pnpm lint`                      | ESLint over the whole workspace                     |
| `pnpm typecheck`                 | `tsc --noEmit`                                      |
| `pnpm test`                      | All Vitest tiers                                    |
| `pnpm guards`                    | `format:check` + `lint` + `typecheck` + `test`      |

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
| Backend / data           | Convex (installed, not wired)                     | 1.43.0  |
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

## Next step

Complete the Phase 0 gate in [PROJECT_PLAN.md](./PROJECT_PLAN.md) §4 and §10,
then begin the inbound slice per §9.
