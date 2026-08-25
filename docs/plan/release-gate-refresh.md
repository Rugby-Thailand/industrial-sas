# Release-gate evidence refresh plan

Status: **Proposed — register audit not yet performed**
Updated: 2026-08-22
Owner: Engineering lead; external evidence remains owned by the role named on each gate

## 1. Outcome

Make [`docs/release-gates.md`](../release-gates.md) a trustworthy statement of
current evidence without converting local code success into a deployment, pilot,
hardware, legal, or operational claim.

This plan changes evidence descriptions and gate statuses only where an artefact
already proves the required condition. It does not relax a gate, rewrite its ID,
or manufacture evidence.

## 2. Why this work is needed

The register has visible drift:

- Its narrative says 72 gates are registered, while the tables contain 74 unique
  gate IDs.
- `RG-053` says the production dependency audit is absent, although the current
  quality workflow runs it.
- `RG-054` and `RG-055` still describe test and Playwright work as placeholders,
  although real suites now exist.
- `RG-032` and `RG-033` describe a repository with no exported feature functions
  or ledger tables, which is no longer the current codebase.
- The current-position summary predates later warehouse, order-to-ship, and
  shared-operator implementation evidence.

These examples identify the audit starting points. They do not predetermine that
the affected gates are `Satisfied`: the evidence required by each row remains the
decision rule.

## 3. Evidence hierarchy

Use evidence in this order:

| Strength | Evidence                                                | What it may prove                                          |
| -------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| 1        | Current blocking CI run on the exact commit             | Code-owned checks executed in CI                           |
| 2        | Deterministic local test/guard with committed source    | Code behavior and repository invariants                    |
| 3        | Dated acceptance, rehearsal, benchmark, or audit record | The bounded activity described by the record               |
| 4        | Current implementation plus documentation               | `In progress`, when the required final evidence is broader |
| 5        | Prose claim without an artefact                         | Nothing; keep the gate open                                |

External evidence supplied outside the repository must be recorded as a dated
artefact before it changes a gate. A chat message or assumption is not enough.

## 4. Audit method

Create a temporary working matrix with one row per gate:

| Field                  | Required content                                                     |
| ---------------------- | -------------------------------------------------------------------- |
| Gate ID                | Existing stable `RG-###` ID                                          |
| Kind                   | Code, Mixed, or External                                             |
| Required evidence      | Exact wording from the register                                      |
| Current evidence       | File, CI run, acceptance record, or `none`                           |
| Evidence date/commit   | When and against what revision it was obtained                       |
| Proposed status        | Existing status vocabulary only                                      |
| Reason                 | One sentence explaining why evidence meets or does not meet the gate |
| Cross-document updates | Coverage, ADR, README, runbook, or acceptance record                 |

Review the matrix in four passes:

1. **Integrity pass:** unique IDs, valid status vocabulary, accurate totals, valid
   links, and no gate omitted from the narrative count.
2. **Code pass:** compare code gates with package scripts, workflow jobs, tests,
   guards, generated evidence, and the exact current CI commit.
3. **Mixed pass:** separate the code half from the human/external half. Keep the
   gate open when either required half is absent, while recording the completed
   portion precisely.
4. **External pass:** confirm the artefact exists; otherwise leave `Not started`
   or `In progress` as the evidence dictates.

## 5. Evidence sources

- Merge-gate authority:
  [`ADR-0012`](../adr/0012-delivery-release-and-quality-gates.md).
- Current CI implementation: [quality workflow](../../.github/workflows/quality.yml)
  and [E2E workflow](../../.github/workflows/e2e.yml).
- Executable commands: [`package.json`](../../package.json).
- Plan-to-proof mapping: [specification coverage](../specification-coverage.md).
- Local application status and explicit exclusions: [project README](../../README.md).
- Staging identity/browser proof when implemented:
  [authenticated E2E plan](./authenticated-e2e/README.md).
- Operational procedures: [runbook index](../runbooks/README.md) and dated
  rehearsal records.
- Phase-specific records: files under `docs/reviews/` that name a commit,
  environment class, scenario, result, and unresolved external evidence.

## 6. Status decision rules

### Code gates

Use `Satisfied` only when the complete named check exists, exercises real behavior
rather than scaffolding, runs in the required lane, and has green evidence at the
current commit. A local-only check remains `In progress` when the gate requires CI
or branch protection.

### Mixed gates

Use `In progress` when code proof exists but deployment, hardware, human
acceptance, or measured evidence is missing. Describe both the completed and open
parts in the status cell.

### External gates

Never infer completion from code. A simulator cannot close a hardware gate; a
local restore cannot close a production RTO gate; translated strings cannot close
a pilot training-acceptance gate.

### Staging authenticated E2E

The first authenticated staging slice may contribute evidence to `RG-011` and
`RG-055`, plus wiring evidence for related code gates. It does not close the
pilot-hardware journey in `RG-051` or the target-device journey in `RG-074`.

## 7. Automated integrity guard

Add `scripts/verify-release-gates.mjs` only after the manual audit establishes the
correct register shape. The guard should verify facts a parser can know:

- every gate ID is unique and matches `RG-###`;
- every table status uses an allowed value;
- narrative totals equal the table totals;
- relative evidence links resolve;
- every gate has kind, owner, required evidence, and status cells;
- the coverage matrix does not reference an unknown gate ID.

Do not make the script decide whether evidence is semantically sufficient. That
judgment remains a review responsibility.

## 8. Small-commit sequence

1. Add a failing integrity test that exposes the current count/status-shape drift.
2. Correct the current-position narrative and mechanical inconsistencies.
3. Refresh code-gate evidence one phase/section at a time.
4. Refresh mixed-gate descriptions without closing missing external halves.
5. Synchronize the coverage matrix and directly affected status summaries.
6. Add the verified register guard to `pnpm guards` and the quality workflow.

Each commit must contain only evidence changes for a reviewable set of gates. Do
not combine this audit with product implementation or module refactoring.

## 9. Acceptance criteria

- The register contains 74 unique stable gate IDs unless a separately approved
  gate addition occurs.
- Summary counts are computed from and agree with table rows.
- Every changed status links to evidence that satisfies the row's requirement.
- External and pilot gates remain open without dated external artefacts.
- `pnpm verify:workflows`, the release-gate integrity guard, formatting, and
  documentation link checks pass.
- The specification coverage matrix and register do not disagree about current
  implementation evidence.
- The diff contains no application behavior change.

## 10. Project benefit

The refreshed register becomes a reliable release map: engineering knows which
code risks are actually controlled, product and platform know which external
proof they still own, and future work does not repeat completed checks or launch
on the strength of stale claims.
