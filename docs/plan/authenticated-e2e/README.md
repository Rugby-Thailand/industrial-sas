# Authenticated E2E vertical-slice plan

Status: **Proposed — no authenticated browser lane exists yet**
Updated: 2026-08-22
Owner: Engineering lead

## Outcome

Prove that real identity, tenant resolution, permission enforcement, browser UI,
Convex writes, inventory accounting, and read projections work together in one
deployed non-production environment.

The first scenario is one ordinary inbound journey:

```text
Clerk sign-in
  → active organization and warehouse
  → create supplier purchase order and line
  → open receipt and post received quantity
  → build a handling unit
  → claim and confirm putaway
  → verify inventory balance and transaction history
```

The test uses real application routes and public tenant-bound functions. Existing
unit, property, integration, isolation, accessibility, and credential-free browser
tests remain responsible for permutations and negative cases.

## Topic files and implementation order

| Order | Topic                                                                | Decision owned by the file                                |
| ----- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| 1     | [Outcome and scope](./01-outcome-and-scope.md)                       | What the first slice proves and deliberately omits        |
| 2     | [Environment and secrets](./02-environment-and-secrets.md)           | Where it runs and how credentials are isolated            |
| 3     | [Identity and tenant fixtures](./03-identity-and-tenant-fixtures.md) | Test actors, membership, warehouse, and permissions       |
| 4     | [Domain data fixtures](./04-domain-data-fixtures.md)                 | Synthetic master data, run namespace, setup, and teardown |
| 5     | [Playwright authentication](./05-playwright-authentication.md)       | Auth setup, storage state, projects, and file boundaries  |
| 6     | [Inbound scenario](./06-inbound-scenario.md)                         | Exact browser steps and assertions                        |
| 7     | [CI and diagnostics](./07-ci-and-diagnostics.md)                     | Workflow lane, artifacts, retries, and failure evidence   |
| 8     | [Security and rollout](./08-security-and-rollout.md)                 | Safety constraints, acceptance gates, and staged adoption |

## Cross-cutting rules

- Never point the suite at production.
- Never commit credentials, cookies, tokens, or real personal/customer data.
- Do not add an unauthenticated fixture or cleanup endpoint.
- Preserve the current credential-free `pnpm test:e2e` contract.
- Prefer role and accessible-name selectors; add `data-testid` only when the UI
  has no stable semantic selector.
- A retry may collect evidence; it must not redefine a consistently failing run
  as healthy.
- Browserbase may host an interactive or remote diagnostic run, but it is not a
  dependency of the merge gate.

## Proposed repository shape

```text
tests/e2e/
  auth.setup.ts
  authenticated-inbound.e2e.spec.ts
  fixtures/
    authenticatedTest.ts
    inboundRun.ts
  pages/
    purchasingPage.ts
    receivingPage.ts
    putawayPage.ts
    inventoryPage.ts
scripts/
  run-authenticated-e2e.mjs
.github/workflows/
  authenticated-e2e.yml
```

Each file owns one concern. Page objects are introduced only for behavior shared
by setup and the scenario; they must not hide business assertions.
