# Topic 2 — Environment and secrets

## Environment boundary

Use a dedicated Clerk development/test instance and a dedicated Convex E2E or
preview deployment. Production keys, production organizations, and production
data are forbidden.

Preferred order:

1. Ephemeral Convex preview deployment per CI run, if the deployment workflow can
   create and retire it reliably.
2. Dedicated persistent E2E deployment with a unique run namespace and bounded
   cleanup.

The application build must receive real non-production values instead of the
empty identity/backend values deliberately used by the current credential-free
Playwright configuration.

## Secret classes

| Class                      | Example purpose                                   | Storage rule                                      |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| Public build configuration | Clerk publishable key, Convex URL                 | GitHub environment variable; still non-production |
| Service credential         | Clerk secret or supported test-session credential | GitHub environment secret                         |
| Test actor credential      | Sign-in secret or one-time-token seed             | GitHub environment secret                         |
| Deployment credential      | Create/access Convex preview deployment           | GitHub environment secret                         |

Exact variable names must be added to the environment contract and `.env.example`
in the implementation commit. The plan does not duplicate the current contract;
[`scripts/verify-environment.mjs`](../../../scripts/verify-environment.mjs) remains
the authority.

## CI environment protection

- Create a GitHub environment named `authenticated-e2e`.
- Restrict its secrets to the authenticated workflow.
- Do not expose secrets to forked pull requests.
- Run the lane automatically on trusted `main`/same-repository branches; use an
  explicit maintainer-approved trigger for untrusted PRs.
- Mask identifiers that could reveal test-user email addresses.
- Set a short timeout and cancel superseded non-main runs.

## Browserbase decision

Browserbase is optional infrastructure, not part of the correctness contract.
Playwright on the GitHub runner is the default merge-gate browser. Browserbase may
be used for a manually triggered diagnostic lane that needs a live view, retained
session, or remote browser, provided its API key is isolated in the same protected
environment.

## Exit criteria

- A clean runner builds the application with real test configuration.
- The runner can reach Clerk and Convex without production access.
- Removing any required secret fails with a named setup error before Playwright.
- Logs and artifacts contain no credential values or reusable session state.
