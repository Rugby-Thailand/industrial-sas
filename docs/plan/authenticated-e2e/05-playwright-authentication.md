# Topic 5 — Playwright authentication

## Preserve the existing suite

The current [`playwright.config.ts`](../../../playwright.config.ts) and
[`scripts/run-e2e.mjs`](../../../scripts/run-e2e.mjs) intentionally clear Clerk and
Convex configuration. Keep that credential-free contract for route, localization,
and header checks.

Add a separate authenticated runner and configuration path rather than making
`pnpm test:e2e` require vendor accounts.

## Proposed files

| File                                          | Responsibility                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `scripts/run-authenticated-e2e.mjs`           | Validate environment, build with real test configuration, start the app, run only the authenticated project |
| `tests/e2e/auth.setup.ts`                     | Obtain a supported Clerk test session and save Playwright storage state                                     |
| `tests/e2e/fixtures/authenticatedTest.ts`     | Extend Playwright with run namespace and authenticated page fixtures                                        |
| `tests/e2e/.auth/operator.json`               | Generated ignored storage state; never committed or uploaded                                                |
| `tests/e2e/authenticated-inbound.e2e.spec.ts` | Business journey and observable assertions                                                                  |

Before implementation, confirm the currently supported Clerk Playwright testing
method from official documentation. Prefer the provider's test-session helper over
typing long-lived credentials into the UI. The setup must still prove that the
application receives and accepts a real Clerk session.

## Project model

```text
authenticated-setup
  → desktop-authenticated-chromium
```

The authenticated project depends on setup and loads the generated storage state.
Run one worker initially because the first scenario owns a single tenant workflow.
Parallelism may be enabled only after run namespaces and fixture isolation are
proven.

## Selector policy

1. Prefer `getByRole` with Thai accessible names.
2. Use `getByLabel` for forms.
3. Use visible business identifiers generated from the run namespace.
4. Add a `data-testid` only for state that has no stable user-facing semantic
   selector.
5. Never select by generated Convex document IDs or brittle CSS structure.

## Authentication assertions

- The private route does not redirect to `/sign-in`.
- The context bar shows the expected organization and warehouse.
- The relevant action controls are present for the least-privilege actor.
- Browser requests use the real configured Convex URL.
- Session state files are deleted in runner cleanup and excluded from artifacts.
