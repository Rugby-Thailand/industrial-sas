# Topic 8 — Security and rollout

## Non-negotiable safety constraints

1. The runner refuses any Clerk or Convex host classified as production.
2. Test identities contain no real personal data and have no production
   membership.
3. The actor has least privilege for the first slice.
4. No unauthenticated seed, reset, cleanup, or tenant-switch endpoint is added.
5. Session state and credentials are generated outside tracked files and removed
   after the run.
6. Logs, screenshots, traces, and server diagnostics are treated as potentially
   sensitive and retained for a bounded period.
7. Fixture code cannot accept arbitrary organization IDs from an untrusted CI
   input.
8. Browserbase, if enabled for diagnostics, uses a dedicated test context and may
   not persist cookies beyond the diagnostic retention window.

## Rollout phases

| Phase                    | Outcome                                                              | Merge-gate status    |
| ------------------------ | -------------------------------------------------------------------- | -------------------- |
| A — environment spike    | Sign in and resolve the correct tenant/warehouse from a clean runner | Manual only          |
| B — fixture spike        | Provision deterministic prerequisites without a public bypass        | Manual only          |
| C — local vertical slice | Full ordinary inbound scenario passes locally                        | Advisory             |
| D — trusted CI           | Ten consecutive clean runs with useful diagnostics                   | Advisory             |
| E — required check       | Lane blocks trusted merges and `main`                                | Required             |
| F — second slice         | Add distinct-actor QC maker-checker journey                          | Separate plan/change |

## Required implementation changes

- Add the authenticated runner, Playwright setup/project, fixtures, scenario, and
  page helpers described by Topics 4–6.
- Add the protected CI workflow and extend workflow/environment guards.
- Update `.gitignore` for generated auth state.
- Update `.env.example` with names only and documentation, never values.
- Update the README command table and development setup guide.
- Update the specification coverage and release-gate register only when evidence
  actually exists.

## Acceptance record

When Phase E completes, record:

- Date, commit, workflow run, and non-production environment class.
- Actor role and permission list.
- Scenario/run namespace and exact final balance.
- Trace of the expected receipt and putaway ledger facts.
- Ten-run stability evidence and runtime distribution.
- Known exclusions, especially QC, hardware, offline, load, and production pilot.

The record proves wiring in a non-production deployment. It does not close
hardware, load, legal, restore, or pilot-site release gates.
