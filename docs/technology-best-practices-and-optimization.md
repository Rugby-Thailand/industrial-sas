# Technology best practices and optimization

A review of the stack this repository actually pins and uses, against first-party
documentation and specifications only. Every claim about the current state cites a
file path or symbol in this repository; every recommendation cites official vendor
documentation, an official specification, or an authoritative upstream source
repository next to the claim it supports.

**Scope note.** This document does not propose upgrades. Nothing here is
recommended because a newer version exists — every item is a practice, a gap, or an
optimization for the versions already pinned in
[`package.json`](../package.json).

**Research snapshot.** Repository facts and generated-artifact measurements were
captured against commit `2ff34b0` on 2026-08-12. They are a historical baseline,
not assertions about later commits. Re-run the inventory and measurement commands
before using exact counts or byte sizes as acceptance thresholds.

**Status of this document:** advisory. It changes no code and closes no release
gate. Where a recommendation would contradict a decision recorded in
[`PROJECT_PLAN.md`](../PROJECT_PLAN.md), an ADR, or
[`docs/release-gates.md`](./release-gates.md), that is stated rather than glossed.

---

## 1. Executive summary

This repository is unusually disciplined for its stage, and the review found that
most of the Convex practices that normally appear as findings are already enforced
mechanically here rather than by convention. Index-only reads, argument **and**
return validators on all 76 public functions, server-side access control on every
public entry point, table-name-first `ctx.db` calls, and pure domain logic isolated
from the Convex runtime are all in place and guarded by
`scripts/verify-tenant-boundary.mjs`. Section 4 records these explicitly so they are
not re-litigated.

The material findings fall into four groups.

1. **Identity wiring is the gating prerequisite, and one constant in it is
   pinned to a deprecated Clerk claim.**
   `convex/lib/tenantContext.ts:134` pins the active-organization claim to
   `org_id`, which is a **version 1** Clerk session-token claim; Clerk deprecated
   version 1 on 14 April 2025 and version 2 nests the organization as `o.id`. The
   file's own comment says the literal is unpinned and must be reconciled with
   the claims emitted by the Clerk integration — this document supplies the
   first-party basis for that reconciliation and a test that would catch a
   mismatch. Alongside it, `convex/auth.config.ts` is absent and
   `ConvexClientProvider` uses the plain `ConvexProvider`, neither of which can
   stay that way once a Clerk instance exists.

2. **Two Convex reads filter _after_ pagination**, in
   `convex/masterData/catalogue.ts:546` and `:947`. Convex documents that page
   sizes are not stable and that index ranges should be as specific as possible;
   filtering a page after it is read produces short pages, and can produce an empty
   page while the envelope still reports `complete: false`. The fix is an index
   field, not a code change at the call site.

3. **The tenant wrapper reads time on the query path.**
   `runTenantFunction` mints a `requestId` during query execution
   (`convex/lib/tenantFunctions.ts:286`, `:564`) and that value is part of the
   declared success envelope (`:372`), and `authorizeTenantRequest` reads the clock
   at `:420` for time-bounded authorization inside queries too. Convex makes its
   query runtime deterministic, but its published best practices still say not to
   use `Date.now()` in queries because the passage of time does not invalidate a
   subscription and clock-dependent results cause avoidable cache churn.

4. **The whole message catalogue ships to every route.** Measured, not
   assumed: the Thai string for the quality screen's description
   (`messages/th.json:501`) is present in the prerendered
   `.next-e2e/server/app/th/dashboard.html`, a 93,849-byte document against a
   66,532-byte `th.json`. `next-intl` documents this as the default and documents
   the remedies.

Beyond these, the largest untaken opportunities fit the
repository's existing seams: real-user performance measurement through
`useReportWebVitals` into the already-built `ObservabilityPort`; real-browser
accessibility assertions in Playwright to complement the jsdom axe tier;
`error.tsx` route boundaries so a server-side throw is a translated screen rather
than Next's default; response security headers; and resumable reconciliation for
the unverifiable-rollup limitation `convex/reporting/rollups.ts` already documents
about itself. The Convex Aggregate component may improve maintained dashboard
projections, but it is not a substitute for independent source reconciliation.

### Post-snapshot implementation status

The worktree advanced while this research was being reviewed. The status below
combines a read-only check at base commit `14dead3` with the optimization batch
implemented from this report:

| Finding | Implementation status                                                                                                                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-04    | Implemented by `ab7ca49`: the status-carrying lot and barcode indexes are present, the post-page filters are gone, and regression coverage was added.                                                                         |
| F-06    | Implemented by `a062705`: shell messages are picked at the locale root, leaf route layouts provide scoped namespaces, and the auth subtree has its own provider.                                                              |
| F-07    | Implemented in this optimization batch: ten Convex-backed files run in a dedicated `edge-runtime` project; Node filesystem/process tests remain in their original projects.                                                   |
| F-08    | Implemented in this optimization batch: the locale boundary has translated recovery UI and redacted observability; `global-error.tsx` owns a bilingual provider-independent fallback.                                         |
| F-09    | Partly implemented by `ab7ca49`: enforceable baseline headers, a report-only policy, and unit/E2E checks exist. Clerk-specific directives and an actual CSP reporting endpoint remain integration-time work.                  |
| F-10    | Implemented in this optimization batch: a stable `useReportWebVitals` callback records redacted metrics through `ObservabilityPort`; no vendor adapter was introduced.                                                        |
| F-11    | Implemented for representative populated desktop and handheld routes in this optimization batch, in both light and dark schemes. Expanding the assertion to every route remains optional coverage work.                       |
| F-13    | Implemented for the ten packages named in the finding by `ab7ca49`: that ahead-of-use dependency set was removed. Newly added UI/tooling packages require their own classification rather than inheriting the old conclusion. |

The detailed sections below retain their snapshot evidence because it explains the
defect and acceptance criteria. Treat the status table—not the historical priority
label—as the scheduling source for the current branch.

---

## 2. Verified stack inventory

Versions read from [`package.json`](../package.json) (all exact — `save-exact=true`
in [`.npmrc`](../.npmrc), decision D-29). "Used" is determined by grepping for
actual import statements in `src/`, `convex/`, `tests/`, and `scripts/`, not by
declaration.

### 2.1 Runtime dependencies

| Package               | Version | Imported in repository? | Evidence                                                                                 |
| --------------------- | ------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `next`                | 16.2.12 | Yes                     | `next.config.ts`, all of `src/app/**`                                                    |
| `react` / `react-dom` | 19.2.8  | Yes                     | every component under `src/`                                                             |
| `convex`              | 1.43.0  | Yes                     | `convex/**`, `src/lib/convex/**`, `src/components/providers/ConvexClientProvider.tsx:24` |
| `next-intl`           | 4.13.4  | Yes                     | `src/i18n/*.ts`, `src/proxy.ts:26`, `src/app/[locale]/layout.tsx`                        |
| `@clerk/backend`      | 3.15.0  | Yes (webhooks only)     | `convex/lib/clerkWebhook.ts:1` (`verifyWebhook`)                                         |
| `@clerk/nextjs`       | 7.6.4   | **No**                  | referenced only in prose comments (`src/app/[locale]/(auth)/sign-in/page.tsx:15`)        |
| `@clerk/react`        | 6.12.10 | **No**                  | no import anywhere                                                                       |
| `svix`                | 1.99.1  | Tests only              | `tests/integration/clerk-webhook-handler.integration.test.ts:4`                          |
| `react-hook-form`     | 7.84.0  | **No**                  | forms are hand-rolled: `src/components/masterData/EntityForm.tsx`                        |
| `@hookform/resolvers` | 5.7.1   | **No**                  | —                                                                                        |
| `zod`                 | 4.4.3   | **No**                  | validation is `convex/values` (`v.*`) server-side                                        |
| `uploadthing`         | 7.7.4   | **No**                  | —                                                                                        |
| `@uploadthing/react`  | 7.3.3   | **No**                  | —                                                                                        |
| `exceljs`             | 4.4.0   | **No**                  | export is CSV via `convex/model/reporting/csv.ts`                                        |
| `papaparse`           | 5.5.4   | **No**                  | explicitly rejected for import parsing: `convex/model/inbound/poImport.ts:20`            |
| `pdf-lib`             | 1.17.1  | **No**                  | explicitly noted unused: `convex/labels/print.ts:13`                                     |

The unimported set is documented as deliberate in [`README.md`](../README.md)
(lines 499–503: "installed ahead of the slices that need them, and still
unimported"). It is not an oversight; see finding **F-13** for the narrow cost that
remains.

### 2.2 Development dependencies

| Package                                                         | Version                          | Used? | Evidence                                                                                                     |
| --------------------------------------------------------------- | -------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------ |
| `typescript`                                                    | 6.0.3                            | Yes   | `tsconfig.json` — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` |
| `eslint`                                                        | 9.39.5                           | Yes   | `eslint.config.mjs` (flat config)                                                                            |
| `eslint-config-next`                                            | 16.2.12                          | Yes   | `eslint.config.mjs:1`                                                                                        |
| `typescript-eslint`                                             | 8.65.0                           | Yes   | `eslint.config.mjs:3`                                                                                        |
| `prettier` + `prettier-plugin-tailwindcss`                      | 3.9.6 / 0.8.1                    | Yes   | `.prettierrc.json`                                                                                           |
| `tailwindcss` + `@tailwindcss/postcss`                          | 4.3.3                            | Yes   | `postcss.config.mjs`, `src/app/globals.css:1` (`@import "tailwindcss"`)                                      |
| `vitest`                                                        | 4.1.10                           | Yes   | `vitest.config.mts` — five projects                                                                          |
| `vite`                                                          | 8.2.0                            | Yes   | `resolve.tsconfigPaths` in `vitest.config.mts:8`                                                             |
| `@vitejs/plugin-react`                                          | 6.0.5                            | Yes   | `vitest.config.mts` (unit, a11y tiers)                                                                       |
| `convex-test`                                                   | 0.0.54                           | Yes   | 10+ files under `tests/integration/`                                                                         |
| `fast-check`                                                    | 4.9.0                            | Yes   | `tests/properties/**` (property tier)                                                                        |
| `jest-axe` + `axe-core`                                         | 11.0.0 / 4.12.1                  | Yes   | `vitest.setup.ts:6`, `src/**/*.a11y.test.tsx`                                                                |
| `@testing-library/react` + `/dom` + `/user-event` + `/jest-dom` | 16.3.2 / 10.4.1 / 14.6.1 / 7.0.0 | Yes   | `vitest.setup.ts`                                                                                            |
| `@playwright/test`                                              | 1.62.1                           | Yes   | `playwright.config.ts`, `tests/e2e/**`                                                                       |
| `jsdom`                                                         | 30.0.1                           | Yes   | unit + a11y tiers                                                                                            |

### 2.3 Toolchain and platform facts

| Fact                      | Value                                                                                                                                                                                             | Evidence                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Package manager           | pnpm 10.33.2, exact pins, `engine-strict=true`                                                                                                                                                    | `package.json` `packageManager`, `.npmrc`       |
| Node                      | 22 (`^22.13.0`)                                                                                                                                                                                   | `.nvmrc`, `package.json` `engines`              |
| Router                    | App Router, locale-segment root, no `src/app/layout.tsx`                                                                                                                                          | `src/app/[locale]/layout.tsx` header comment    |
| Proxy                     | `src/proxy.ts`, locale negotiation only, **no authorization**                                                                                                                                     | `src/proxy.ts` header                           |
| Next config surface       | `reactStrictMode`, `poweredByHeader: false`, optional `distDir`, `typescript.ignoreBuildErrors: false`, `next-intl` plugin                                                                        | `next.config.ts`                                |
| Convex deployment         | none — no `convex/auth.config.ts`, no `convex/crons.ts`, no `convex/convex.config.ts`, `convex/_generated/` is gitignored                                                                         | directory listing; `README.md`                  |
| Public Convex functions   | 76 registrations through `queryWithOrg` / `mutationWithOrg` / `actionWithOrg`                                                                                                                     | grep of `convex/*/*.ts`                         |
| Return validators         | 80 `returns:` declarations                                                                                                                                                                        | grep of `convex/**` excluding `_generated`      |
| Client components         | 52 files carrying `"use client"`                                                                                                                                                                  | grep of `src/**`                                |
| Route conventions present | `not-found.tsx` only — no `error.tsx`, `global-error.tsx`, or `loading.tsx`                                                                                                                       | `src/app/[locale]/` listing                     |
| CI                        | `.github/workflows/quality.yml` (static analysis, five Vitest tiers as a matrix, production build) and `e2e.yml`; all actions SHA-pinned; `permissions: contents: read` at workflow and job level | workflow files                                  |
| Message catalogues        | `messages/th.json` 66,532 bytes, `messages/en.json` 34,567 bytes, both statically imported                                                                                                        | `src/i18n/messages.ts:17-18`, `ls -l messages/` |

---

## 3. How to read the findings

Each finding carries: repository evidence, first-party basis, the concrete change,
expected impact, effort and risk, and a measurable validation method. Priorities:

- **P0** — blocks a stated next step, or is wrong today in a way that will produce
  incorrect behaviour when the next slice lands.
- **P1** — a correctness or performance defect that is live now, or a documented
  vendor practice this repository deviates from without recording why.
- **P2** — a real optimization or hardening opportunity with a clear first-party
  basis, worth scheduling but not urgent.
- **P3** — hygiene; low impact, low cost.

---

## 4. What this repository already does correctly

Recorded so these are not proposed as "improvements" later. Each is a documented
vendor practice this repository already satisfies.

| Practice                                                      | First-party basis                                                                                                                                                                                               | Evidence here                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Never `.filter()` on a database query; use `withIndex`        | [Convex best practices](https://docs.convex.dev/understanding/best-practices/) — "Avoid `.filter` on database queries"                                                                                          | No `ctx.db` `.filter()` exists. Every read is `withIndex(...)` + bounded `.take()` — `convex/lib/authorizationLookupsConvex.ts:135-290`, `convex/lib/tenantContextLookups.ts:132-213`, `convex/lib/tenantStorage.ts:485-492`. The type in `convex/lib/tenantDb.ts` makes a scan inexpressible (`convex/lib/tenantContext.ts:269`). |
| Only `.collect()` with small, bounded results                 | [Convex best practices](https://docs.convex.dev/understanding/best-practices/) — "Only use `.collect` with a small number of results"                                                                           | No `.collect()` exists in production Convex code at all.                                                                                                                                                                                                                                                                           |
| Argument validators on all public functions                   | [Convex best practices](https://docs.convex.dev/understanding/best-practices/) — "Use argument validators for all public functions"                                                                             | 85 `args:` declarations across `convex/*/*.ts`; no `v.any()` anywhere.                                                                                                                                                                                                                                                             |
| Return validators                                             | [Convex best practices](https://docs.convex.dev/understanding/best-practices/)                                                                                                                                  | 80 `returns:` declarations; the wrapper composes them into the outcome envelope at `convex/lib/tenantFunctions.ts:367-379`.                                                                                                                                                                                                        |
| Access control on every public function                       | [Convex best practices](https://docs.convex.dev/understanding/best-practices/) — "Use some form of access control for all public functions"                                                                     | `convex/lib/tenantFunctions.ts` requires a code-owned `permissionCode` literal on every registration; `scripts/verify-tenant-boundary.mjs` fails the build otherwise.                                                                                                                                                              |
| Business logic in helper functions, thin wrappers             | [Convex best practices](https://docs.convex.dev/understanding/best-practices/) — "Use helper functions to write shared code", naming `convex/model`                                                             | `convex/model/**` is 30+ pure modules with no Convex imports; the boundary is a build gate (`convex/model/README.md`).                                                                                                                                                                                                             |
| Include the table name in `ctx.db` calls                      | [Convex best practices](https://docs.convex.dev/understanding/best-practices/) — "Always include the table name when calling `ctx.db` functions"                                                                | `convex/lib/tenantStorage.ts:456` (`db.get(name, documentId)`), `:690`, `:734`, `:751`, `:758`.                                                                                                                                                                                                                                    |
| Index ranges stepped through in order                         | [Convex indexes](https://docs.convex.dev/database/reading-data/indexes/) — "You must step through fields in index order"                                                                                        | Every tenant index begins with `orgId` via `byOrg(...)` in `convex/schema.ts`; the equality prefix is checked before the query is built (`convex/lib/tenantStorage.ts:474`, `checkedTerms`).                                                                                                                                       |
| Do not rely on Proxy/Middleware for authorization             | [Next.js `proxy` reference](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) — "Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone" | `src/proxy.ts` header states this explicitly and performs locale negotiation only; enforcement is in Convex.                                                                                                                                                                                                                       |
| `middleware.ts` renamed to `proxy.ts` for Next.js 16          | [Next.js `proxy` reference](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) — "`v16.0.0` Middleware is deprecated and renamed to Proxy"                                                       | `src/proxy.ts` exists; no `middleware.ts`.                                                                                                                                                                                                                                                                                         |
| Static rendering preserved with `next-intl`                   | [`next-intl` server/client components](https://next-intl.dev/docs/environments/server-client-components)                                                                                                        | `generateStaticParams` in `src/app/[locale]/layout.tsx:29`; `setRequestLocale` in that layout (`:73`) and in every page (e.g. `src/app/[locale]/(desktop)/inventory/history/page.tsx:19`). Confirmed by the prerendered `.html` files under `.next-e2e/server/app/th/`.                                                            |
| `<html lang>` carries the resolved locale from the first byte | [WCAG 2.2 SC 3.1.1 Language of Page](https://www.w3.org/TR/WCAG22/#language-of-page)                                                                                                                            | `src/app/[locale]/layout.tsx:76` — `<html lang={locale}>`, with the header comment explaining why there is no root layout above it.                                                                                                                                                                                                |
| Pinch-zoom not disabled                                       | [WCAG 2.2 SC 1.4.4 Resize Text](https://www.w3.org/TR/WCAG22/#resize-text)                                                                                                                                      | `src/app/[locale]/layout.tsx:36-38` — no `maximumScale`, no `userScalable: false`, with the reason stated.                                                                                                                                                                                                                         |
| CSV quoting, CRLF, and BOM                                    | [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180) §2                                                                                                                                                           | `convex/model/reporting/csv.ts:29` (`CSV_LINE_ENDING = "\r\n"`), `:32` (`CSV_BOM`), `:44` (`csvField` doubles quotes); formula-injection prefixing beyond the RFC.                                                                                                                                                                 |
| Byte-accurate size accounting for Thai                        | UTF-8 (`TextEncoder`)                                                                                                                                                                                           | `convex/model/reporting/csv.ts:82` — `utf8Bytes`, with the three-bytes-per-Thai-character rationale.                                                                                                                                                                                                                               |
| Bounded, resumable maintenance jobs; one page per execution   | [Convex limits](https://docs.convex.dev/production/state/limits) — 32,000 documents scanned, 16 MiB read, 1s user code per query/mutation                                                                       | `convex/inventory/jobs.ts` header and `MAX_JOB_PAGE_SIZE`; `convex/reporting/rollups.ts:57` (`MAX_VERIFY_ROWS`).                                                                                                                                                                                                                   |
| One `.paginate()` per function execution respected            | Enforced by [`convex-test`](https://github.com/get-convex/convex-test) — `node_modules/convex-test/dist/index.js:951`: "Only a single paginated query (`.paginate()`) is allowed per function execution."       | `convex/lib/tenantStorage.ts:497` probes with `take(limit + 1)` and spends the single `paginate()` at `:509` only when a continuation is genuinely needed.                                                                                                                                                                         |
| Supply-chain discipline in CI                                 | [GitHub Actions secure use reference](https://docs.github.com/en/actions/reference/security/secure-use) — pin actions to a full-length commit SHA; least-privilege `GITHUB_TOKEN`                               | Every `uses:` in `.github/workflows/*.yml` is a full SHA with a tag comment; `permissions: contents: read` at workflow and job scope; `persist-credentials: false` on checkout; `pnpm install --frozen-lockfile`.                                                                                                                  |

---

## 5. Prioritized findings

### P0 — prerequisites and things that will be wrong on first contact with Clerk

---

#### F-01 · The active-organization claim is pinned to a deprecated Clerk session-token claim

**Priority:** P0 · **Category:** multi-tenant security, Clerk integration

**Repository evidence.**
`convex/lib/tenantContext.ts:134` declares:

```ts
export const ACTIVE_ORGANIZATION_CLAIM = "org_id";
```

and `convex/lib/tenantContext.ts:518` reads it as `identity[ACTIVE_ORGANIZATION_CLAIM]`,
denying with `ACTIVE_ORGANIZATION_MISSING` / `CLAIM_ABSENT` when it is absent and
`ACTIVE_ORGANIZATION_MALFORMED` / `CLAIM_NOT_A_STRING` when it is not a string. This
is the only route by which a request acquires a tenant — `INV-0001-02` forbids the
caller supplying `orgId` — so if the claim does not arrive under this name and as a
string, **every** tenant-bound function in the deployment denies.

The file's own comment at `:125-133` already flags this: "The _literal_ is not
pinned by an accepted document… This constant is therefore the one place that must
be reconciled with the template the identity slice configures."

**First-party basis.**
Clerk's [session tokens](https://clerk.com/docs/guides/sessions/session-tokens)
reference documents two claim versions. Version 1 carried `org_id`,
`org_role`, `org_slug`, and `org_permissions` as separate top-level claims; **version
1 was deprecated on 14 April 2025**. Version 2 replaces them with a single compact
`o` object containing `id`, `slg`, `rol`, `per`, and `fpm` — so the active
organization is at `o.id`, not `org_id`.

Convex's [authentication in functions](https://docs.convex.dev/auth/functions-auth)
reference states that `getUserIdentity()` guarantees only `tokenIdentifier`,
`subject`, and `issuer`; everything else "depend[s] on your identity provider and
JWT configuration", and for custom JWTs nested fields surface at dot-containing key
names such as `identity["properties.email"]`.

**Concrete change.** Two workable options; pick one and write it down in
[`docs/integration-contracts/clerk-identity.md`](./integration-contracts/clerk-identity.md).

- **Option A (recommended) — map a flat claim into the Clerk session claims.** The
  current first-class Clerk integration maps `aud=convex` into the ordinary session
  token; additional claims can be configured under Clerk's session claims. Add an
  explicit `org_id` claim there and leave `ACTIVE_ORGANIZATION_CLAIM` alone. This
  keeps `tenantContext.ts` a pure kernel over a flat string claim. A custom `convex`
  JWT template is a fallback supported by the pinned Convex client, not a mandatory
  part of the current integration.
- **Option B — consume the observed v2 representation.** Use an authenticated smoke
  test to establish whether Convex exposes Clerk's `o.id` as a nested object, a
  dot-containing identity key, or another mapped form; then change the kernel to
  that exact shape. Preserve the existing length and shape checks
  (`MAX_EXTERNAL_REFERENCE_LENGTH`, `referenceProblem`) rather than assuming that
  decoding a structurally valid JWT makes the custom claim trustworthy.

Whichever is chosen, add an assertion to
`tests/integration/tenant-context-resolution.integration.test.ts` that fixes the
claim path against a recorded example token payload, so a session-claim
configuration change that silently drops the claim fails a test rather than the
production login.

**Expected impact.** Prevents a total, tenant-wide denial outage at the moment the
first Clerk instance is connected — the failure mode is fail-closed (correct) but
indistinguishable from "nothing works".

**Effort / risk.** Option A: ~1 hour, near-zero code risk, but adds a
configuration item that must appear in [`docs/environments.md`](./environments.md).
Option B: half a day including the nested-read guards; risk is that the guard
rewrite loosens the malformed-claim checks — the existing denial-cause enum makes
this testable.

**Validation.** First, a `convex-test` kernel case using `t.withIdentity({...})`
with the chosen shape and malformed alternatives. Second, an authenticated smoke
test against a configured Clerk and Convex instance must inspect the actual
`getUserIdentity()` shape and resolve a tenant-bound query. `t.withIdentity` is the
documented unit-test mechanism, but it injects the claimed shape and therefore
cannot prove that Clerk and Convex emit it in production
([Convex testing](https://docs.convex.dev/testing/convex-test)).

**Uncertainty.** Which custom fields surface through `getUserIdentity()` depends on
the configured session claims and provider mapping. That is exactly why the real
integration shape must be pinned by a smoke test rather than inferred from a sample
token or reproduced only with `t.withIdentity`.

---

#### F-02 · `convex/auth.config.ts` and `ConvexProviderWithClerk` are the mandatory next wiring

**Priority:** P0 · **Category:** Clerk auth integration

**Repository evidence.** There is no `convex/auth.config.ts` (directory listing).
`src/components/providers/ConvexClientProvider.tsx:24,41` uses the plain
`ConvexProvider` and its header states "No `setAuth` call appears here… Until
`@clerk/nextjs` is configured, the honest state is an unauthenticated client whose
every tenant call is denied by the server." `@clerk/nextjs` (7.6.4) and
`@clerk/react` (6.12.10) are installed but never imported.

**First-party basis.** [Convex + Clerk](https://docs.convex.dev/auth/clerk) documents
the required pieces:

- `convex/auth.config.ts` exporting `{ providers: [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN, applicationID: "convex" }] }`;
- `CLERK_JWT_ISSUER_DOMAIN` set as a **Convex** environment variable, plus
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` for Next.js;
- `<ClerkProvider>` outside and `<ConvexProviderWithClerk client={convex} useAuth={useAuth}>`
  inside, with `useAuth` imported from `@clerk/nextjs`;
- and the App Router caveat that `ConvexProviderWithClerk` must live in a Client
  Component wrapper consumed by the Server Component layout.

Clerk's current
[Convex integration guide](https://clerk.com/docs/guides/development/integrations/databases/convex)
documents that activating the integration maps `aud=convex` into the session token
and that additional claims are configured separately. The pinned
`ConvexProviderWithClerk` source follows that path when the session claim `aud`
equals `convex` and requests a custom `convex` template only as a fallback.

**Concrete change.** Add `convex/auth.config.ts`; change
`ConvexClientProvider` to render `ConvexProviderWithClerk` when
`environment.identityConfigured` is true, keeping the existing unconfigured branch
untouched so `resolveAppEnvironment`'s `BACKEND_MISSING` / setup-gate behaviour and
the E2E "unconfigured" project (`playwright.config.ts`, `UNCONFIGURED_ENV`) keep
working unchanged. `.env.example` already names every variable required
(`CLERK_JWT_ISSUER_DOMAIN`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`),
so no `.env.example` key change is needed.

**Expected impact.** Unblocks every tenant read. This is the item
[`README.md`](../README.md) itself names first under "What comes next".

**Effort / risk.** Half a day of code; the risk is primarily operational (a Clerk
instance, activated Convex integration/session claims, and a Convex environment
variable), not architectural. A custom JWT template is optional rather than a
prerequisite.

**Validation.** The existing setup-gate E2E specs
(`tests/e2e/setup-gate.e2e.spec.ts`) must stay green with the unconfigured
environment, proving the new branch is additive; a new authenticated smoke path
proves the configured branch. The definitive check is a `queryWithOrg` returning
`ok: true` for a seeded organization.

---

#### F-03 · The proxy must compose Clerk and locale routing and cover future API routes

**Priority:** P0 (latent — bites when F-02 lands) · **Category:** Clerk integration, routing

**Repository evidence.** `src/proxy.ts:34`:

```ts
matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"];
```

`api` is excluded, and any path containing a dot is excluded (deliberately, so
`/manifest.webmanifest` and `/icons/mark.svg` are not locale-prefixed — a good
reason, documented in the file). The current expression already matches
`/__clerk/x`; adding that route as a separate matcher would be redundant for the
present expression.

**First-party basis.** Clerk's
[`clerkMiddleware`](https://clerk.com/docs/reference/nextjs/clerk-middleware)
reference states that for Next.js 16 the file is `proxy.ts` ("If you're using
Next.js ≤15, name your file `middleware.ts` instead of `proxy.ts`. The code itself
remains the same; only the filename changes"), and gives a matcher that includes
`/(api|trpc)(.*)` and `/__clerk/(.*)` alongside the static-asset exclusion. It also
documents the composition pattern for `next-intl`:

```ts
export default clerkMiddleware(async (auth, req) => {
  return intlMiddleware(req);
});
```

**Concrete change.** When `clerkMiddleware` is introduced, compose it with the
existing `next-intl` middleware and add Clerk's `/(api|trpc)(.*)` matcher if the
application introduces protected Next.js API or tRPC routes. Keeping Clerk's
explicit `/__clerk/(.*)` entry is harmless and aligns the configuration with its
reference example, but it does not change current coverage. Keep locale negotiation
inside the page-route branch so API and Clerk-internal traffic is not locale
prefixed, and preserve the static-asset exclusions that protect the manifest and
icons.

**Expected impact.** Ensures future API routes receive Clerk middleware and prevents
locale negotiation from being applied to API or Clerk-internal traffic. The current
matcher does not by itself imply a `/__clerk` handshake failure.

**Effort / risk.** ~1 hour. Risk: a wider matcher runs locale negotiation on paths
that should not be locale-prefixed — guard it by keeping the `next-intl` call inside
a path check, and by extending `tests/e2e/locale-routing.e2e.spec.ts`.

**Validation.** The exact pinned Next.js 16.2.12 package exports
`unstable_doesMiddlewareMatch` from `next/experimental/testing/server`, even though
newer documentation uses proxy terminology. Use that installed API to assert cases
for `/th/dashboard`, `/manifest.webmanifest`, `/api/x`, and `/__clerk/x`, plus an
E2E assertion that page routes are locale-negotiated while API and Clerk-internal
routes are not
([Next.js `proxy` reference](https://nextjs.org/docs/app/api-reference/file-conventions/proxy),
"Unit testing (experimental)").

---

### P1 — live correctness and performance issues

---

#### F-04 · Two catalogue reads filter after pagination, producing short and empty pages

**Priority:** P1 · **Category:** Convex query/index/pagination

**Repository evidence.**
`convex/masterData/catalogue.ts:538-546` (lots):

```ts
const page = await readPage<LotDocument>(
  ctx.tenantDb,
  "lots",
  "by_orgId_itemId_lotCode",
  [{ field: "itemId", value: args.itemId }],
  request.value,
);

const rows = page.items.filter(
  (lot) => args.status === undefined || lot.status === args.status,
);
```

and `convex/masterData/catalogue.ts:936-950` (item barcodes), the same shape against
`by_orgId_itemId_barcode`. The `nextCursor` / `complete` fields returned to the
client come from `page`, which was computed **before** the filter.

The schema confirms no index can serve the filtered range:
`convex/schema.ts:734-735` declares only `by_orgId_itemId_lotCode` and
`by_orgId_itemId_expirationDate` on `lots`; `convex/schema.ts:844-845` declares only
`by_orgId_barcode` and `by_orgId_itemId_barcode` on `itemBarcodes`. Neither carries
`status`.

The consequence is observable from the client: `src/lib/convex/pagination.ts`
advances a cursor stack per page, so an operator filtering by `status` on an item
with many `INACTIVE` lots sees a page of, say, 2 rows with "next" still enabled — or
an empty page that is not the end of the list.

**First-party basis.**
[Convex paginated queries](https://docs.convex.dev/database/pagination) warns
directly: _"page sizes in Convex may change! If you request a page of 10 items and
then one item is removed, this page may 'shrink' to only have 9 items."_ Applying
`.filter()` to the returned `page` array is permitted, but it compounds that
instability rather than fixing it.
[Convex indexes](https://docs.convex.dev/database/reading-data/indexes/) is the
remedy: _"For performance, define index ranges that are as specific as possible! If
you are querying a large table and you're unable to add any equality conditions with
`.eq`, you should consider defining a new index."_

**Concrete change.** Push `status` into the index so the range, not the page,
does the filtering:

- `lots`: add `.index("by_orgId_itemId_status_lotCode", byOrg("itemId", "status", "lotCode"))`.
- `itemBarcodes`: add `.index("by_orgId_itemId_status_barcode", byOrg("itemId", "status", "barcode"))`.

Then select the index by whether `args.status` is present, and register both in
`convex/lib/tenantIndexPolicy.ts` so `describeTenantIndex` allows them. Drop the
post-page `.filter()` entirely. Where `status` is absent, keep the existing index.

Budget check: Convex allows **32 indexes per table and 16 fields per index**
([Convex limits](https://docs.convex.dev/production/state/limits)); `lots` and
`itemBarcodes` currently have two each, so there is ample headroom.

Note the deliberate non-recommendation: do **not** add `by_orgId_itemId_status`
as a separate index alongside the composite — Convex's best practices call out
redundant prefixes ("Check for redundant indexes… `by_foo` when `by_foo_and_bar`
exists").

**Expected impact.** Pages become full and `complete` becomes truthful. Rows read
per request drop from "everything in the item's lot range up to the page cap" to
"exactly the requested page of matching rows", which also reduces the
documents-scanned figure counted against the 32,000-document transaction limit.

**Effort / risk.** ~2 hours per table. Risk: an index addition triggers a backfill
on first deploy ("the first deploy that defines an index is a bit slower than
normal" — Convex indexes doc), which is irrelevant pre-launch. Behavioural risk is
low and covered by existing tests.

**Validation.** Extend
`tests/integration/master-data-catalogue.integration.test.ts` with a `convex-test`
case: seed an item with (page size + 5) `INACTIVE` lots followed by 3 `ACTIVE` lots,
request `status: "ACTIVE"` with the default page size, and assert the first page
returns 3 rows with `complete: true`. Today that assertion fails; after the change
it passes. Choose `lotCode` and barcode values that place all inactive rows before
the active rows in index order; insertion order does not define the page and would
make the regression test unreliable.

---

#### F-05 · Time-bounded authorization reads `Date.now()` on the query path

**Priority:** P1 · **Category:** Convex data modelling, authorization correctness

**Repository evidence.**
`convex/lib/tenantFunctions.ts:286` uses `Date.now()` while minting a UUIDv7 request
ID, and `runTenantFunction` calls that path for queries as well as mutations.
`authorizeTenantRequest` separately reads the clock to evaluate time-bounded
authorization. Downstream, `src/features/inventory/useLedgerReadSli.ts:37-41`
de-duplicates SLI events using the returned request ID, so the repository also needs
an explicit contract for what that ID means on a cached, reactive query path.

**First-party basis.**
[Convex best practices](https://docs.convex.dev/understanding/best-practices/) says
not to use `Date.now()` in queries because the passage of time does not trigger
automatic reruns and because time-dependent results cause avoidable cache
invalidation. Convex's
[query runtime documentation](https://docs.convex.dev/functions/query-functions#caching-reactivity-consistency)
also states that queries are deterministic and that the runtime implements
`Date.now()` and randomness without violating that constraint. The documented
problems are reactive staleness and cache churn, not backend nondeterminism.

Two concerns therefore need to be separated:

1. **Time-bounded authorization is reactive only when stored data changes.** An
   `effectiveTo` boundary can pass while a subscription is open without causing a
   rerun. No current `queryWithOrg` declaration requires `STEP_UP`, so the step-up
   example is latent; the live instance of the same design is membership and
   permission validity evaluated against `effectiveFrom` / `effectiveTo` on every
   query.
2. **Query request-ID semantics are unproven.** Public documentation does not say
   whether a subscriber should interpret this application-level ID as a caller
   request, a cached evaluation, or a reactive result version. The current SLI use
   should be measured before it is changed rather than inferred from the clock rule.

**Concrete change.** First, add a focused integration experiment that records IDs
across identical callers, a cached read, and a reactive rerun, then document the
observed request-ID contract. Only if that result conflicts with the SLI meaning
should `useLedgerReadSli` move to a client-minted read identity.

For authorization expiry, model validity as stored state that changes at the
boundary. A one-shot `ctx.scheduler.runAt` / `runAfter` mutation can close the state
and cause subscribed queries to rerun; it does not require `convex/crons.ts`, which
is for recurring schedules. A coarse, rounded client-supplied time argument is the
documented alternative where exact boundary enforcement is unnecessary. Apply the
same design to step-up windows if a query permission begins requiring them.

**Expected impact.** Membership and permission validity that changes reactively at
its boundary, plus an evidence-based request-ID and SLI contract instead of an
assumption about Convex cache delivery.

**Effort / risk.** Request-ID experiment and documentation: a few hours. Stored
authorization expiry: at least a day because every write path that creates or
extends a validity window must schedule or update its closure. Keep this work with
the authorization slice rather than treating it as an isolated optimization.

**Validation.** A `convex-test` case with `vi.useFakeTimers()` plus
`t.finishInProgressScheduledFunctions()` should assert that a subscribed query flips
from allowed to denied when membership or permission validity closes. Keep a
separate assertion for future step-up-protected queries. Validate the request-ID
contract independently with the focused experiment described above.

**Uncertainty.** The public documentation establishes deterministic execution and
the time-invalidation warning, but not the caller-level meaning of this repository's
returned request ID. Measure that behavior rather than presenting an inference as a
fact.

---

#### F-06 · The entire message catalogue is serialized into every route

**Priority:** P1 · **Category:** next-intl, bundling, operational performance

**Repository evidence — measured, not inferred.**
`src/i18n/messages.ts:17-18` statically imports both catalogues.
`src/app/[locale]/layout.tsx:78` renders `<NextIntlClientProvider>` with **no**
`messages` prop, which means it inherits the full catalogue configured in
`src/i18n/request.ts:30` (`messages: messagesFor(locale)`).

The result was directly observable in the build captured for the research snapshot. The Thai
string at `messages/th.json:501` — the _quality inspection_ screen's description,
`"คิวใบตรวจของคลังสินค้าที่เลือก และการตัดสินผล"` — is present in
`.next-e2e/server/app/th/dashboard.html`, a route that renders no quality content.

Sizes, measured with `wc -c` and `ls -l`:

| Artifact                                 | Bytes  |
| ---------------------------------------- | ------ |
| `messages/th.json`                       | 66,532 |
| `messages/en.json`                       | 34,567 |
| `.next-e2e/server/app/th/dashboard.html` | 93,849 |
| `.next-e2e/server/app/th/sign-in.html`   | 79,372 |

The raw Thai catalogue was 71% of the byte count of the prerendered dashboard in
that snapshot. This ratio is context, not attribution: source whitespace can be
removed and escaping can add bytes, so only a before/after build delta establishes
the catalogue's actual contribution to HTML and RSC payload.

**First-party basis.**
[`next-intl` — server and client components](https://next-intl.dev/docs/environments/server-client-components)
documents that providing all messages to the client is the default and the easiest
start, and ranks the remedies: (1) translate in Server Components and pass finished
strings as props — the most efficient; (3) wrap subtrees in
`NextIntlClientProvider` with a picked subset, using `pick` over `useMessages()`.
The same page notes that passing all messages "can contribute to the total blocking
time" and advises "Always measure before you optimize" — which is why the numbers
above were measured first.

**Concrete change.** Do not change `src/i18n/request.ts` (server-side translation
should keep the full catalogue). Instead, scope what crosses the client boundary:

1. Keep the locale/time-zone context at `src/app/[locale]/layout.tsx`, but opt out of
   catalogue inheritance there with `messages={null}`. In Server Component layouts
   or pages, call `getMessages()`, pick only the namespaces required by the client
   subtree, and pass that object to a nested `NextIntlClientProvider`.
2. Scope at leaf or genuinely shared-subtree granularity, not only at the existing
   `(desktop)` and `(handheld)` route groups. Dashboard and quality share the
   desktop group, so a desktop-wide provider containing `Quality` would not remove
   the quality string from dashboard HTML. Add equivalent coverage for `(auth)`:
   the sign-in route renders the client-side `SetupChecklist`, which calls
   `useTranslations("Setup")` and would otherwise lose its messages.
3. For leaf screens, prefer server translation: several panels take their strings
   through props already (`src/components/ui/PageHeader.tsx` receives `title` and
   `description` from the server page, e.g.
   `src/app/[locale]/(desktop)/inventory/history/page.tsx:24-26`). Extending that
   pattern removes namespaces from the client set rather than merely re-scoping
   them.

Keep `messages.test.ts`'s parity guarantee intact — it asserts key parity across
catalogues, not what is shipped, so it is unaffected.

**Expected impact.** A large reduction in per-route HTML and RSC payload, and
therefore in client-side JSON parse work on the handheld — but the exact figure
depends on which namespaces each leaf or shared subtree needs, so it must be
measured, not
predicted. The measurement method is in §7.

**Effort / risk.** Half a day to a day. Risk: a missing namespace becomes a runtime
`MISSING_MESSAGE` error in a client component. Mitigate by adding an E2E assertion
per route that no console error mentioning `MISSING_MESSAGE` occurred — the
preview Playwright projects already exercise every screen with real data.

**Validation.** Rebuild from the same commit before and after the change, compare
`wc -c` on `.next/server/app/th/*.html`, and assert the quality-namespace string is
_absent_ from `dashboard.html` while auth client translations still render. Because
the build
already uploads `.next/build-manifest.json` and `.next/diagnostics/` as CI artifacts
(`.github/workflows/quality.yml`), the delta is visible run over run.

---

#### F-07 · Convex-runtime tests are mixed with Node-only integration tests

**Priority:** P1 · **Category:** testing

**Repository evidence.** `vitest.config.mts:51,59,67` sets
`environment: "node"` for the `property`, `integration`, and `isolation` projects.
Some integration and isolation files exercise `convex-test`, but the same projects
also contain intentional Node tooling tests that import `node:fs`, `node:path`,
`node:child_process`, `node:os`, `node:buffer`, or `node:crypto`. The environment
boundary therefore does not align with the current directory boundary.

**First-party basis.**
[Convex testing with `convex-test`](https://docs.convex.dev/testing/convex-test)
gives the recommended Vitest configuration as `environment: "edge-runtime"`, because
it "better match[es] the Convex runtime", and documents the Vitest 4 `projects`
array as the way to combine it with `jsdom` for frontend tests — which is precisely
this repository's structure. The same page warns that the mock "doesn't have many of
the behaviors of the real Convex backend", including which "runtime built-ins [are]
available in the actual Convex runtime".

**Concrete change.** Add `@edge-runtime/vm` as a devDependency and create a
dedicated `convex-runtime` Vitest project whose include pattern names only tests
that execute application Convex functions through `convex-test`. Exclude those
files from the Node integration/isolation projects, and leave filesystem, process,
repository-guard, and pure property tests on Node. A naming convention such as
`*.convex.integration.test.ts` or a dedicated directory makes the boundary
mechanical; per-file environment annotations are an acceptable smaller first step.

**Expected impact.** Catches a class of defect that currently cannot be caught
locally or in CI: production Convex code reaching for a Node built-in that is
present under Vitest's node environment and absent in the Convex runtime. This
repository is more exposed than most because `convex/lib/tenantFunctions.ts:293`
uses `crypto.getRandomValues` and `convex/model/reporting/csv.ts:82` uses
`TextEncoder` — both are fine, but the guard does not currently exist to prove the
next one will be.

**Effort / risk.** Half a day plus one dependency because affected files must first
be classified. Convex-backed tests may fail under the stricter environment; Node
tooling tests should not be made to fail merely because they share a directory.
`@edge-runtime/vm` is a new deliberately pinned dependency and should be recorded
with the test-project contract.

**Validation.** Run the new Convex-runtime project plus the unchanged Node
integration and isolation projects. A temporary `node:fs` import in a Convex module
must fail the Convex-runtime project, while an existing filesystem/process test must
remain green in its Node project.

---

### P2 — hardening and optimization

---

#### F-08 · No `error.tsx` boundary: a server-side throw renders an untranslated default

**Priority:** P2 · **Category:** Next.js App Router, accessibility, Thai-first UX

**Repository evidence.** `src/app/[locale]/` contains `not-found.tsx` but no
`error.tsx`, no `global-error.tsx`, and no `loading.tsx` (directory listing). The
only error boundary in the application is
`src/features/inventory/LedgerErrorBoundary.tsx`, which is scoped to the specific
case that `useQuery` from `convex/react` throws when its query errors — it does not
catch a failure in a Server Component, a layout, or `generateMetadata`.

`src/app/[locale]/layout.tsx:72` calls `notFound()` for an unknown locale segment,
which is handled; a genuine throw is not.

**First-party basis.**
[Next.js error handling](https://nextjs.org/docs/app/getting-started/error-handling)
and the [`error.js` file convention](https://nextjs.org/docs/app/api-reference/file-conventions/error)
define `error.tsx` as the React error boundary for a route segment and
`global-error.tsx` as the root-layout fallback, which must render its own `<html>`
and `<body>`.

**Concrete change.** Add `src/app/[locale]/error.tsx` (a Client Component, as the
convention requires) rendering the existing `Notice` component with translated copy
and a `reset()` action, and `src/app/global-error.tsx` with a minimal
hard-coded bilingual fallback — the global boundary replaces the root layout, so it
cannot rely on `NextIntlClientProvider`. Route the caught error into the existing
`ObservabilityPort` so a crash produces a structured event rather than only a
console entry.

Consider `loading.tsx` separately and probably decline it: every data-bearing panel
in this application is a client component that renders its own explicit state
machine (`LOADING` / `READY` / `DENIED` / `BACKEND_MISSING` — see
`src/lib/convex/ledgerState.ts`), and a route-level skeleton would double up.

**Expected impact.** A Thai operator sees a Thai error screen with a recovery
action instead of Next's default English error page. This is the same class of
requirement as `INV-0010-01` (no user-facing string written in a component) and
`INV-0010-05` (locale resolved before first paint).

**Effort / risk.** ~2 hours plus message-catalogue keys in both `th.json` and
`en.json` (which `src/i18n/messages.test.ts` will enforce parity on). Very low risk.

**Validation.** A Playwright spec that navigates to a route with a deliberately
throwing test-only segment and asserts the Thai error copy and the working reset
button; plus an axe assertion on the rendered boundary.

---

#### F-09 · No response security headers or Content Security Policy

**Priority:** P2 · **Category:** multi-tenant security

**Repository evidence.** `next.config.ts` sets `poweredByHeader: false` and nothing
else — there is no `headers()` function and no CSP. `src/proxy.ts` sets no headers.
Nothing in the repository emits `Content-Security-Policy`,
`Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, or
`X-Frame-Options` / `frame-ancestors`. This is a warehouse application serving one
tenant's inventory behind an identity provider, and
`src/app/[locale]/layout.tsx:60` already reasons about its non-public nature by
setting `robots: { index: false, follow: false }`.

**First-party basis.**
[Next.js — Content Security Policy](https://nextjs.org/docs/app/guides/content-security-policy)
documents both approaches and their trade-offs explicitly:

- **Nonce-based CSP via Proxy** requires dynamic rendering — "Static optimization
  and Incremental Static Regeneration (ISR) are disabled", "Partial Prerendering
  (PPR) is incompatible with nonce-based CSP".
- **Header-based CSP via `next.config.js` `headers()`** works without nonces and
  preserves static rendering, at the cost of `'unsafe-inline'` in `script-src`.
- **Experimental SRI** (`experimental.sri.algorithm`) is offered as the way to get a
  strict CSP _and_ keep static generation, with the caveat that it is experimental
  and App Router only.

Clerk's
[CSP guidance](https://clerk.com/docs/guides/secure/best-practices/csp-headers)
documents additional origins across `script-src`, `connect-src`, `img-src`,
`worker-src`, `style-src`, and `frame-src`, including challenge/protection services,
and offers CSP handling through `clerkMiddleware` for supported SDK versions. The
pinned `@clerk/nextjs` 7.6.4 is above Clerk's documented minimum for its automatic
abuse and fraud protection domains.

**Concrete change.** First evaluate Clerk's `clerkMiddleware` CSP support against
the requirement to preserve static prerendering. If a static header policy remains
the chosen route, derive its Clerk directives from Clerk's current origin matrix;
adding only the Frontend API to `connect-src` is insufficient and can break sign-in
or bot challenges. Add the Convex HTTP and WebSocket origins, then
`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, and
`form-action 'self'`. Apply `upgrade-insecure-requests` and HSTS only in production;
HSTS may be more appropriately owned by the deployment edge. Add
`X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` independently.

Explicitly **do not** adopt the nonce approach here: it would convert every route to
dynamic rendering, which contradicts the `setRequestLocale`/`generateStaticParams`
work already done and would raise TTFB on a device on warehouse Wi-Fi.

**Expected impact.** Defence in depth against XSS and clickjacking. It does not
substitute for the server-side tenant boundary — nothing in the browser does — but
it narrows what a successful injection could reach.

**Effort / risk.** At least half a day, mostly spent validating the complete Clerk
and Convex origin set. A too-tight policy can break the Convex WebSocket, ClerkJS,
CAPTCHA/challenge frames, images, or workers, so a connected dashboard alone is not
a sufficient smoke test.

**Validation.** Add Playwright coverage for headers, a connected Convex client, and
the complete Clerk sign-in/challenge path. Start with
[`Content-Security-Policy-Report-Only`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy-Report-Only),
but configure `report-to` (or the compatible `report-uri`) and a
`Reporting-Endpoints` receiver before claiming that violations will be collected.
Browser-console assertions are a useful additional signal, not a replacement for a
reporting sink.

---

#### F-10 · Real-user performance is not measured, though the sink for it exists

**Priority:** P2 · **Category:** observability, operational performance

**Repository evidence.** `src/lib/observability/port.ts` defines a one-method
`ObservabilityPort` with `none` and `console` adapters, and explains at length why
there is no vendor adapter yet. `src/lib/observability/sli.ts` and
`src/features/inventory/useLedgerReadSli.ts` already emit one structured SLI event
per settled ledger read. What is absent is any page-level performance signal: no
import of `next/web-vitals` anywhere in `src/`. `docs/release-gates.md` is cited by
the README as tracking an open latency benchmark.

**First-party basis.**
[`useReportWebVitals`](https://nextjs.org/docs/app/api-reference/functions/use-report-web-vitals)
reports TTFB, FCP, LCP, FID, CLS, and INP, delivering a `metric` object with `name`,
`value`, `delta`, `rating` (`"good"` / `"needs-improvement"` / `"poor"`),
`navigationType`, and a per-page-load `id`. The documentation notes that because the
hook requires `'use client'`, "the most performant approach is to create a separate
component that the root layout imports. This confines the client boundary
exclusively to the `WebVitals` component" — and that the callback reference must be
stable to avoid duplicate reporting.

**Concrete change.** Add `src/components/system/WebVitals.tsx` — a client component
rendering `null` — that resolves `const observability = useObservability()` inside
the component, wraps the recording function in `useCallback(..., [observability])`,
and passes that stable callback to `useReportWebVitals`. A module-level callback
cannot call `useObservability`, because it is a React context hook. Forward each
metric as a new `ObservabilityEvent` variant and mount the component inside the
provider boundary in `src/app/[locale]/layout.tsx`. With
`NEXT_PUBLIC_OBSERVABILITY_SINK=console` the data is one JSON line per metric; the
default `none` sink avoids output but collection and the small client component
still have nonzero runtime cost.

**Expected impact.** Converts the latency gate from an assertion into a measurement,
and gives F-06 and F-11 an outcome metric rather than a proxy metric. Especially
valuable for the handheld shell, where INP on a rugged scanner is the number that
actually matters and cannot be inferred from a developer laptop.

**Effort / risk.** ~2 hours. Risk is low — `record` is documented as never-throwing
and non-blocking (`src/lib/observability/port.ts:27-30`) — but verify the provider
ordering and callback stability.

**Validation.** A unit test with a recording port asserting one event per metric
name and no duplicates across re-renders — the same technique
`src/features/inventory/LedgerPanelSli.test.tsx` already uses.

---

#### F-11 · Accessibility is asserted only in jsdom, where several checks cannot run

**Priority:** P2 · **Category:** accessibility, testing

**Repository evidence.** The `a11y` Vitest project (`vitest.config.mts:36-45`) runs
`src/**/*.a11y.test.tsx` under `environment: "jsdom"` with `jest-axe`
(`vitest.setup.ts:6`). Coverage is genuinely broad — `DesktopShell.a11y.test.tsx`,
`HandheldShell.a11y.test.tsx`, `InboundScreens.a11y.test.tsx`,
`InventoryTables.a11y.test.tsx`, `MasterDataTables.a11y.test.tsx`,
`EntityScreens.a11y.test.tsx`, `Reporting.a11y.test.tsx`, `SystemPanels.a11y.test.tsx`.
But `tests/e2e/` contains no accessibility assertion at all, and
`@axe-core/playwright` is not installed.

This matters specifically for this codebase because `src/app/globals.css:36-37`
states a contrast contract — "Every foreground below clears 4.5:1 against the
surface it is used on, in both schemes" — and the occupancy-band comment at
`globals.css:77` restates it. Colour-contrast rules require computed styles from a
real layout engine, which jsdom does not provide, so the assertion documented in the
CSS is currently unverified by any test.

**First-party basis.**
[axe-core](https://github.com/dequelabs/axe-core) is the upstream engine; its
`color-contrast` rule requires real rendering and is disabled or unreliable in
jsdom-style environments.
[`@axe-core/playwright`](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright)
is the first-party integration for Playwright.
[WCAG 2.2 SC 1.4.3 Contrast (Minimum)](https://www.w3.org/TR/WCAG22/#contrast-minimum)
is the 4.5:1 requirement the CSS cites; [SC 1.4.11 Non-text Contrast](https://www.w3.org/TR/WCAG22/#non-text-contrast)
is the 3:1 requirement for the border and focus tokens, which
`src/app/globals.css:36` also names.

**Concrete change.** Add `@axe-core/playwright` and one spec per shell that runs an
`AxeBuilder` scan against the preview-data routes in both projects
(`preview-chromium` and `preview-handheld-chromium`, already configured in
`playwright.config.ts`). Because the preview projects render real rows through real
screens, this exercises populated tables — the state where contrast and
name/role/value defects actually appear — rather than empty shells. Keep the jsdom
tier: it is fast, runs per component, and catches structural defects earlier.

Also worth asserting there: [WCAG 2.2 SC 2.5.8 Target Size (Minimum)](https://www.w3.org/TR/WCAG22/#target-size-minimum)
requires 24×24 CSS pixels; `src/components/masterData/EntityForm.tsx:28-30` documents
a 44px `min-h-touch` target for the handheld (applied at `:178` and `:265`), which
exceeds it — a real-browser
measurement would prove it holds after Tailwind's cascade rather than in the class
string.

**Expected impact.** Closes the gap between a documented contrast contract and a
verified one, in the environment the contract is about.

**Effort / risk.** ~half a day. Risk: the first run will likely surface real
findings; budget for fixes. One new devDependency.

**Validation.** `pnpm test:e2e` green with zero axe violations at the
`wcag2a`/`wcag2aa`/`wcag22aa` tags on every preview route, in both the desktop and
handheld projects.

---

#### F-12 · Rollup verification is bounded to one page and needs resumable reconciliation

**Priority:** P2 · **Category:** Convex data modelling, reporting

**Repository evidence.** `convex/reporting/rollups.ts:57` sets
`MAX_VERIFY_ROWS = MAX_JOB_PAGE_SIZE` and the surrounding comment is candid about
what that costs: "a metric whose source exceeds this is reported as unverifiable,
not as balanced", because "a Convex function execution may perform only one indexed
read that has a continuation". The repository already has a maintained
`operationsRollups` projection and write-through update paths. The older
`convex/schema.ts` header saying there is "No aggregate or counter document
anywhere" is stale and contradicts that table; ADR-0011 explicitly permits either
the Aggregate component **or maintained rollup documents**.

**First-party basis.**
The [Convex Aggregate component](https://www.convex.dev/components/aggregate)
maintains denormalized counts and sums that update incrementally rather than by
recalculation, exposing `aggregate.count(ctx)`, `aggregate.sum(ctx)`,
`aggregate.at(ctx, index)`, and `aggregate.indexOf(ctx, value)`. Its stated design
goal is "scalable updates by avoiding expensive recalculation operations" using
"incremental updates that only modify the aggregate value by the delta". Its
[authoritative upstream documentation](https://github.com/get-convex/aggregate)
describes lookups as O(log n), not constant time, and warns that an aggregate can
become inconsistent if a source mutation fails to update it.

**Concrete change.** Preserve the current maintained rollup for bounded dashboard
reads and build an independent resumable reconciliation job over the source tables.
Store an organization/warehouse/metric checkpoint, continuation cursor, accumulated
source total, and source-snapshot/version metadata; process one bounded page per
execution; schedule the next execution; and compare with `operationsRollups` only
after the source walk completes. Record the final verdict and make retries
idempotent. This is what turns the existing `BUDGET_EXHAUSTED` state into a scalable
verification rather than another maintained counter.

The Aggregate component remains an optional alternative for the dashboard
projection if its ordering/range features or write distribution justify a
migration. It does not replace independent reconciliation: comparing two
projections updated by the same write path cannot prove either one against source
data. If adopted, key it per organization, extend the tenant-boundary guard for its
tables, backfill and compare it before cutover, and measure its write behavior.

**Expected impact.** Converts "unverifiable at scale" into bounded, eventually
complete source reconciliation while keeping interactive dashboard reads bounded.
The verifier is intentionally proportional to source size across many executions;
it is not constant time.

**Effort / risk.** Multi-day, and correctly deferred until there is a deployment
and a tenant large enough to justify it. The principal design risk is defining a
stable source snapshot while writes continue; checkpoint/version semantics must be
decided before implementation.

**Validation.** Seed more than `MAX_VERIFY_ROWS`, run all scheduled reconciliation
pages, and assert a final balanced verdict; introduce source/rollup drift and assert
an unbalanced verdict; interrupt and retry a middle page and assert no double count.
Also test the selected snapshot policy under concurrent source writes. If Aggregate
is evaluated separately, measure write throughput and exercise its documented
backfill/repair path before cutover.

---

#### F-13 · Ten declared dependencies are never imported

**Priority:** P3 · **Category:** dependency hygiene

**Repository evidence.** `@clerk/nextjs`, `@clerk/react`, `react-hook-form`,
`@hookform/resolvers`, `zod`, `uploadthing`, `@uploadthing/react`, `exceljs`,
`papaparse`, and `pdf-lib` have zero import statements across `src/`, `convex/`,
`tests/`, and `scripts/` (see §2.1). [`README.md`](../README.md) lines 499–503
documents this as deliberate.

**Impact, stated accurately.** Because nothing imports them, **none of these
reaches a bundle** — this is not a client-payload problem and should not be
described as one. The real costs are narrower: `pnpm install --frozen-lockfile` time
on every CI job across two workflows and a five-way test matrix; a Dependabot
surface (`.github/dependabot.yml`) that produces PRs for code that does not exist;
and ten packages of supply-chain exposure at install time — `pdf-lib` 1.17.1 and
`exceljs` 4.4.0 in particular are large and infrequently released.

**Concrete change.** Either (a) leave as-is and treat the README paragraph as the
record — a defensible choice given D-29's deliberate-pinning stance — or (b) remove
the ten and reinstate each with its slice, moving the "chosen but not yet installed"
list into the README's pinned-stack section as prose. Option (b) is the smaller
attack surface; option (a) is the smaller diff and preserves the already-vetted
version choices.

**Recommendation.** Prefer (b) for `pdf-lib`, `exceljs`, and `papaparse` — the three
largest, whose slices are furthest out — and keep the Clerk, form, and validation
packages, whose slices are next. This is a judgement call, not a defect.

**Effort / risk.** ~1 hour. Risk: reinstating later may resolve to a different
version; mitigated by recording the intended pin in the README at removal time.

**Validation.** `pnpm install --frozen-lockfile` wall-clock in CI before and after;
`pnpm lint && pnpm typecheck && pnpm test` unchanged.

---

### Considered and deliberately not recommended

These were evaluated against repository evidence and rejected for now. Recorded so
the reasoning does not have to be reconstructed.

**Cache Components (`cacheComponents: true`).**
[The flag](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents)
is available in Next.js 16 and unifies `ppr`, `useCache`, and `dynamicIO`, making
data fetching dynamic by default with `use cache` opt-in and PPR as default
behaviour. It is a poor fit _here_: every page in this application is already fully
statically prerendered (evidenced by `.next-e2e/server/app/th/*.html`) and does no
server-side data fetching at all — all tenant data arrives over the Convex WebSocket
in client components. There is nothing for `use cache` to cache and no dynamic hole
for PPR to stream. It would also constrain the CSP choice in F-09, since the same
Next.js documentation states PPR "is incompatible with nonce-based CSP". Revisit if
and when server-side Convex reads (`preloadQuery` / `fetchQuery`) are introduced.

**React Compiler (`reactCompiler: true`).**
[Supported in Next.js 16](https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler),
requires `babel-plugin-react-compiler`, and Next.js applies an SWC pre-pass so only
JSX/hook files are compiled. With 52 client components this is a plausible win, but
this repository has no measured render-cost problem: the panels are state machines
over a single `useQuery` result, and the heaviest surfaces (tables) are already
split into presentational components. Adopt it only _after_ F-10 gives real INP
numbers to compare against, and prefer `compilationMode: 'annotation'` with
`"use memo"` on specific handheld screens over a repo-wide switch — an unmeasured
build-time cost on every CI run is a poor trade for an unmeasured benefit.

**Replacing the hand-rolled cursor stack with `usePaginatedQuery`.**
[Convex's `usePaginatedQuery`](https://docs.convex.dev/database/pagination) gives
reactive, growing lists with `loadMore(n)`. `src/lib/convex/pagination.ts`
deliberately implements forward/back paging with a cursor stack instead, and the
header explains why: roughly a million ledger lines per tenant per year (B-11),
no page totals, and a supervisor who needs to step _back_. `usePaginatedQuery`'s
load-more model is additive, not bidirectional, and would also require every server
function to accept `paginationOptsValidator`'s argument shape rather than the
repository's own bounded page contract. Keep the current design; the one thing worth
importing from the Convex documentation is the page-shrink warning, which is F-04.

**`react-hook-form` + `zod` for the master-data forms.**
`src/components/masterData/EntityForm.tsx:15-26` argues that client validation stops
at "required" on purpose, because the domain rules live in `convex/model/**` and a
duplicated client copy would drift and be the copy the operator sees. That reasoning
is sound and is a stronger constraint than the ergonomic benefit of a form library.
The one place a library would genuinely help is multi-step handheld flows with
draft persistence; revisit then, not now.

**Server Actions / `useActionState` for writes.** All writes go to Convex
mutations over the client's authenticated WebSocket, not to the Next.js server.
Introducing Server Actions would put the Next.js server on the write path, which
contradicts `ADR-0001` §2's "Convex is the enforcement point" and would require a
second credential path. The Convex-native equivalent worth evaluating instead is
[`useMutation(...).withOptimisticUpdate(...)`](https://docs.convex.dev/client/react/optimistic-updates),
which updates `localStore` before the server responds and rolls back automatically —
a good fit for handheld scan-and-post on poor Wi-Fi, with the documented caveat that
optimistic updates must construct new objects rather than mutating them.

---

## 6. Remaining deployment-independent investigation

The implementation-ready quick wins have landed. One local investigation remains
before changing request-ID or SLI semantics:

| Change                                                                  | Files                                                              | Effort      | Basis                                                                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------- |
| Measure and document query request-ID behavior before changing SLI keys | focused integration experiment, tenant-function contract, SLI docs | a few hours | [Convex query behavior](https://docs.convex.dev/functions/query-functions#caching-reactivity-consistency) |

The Clerk claim, middleware, and CSP changes are intentionally absent from this
table: their unit-test scaffolding can start locally, but their acceptance criteria
require the real configured integration.

---

## 7. Measurement plan

Nothing in this document quotes a benchmark that was not measured in this working
tree. This section defines how to measure each claimed impact so the numbers come
from this repository rather than from anywhere else.

### 7.1 Payload and bundle size (F-06, and the F-13 install-time claim)

**Historical baseline, measured 2026-08-12 from the `.next-e2e/` build associated
with the research snapshot:**

| Metric                                                       | Value              |
| ------------------------------------------------------------ | ------------------ |
| `.next-e2e/server/app/th/dashboard.html`                     | 93,849 bytes       |
| `.next-e2e/server/app/th/sign-in.html`                       | 79,372 bytes       |
| `messages/th.json`                                           | 66,532 bytes       |
| `messages/en.json`                                           | 34,567 bytes       |
| Quality-namespace Thai string present in `th/dashboard.html` | yes (1 occurrence) |

These figures must not be compared with artifacts built from a later commit. The
raw catalogue-to-HTML ratio is not an attributable byte count because serialization
can remove whitespace and add escaping.

**Method.** Build the same source commit before and after the provider change and
compare `wc -c .next/server/app/th/*.html`, plus the route-size table `next build`
prints. The success criteria for F-06 are binary and do not require a size target:
the quality-namespace string must be **absent** from `th/dashboard.html` and present
in `th/quality.html`; the client-translated Setup checklist must still render on
`th/sign-in`.

CI already uploads `.next/build-manifest.json`, `.next/routes-manifest.json`,
`.next/app-path-routes-manifest.json`, and `.next/diagnostics/` as a retained
artifact on every run (`.github/workflows/quality.yml`, "Upload build manifests",
with the comment "which is what makes size regressions visible over time"). That
artifact is the run-over-run series; no new tooling is needed. If a per-module
breakdown is wanted later, `@next/bundle-analyzer` is the first-party option.

### 7.2 Real-user performance (F-10, and the outcome metric for F-06 and the React Compiler question)

Once `WebVitals` is mounted, run with `NEXT_PUBLIC_OBSERVABILITY_SINK=console` and
collect `metric.name`, `metric.value`, and `metric.rating` per route and per shell.
The metrics that matter for this product, in order:

- **INP** on the handheld shell — the scan-to-feedback interaction the product is
  actually judged on.
- **LCP** on `/th/dashboard` and `/th/inventory/history` — the two heaviest tables.
- **TTFB** — the number F-09's CSP choice protects (a nonce-based CSP would raise
  it by forcing dynamic rendering).

Report percentiles, not means, and segment by `navigationType` — the documentation
exposes `"navigate"`, `"reload"`, `"back-forward"`, and `"back-forward-cache"`, and a
BFCache restore is not comparable to a cold navigation.

### 7.3 Convex read cost (F-04)

Measure per public query, from the Convex dashboard's function metrics once a
deployment exists, and locally in `convex-test` by counting rows returned versus
rows requested. The F-04 success criterion is stated as a test rather than a number:
a page request of size _N_ against a range with at least _N_ matching rows must
return exactly _N_ rows with `complete: false`, and must never return fewer while
claiming there is more. Convex's [limits](https://docs.convex.dev/production/state/limits)
give the ceilings the reads must stay under — 32,000 documents scanned and 16 MiB
read per transaction, 1s of user code per query or mutation.

### 7.4 Test-tier integrity (F-07)

`pnpm guards` is the composite gate today (`package.json` `scripts.guards`). After
the dedicated `convex-runtime` project is added, the added signal is a negative
control: a temporary `node:`-prefixed import inside an application Convex module
must fail that project, while existing filesystem/process integration tests remain
green under Node. Record that both controls were run; a guard nobody has seen fail
is not known to work.

### 7.5 Accessibility (F-11)

Zero axe violations at `wcag2a`, `wcag2aa`, and `wcag22aa` on every preview route in
both the `preview-chromium` and `preview-handheld-chromium` projects, with populated
tables. Separately, assert the contrast contract that `src/app/globals.css:26-33`
states, in both colour schemes, since that is currently documented but unverified.

### 7.6 Security headers (F-09)

Playwright response-header assertions on `/th/dashboard`; plus a preview-project
assertion that `ConnectionIndicator` reaches its connected state under the policy,
which is the only reliable way to catch a `connect-src` that silently blocks the
Convex WebSocket. Exercise Clerk sign-in and challenge flows too. Roll out
report-only first, configure a `report-to` / `report-uri` destination and
`Reporting-Endpoints`, then inspect delivered reports before enforcing.

---

## 8. Prerequisites and sequencing

```
F-02 (auth.config.ts + ConvexProviderWithClerk)
 ├── requires: a Clerk instance and activated Convex integration
 ├── F-01 (session claim shape) must be decided and smoke-tested in the same change
 ├── F-03 (proxy composition/API coverage) must land with clerkMiddleware
 └── F-09 CSP cannot be enforced until the full Clerk flow passes under it

F-05 (stored authorization expiry) ── requires ──> scheduler design + a Convex deployment
F-12 (resumable source reconciliation) ── requires ──> snapshot/checkpoint design + deployment

Independent, can start now:
  F-05 request-ID experiment, F-12 snapshot/checkpoint design

Already implemented at or after the status checkpoint:
  F-04, F-06, F-07, F-08, F-10, F-11, F-13; F-09 baseline is partial
```

Open uncertainties, stated rather than resolved:

- **Which Clerk custom claim shape reaches `getUserIdentity()`** (F-01) cannot be
  proven without the configured integration. The mitigation is a real authenticated
  smoke test; `t.withIdentity` alone cannot establish it.
- **The size of F-06's win** depends on leaf/subtree namespace scoping. The
  measurement method is defined; the number is not predicted from raw JSON size.
- **A stable reconciliation snapshot** (F-12) needs an explicit policy for writes
  that occur while a multi-execution source walk is in progress.

---

## 9. Primary-source bibliography

Every source below is official vendor documentation, an official specification, or
an authoritative upstream source repository. No blogs, aggregators, or third-party
articles are cited.

**Convex**

- Best practices — <https://docs.convex.dev/understanding/best-practices/>
- Query caching, reactivity, consistency, and deterministic runtime —
  <https://docs.convex.dev/functions/query-functions#caching-reactivity-consistency>
- Paginated queries — <https://docs.convex.dev/database/pagination>
- Reading data: indexes — <https://docs.convex.dev/database/reading-data/indexes/>
- Platform limits — <https://docs.convex.dev/production/state/limits>
- Testing with `convex-test` — <https://docs.convex.dev/testing/convex-test>
- Authentication in functions — <https://docs.convex.dev/auth/functions-auth>
- Convex + Clerk — <https://docs.convex.dev/auth/clerk>
- Optimistic updates — <https://docs.convex.dev/client/react/optimistic-updates>
- Aggregate component — <https://www.convex.dev/components/aggregate>
- Aggregate component upstream documentation —
  <https://github.com/get-convex/aggregate>
- `convex-test` upstream source — <https://github.com/get-convex/convex-test>
  (the single-`paginate()`-per-execution rule is enforced at
  `node_modules/convex-test/dist/index.js:951` in the pinned 0.0.54)

**Next.js**

- `proxy.js` file convention (including the `middleware` → `proxy` rename and the
  "verify auth inside each Server Function" guidance) —
  <https://nextjs.org/docs/app/api-reference/file-conventions/proxy>
- `cacheComponents` — <https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents>
- `reactCompiler` — <https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler>
- Content Security Policy guide — <https://nextjs.org/docs/app/guides/content-security-policy>
- `useReportWebVitals` — <https://nextjs.org/docs/app/api-reference/functions/use-report-web-vitals>
- `error.js` file convention — <https://nextjs.org/docs/app/api-reference/file-conventions/error>
- Error handling — <https://nextjs.org/docs/app/getting-started/error-handling>

**Clerk**

- Session tokens (v1 vs v2 claims; v1 deprecated 14 April 2025) —
  <https://clerk.com/docs/guides/sessions/session-tokens>
- Clerk + Convex integration (session-token audience and additional claims) —
  <https://clerk.com/docs/guides/development/integrations/databases/convex>
- `clerkMiddleware` (Next.js 16 `proxy.ts` naming, matcher, `next-intl` composition) —
  <https://clerk.com/docs/reference/nextjs/clerk-middleware>
- Clerk CSP guidance —
  <https://clerk.com/docs/guides/secure/best-practices/csp-headers>

**next-intl**

- Server and client components (message inheritance and payload reduction) —
  <https://next-intl.dev/docs/environments/server-client-components>

**Specifications and standards**

- WCAG 2.2 — <https://www.w3.org/TR/WCAG22/>
  (SC 1.4.3 Contrast Minimum, SC 1.4.4 Resize Text, SC 1.4.11 Non-text Contrast,
  SC 2.5.8 Target Size Minimum, SC 3.1.1 Language of Page)
- RFC 4180, Common Format and MIME Type for CSV Files —
  <https://www.rfc-editor.org/rfc/rfc4180>
- MDN `Content-Security-Policy-Report-Only` reference —
  <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy-Report-Only>

**Tooling upstreams**

- axe-core — <https://github.com/dequelabs/axe-core>
- `@axe-core/playwright` — <https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright>
- GitHub Actions secure use reference —
  <https://docs.github.com/en/actions/reference/security/secure-use>
