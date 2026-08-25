# Topic 7 — CI and diagnostics

## Separate workflow lane

Add `.github/workflows/authenticated-e2e.yml`. Do not add secrets to the existing
credential-free workflow.

Initial triggers:

- `workflow_dispatch` for environment shakeout.
- Push to trusted same-repository feature branches while stabilizing.
- Required check on `main` and trusted pull requests only after the stability exit
  criteria are met.

Forked pull requests must never receive the protected environment's secrets.

## Job outline

```text
checkout without persisted credentials
  → pinned Node/pnpm setup
  → install Chromium
  → validate authenticated-E2E environment
  → provision/verify identity and fixture context
  → build with non-production Clerk and Convex configuration
  → run authenticated desktop project
  → upload bounded failure evidence
  → cleanup/retire run resources
```

Pin third-party actions to immutable SHAs and extend
[`scripts/verify-workflows.mjs`](../../../scripts/verify-workflows.mjs) so the new
workflow follows the existing permission and pinning policy.

## Failure artifacts

Upload on failure:

- Playwright HTML report.
- Trace for the failed attempt.
- Failure screenshots.
- Browser console errors.
- Failed request method, host, path template, and status without authorization
  headers or sensitive bodies.
- Bounded application diagnostics keyed by run namespace.

Never upload Playwright storage state, cookies, authorization headers, provider
tokens, raw Clerk webhook payloads, or unredacted environment dumps.

## Retry policy

- Start with zero retries during workflow shakeout so instability is visible.
- After five consecutive green runs, CI may use one retry solely to capture a
  trace and distinguish transient infrastructure failure.
- Any test that passes only on retry is recorded as unstable and cannot satisfy
  the rollout gate until the cause is owned.

## Stability exit criteria

- Ten consecutive trusted CI runs pass without retry.
- Median runtime and the slowest step are recorded.
- A deliberately invalid test session fails at the authentication step.
- A deliberately removed permission fails before the first protected write.
- A deliberately broken balance assertion produces useful trace and server
  evidence without exposing secrets.
