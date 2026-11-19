# Customers v1 — implementation evidence

**Baseline:** `c30b1c5f` (origin/main when work started). **Branch:** `feat/customers-v1`. Run locally on macOS (Apple Silicon), Node 24, pnpm 10.

## Gates

| Check                                              | Baseline `c30b1c5f`                                                                       | This branch                                                                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:navigation`                            | pass: 60 route/error policies, 308 state owners, 26 action intents                        | pass: 64 / 315 / 29 (4 routes, 7 states, 3 actions added)                                                                 |
| `pnpm typecheck`, `pnpm typecheck:ts6`             | pass                                                                                      | pass                                                                                                                      |
| `pnpm lint`, `pnpm format:check`                   | pass                                                                                      | pass                                                                                                                      |
| `pnpm ci:codegen`                                  | pass                                                                                      | pass (generated API matches)                                                                                              |
| Full `vitest run`, all projects, one local process | 5,867 passed, **28 failed** (load timeouts; CI on this commit failed only `image-quotas`) | see the PR for the final-commit run; the first branch commit ran 5,963 passed, 1 failed (`hr-roster-paging`, fixed below) |

The one branch-only failure was a snapshot that embeds generated document IDs. Seeding two more permissions shifts later IDs by six. The fixture changes only `departmentId` `…10090` → `…10096`, and every other value of the snapshot still matches.

## Acceptance (plan § Acceptance)

| #   | Criterion                                           | Evidence                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Thai name-only save < 10 s at 390px                 | Real app, real Convex functions, real Clerk session (`tests/e2e/hr-local/customers.spec.ts`), at a 390×844 viewport. Click to rendered detail heading: **373–893 ms** in mobile Chromium and **2,393 ms** in desktop Chromium (5,958 ms on a cold first page). Reload shows the same record, and `getCustomer` confirms it. |
| 2   | English-only name gets no Thai spelling             | `customers.integration.test.ts`: the stored name is unchanged and `legalNameTh` is absent.                                                                                                                                                                                                                                  |
| 3   | Bad checksum warns, still saves; leading zeros kept | UI test "warns on a failed tax ID check digit…" plus the integration checksum and leading-zero cases. The detail page also flags it.                                                                                                                                                                                        |
| 4   | Same-name customers both save; match shown first    | Integration duplicate-name case. UI: the live hint, and "checks for a likely duplicate when Save is pressed before the hint appears". Different forms send different request IDs.                                                                                                                                           |
| 5   | Archive hides from default list; direct link opens  | Integration archive, list and direct `getCustomer` cases. UI archive confirmation consumes its Back entry.                                                                                                                                                                                                                  |
| 6   | Codes unique incl. archived; other orgs denied      | Integration uniqueness, cross-org read (`null`) and cross-org write (`NOT_FOUND`) cases.                                                                                                                                                                                                                                    |
| 7   | Back after a failed edit on a phone keeps the draft | Real app at 390px: a conflicting save, then browser Back, shows "Discard changes?", stays on the edit URL, and Keep editing returns the draft. The jsdom caller test covers the same.                                                                                                                                       |

## Measurements

| Measure                                                                             |                                                 Before |                                                                          After | Note                                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | -----------------------------------------------------: | -----------------------------------------------------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sparse search, 19 matches in 100 rows, page size 20: query calls to settle one page |                                                     81 |                                                                              5 | `paginatedOrderedScan` reads one bounded chunk per call and carries surplus matches                                                                                   |
| Same: retained-ID point reads                                                       |                                                  1,520 |                                                                             19 |                                                                                                                                                                       |
| List row fields sent                                                                | full record (tax ID, contact, notes up to 2,000 chars) |                                     `customerId, code, name, status, province` | detail keeps the full record                                                                                                                                          |
| Master-data message payload on **storage-layout** pages                             |                              55,032 B en / 99,879 B th |                                                                      unchanged | Customers copy lives in its own route scope. If it shared the master-data scope it would add 4,943 B en / 8,957 B th to every storage page (1,336 / 1,619 B gzipped). |
| Customer route message payload                                                      |                                                    n/a | 7,223 B en / 13,497 B th (App, Workspace, Customers, Pagination, Panel, Table) | smaller than the master-data scope it would otherwise inherit                                                                                                         |
| Workspace grant feed (`workspace/current:readCurrent`)                              |                         n codes × active roles lookups |             +2 exact lookups per active role that holds neither customer grant | stops at the first role that grants; a seeded admin pays at most +2                                                                                                   |
| New org seeding                                                                     |                                     baseline catalogue |                              +2 permission rows, +2 grants on the seeded admin | existing orgs: explicit upgrade (see [rollout.md](../rollout.md))                                                                                                     |

No existing query or mutation reads the customers table. Job scans and products are untouched in v1.

## UI evidence

The real React components render in a Vite harness with mocked Convex responses (a local, untracked `output/customer-preview`): Thai and English, light and dark, 1280px and 390px. No screen overflows horizontally, and no screen logs a console error. Screenshots are in [implementation/](implementation/).

## Reproduce

```sh
pnpm exec vitest run src/features/customers                         # caller and Back tests
pnpm exec vitest run --project integration --maxWorkers 2 --testTimeout 20000 \
  customers.integration permissions.integration hr-workflows ai-usage hr-roster-paging
pnpm check:navigation
pnpm test:e2e:hr:local tests/e2e/hr-local/customers.spec.ts         # needs the private .env.local described in tests/e2e/hr-local/README.md
```

The local real-browser runner twice stopped before any test started, because its web server did not come up. Retrying passed both times. The tests themselves never failed for this reason.
