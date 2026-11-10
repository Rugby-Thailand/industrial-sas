# Current architecture audit: tooling and test baseline

Owner: PR1 implementation worker; reviewed against `origin/main`
`de79d7adb7f194ffe6b28cc5c29c5e6f9ff4f080`, fetched and fast-forwarded before
evaluation on 2026-11-09. The old report and logs were read from the parent
checkout's `docs/reviews/architecture-scalability-2026-11-09/` without modifying
or importing that checkout's files. They describe an older revision.

Environment: macOS arm64, 10 logical CPUs, Node 24.19.0, pnpm 10.33.2, Vitest
4.1.11. Dependencies installed with `pnpm install --frozen-lockfile`; Bun 1.4.3
(embedded TypeScript 7.0.2) installed by the repository's digest-verified
`node scripts/ci/install-bun-checker.mjs`. No parent environment files, cloud
data, deployments or new app servers were used. This is a shared machine;
other processes exist. Targeted tests use one worker; the full baseline uses
two. Static checks and the short cancellation repetitions overlapped the full
run. Timings are local evidence, not performance guarantees.

## Dispositions

| ID                                                | Current evidence and disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Change                                                                                                                                                                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 dependency versions / exception               | **Already resolved on main.** Fresh production, full app and release audits at approximately 2026-11-09 14:55 UTC have zero high/critical findings. Next and eslint-config-next are both 16.4.1; body-parser is overridden to 2.4.0, MCP SDK to 1.32.0, and affected undici chains to 7.30.1 / 8.12.2. The live exception list is empty. No expired exception was renewed.                                                                                                                    | No Node package, lockfile, override or exception change.                                                                                                                                                                                           |
| A01 audit totals                                  | **Confirmed and fixed.** The old full audit contains 15 high advisory keys but metadata.high = 16: the zod advisory has two findings. A controlled live registry request below confirms finding-count semantics. The old gate also accepted swapped high/critical metadata when their sum matched. Two new regression cases fail on the original gate.                                                                                                                                        | Count findings within each severity independently; retain malformed-report, unexcepted-advisory, exact-version/path and expiry checks.                                                                                                             |
| A12 tooling inputs                                | **Confirmed and fixed.** On fresh main, ESLint's `isPathIgnored` returns false for `.claude/worktrees/agent-fixture/src/app/page.tsx`, `tmp/bug-audit/fixture.ts` and the old review-probe paths. `lintText` reports unused-variable errors there, matching the old root-lint pollution mechanism. The new regression fails on the original config while its maintained-input control passes. The clean checkout's original `pnpm lint` itself passes because the dirty artifacts are absent. | Exclude only local scratch/nested-checkout paths and named review-probe conventions. Maintained src, Convex, tests, scripts and review capture tools remain linted, demonstrated with real lint/parser violations. No navigation-policy exclusion. |
| A13 ICU placeholder mismatch                      | **Already resolved on main.** `src/i18n/messages.test.ts` uses the installed FormatJS parser, with regression cases for plural prose, repeated arguments, nested branches and malformed syntax.                                                                                                                                                                                                                                                                                               | No additional change.                                                                                                                                                                                                                              |
| A13 catalogue budget timeout                      | **Not reproduced on current main.** The actual row-budget and continuation assertions pass. Main already gives the 1,350-row fixture a specific 30-second fixture-construction budget.                                                                                                                                                                                                                                                                                                        | No further timeout or assertion change.                                                                                                                                                                                                            |
| A13 process cancellation                          | **Not reproduced on current main.** The real child/descendant cancellation test passes, including owned-group disappearance and refusal to report success.                                                                                                                                                                                                                                                                                                                                    | No speculative production or harness change.                                                                                                                                                                                                       |
| A13 packing, task Back, scan capacity / retention | **Not reproduced in the focused current-main run.** All actual workflow assertions pass, including accepted-50/backend persistence, refusal of the 51st ticket, photo-group retention and completion ownership. The old contention symptoms alone do not establish an application defect.                                                                                                                                                                                                     | No application, navigation, test timeout or assertion change. Full-suite outcome is recorded below separately.                                                                                                                                     |

Lower-severity findings remain: production 2 moderate; full app 11 moderate
and 3 low; release 3 moderate. These are live audit counts, not a claim of
exploitability or a vulnerability-free tree. They remain visible in the normal
audit output; no severity is suppressed.

**A01 manual-generator dependency: confirmed and fixed during the final cross-check.**
GitHub's default-branch warning has 5 critical / 23 high alerts, all on the
maintained HR manual's Pillow 12.3.0 pin. `pip-audit` 2.10.1 reproduces exit 1
with 39 Pillow advisories, all naming 13.0.0 as a fix. Pin Pillow 13.0.0 and
document its Python 3.11 minimum. The same audit then exits 0 with no known
vulnerabilities. This is a separate Python dependency scope, not an npm
metadata-count contradiction. The builder imports `PIL.Image` and opens
screenshot inputs: a real tooling dependency exposure, not proof of remote
exploitability of the web app. No Node, Bun or TypeScript runtime pin changes.
[Pillow's 13.0.0 release notes](https://pillow.readthedocs.io/en/stable/releasenotes/13.0.0.html)
list the fixes and Python requirement; the generator uses RGB images and avoids
the removed APIs. GitHub's alerts remain on the default branch until merge and
reevaluation; none were dismissed. No frozen guide assets change.

## Registry counting reproduction

Pinned [pnpm 10.33.2 audit source](https://github.com/pnpm/pnpm/blob/v10.33.2/lockfile/audit/src/index.ts)
returns the registry's quick-audit JSON directly. Its CLI filters the advisory
inventory by `--audit-level` without recomputing metadata. The gate therefore
reconciles only high/critical counts, both of which remain in its inventory.

The following credential-free request was run against the same public endpoint
before changing validation. It submits a synthetic dependency tree, without
installing or executing the vulnerable packages:

```sh
node --input-type=module <<'JS'
const leaf = (version) => ({ version, dev: false });
for (const nestedVersion of [null, "3.25.76", "4.4.3"]) {
  const dependencies = { zod: leaf("4.4.3") };
  if (nestedVersion) dependencies.example = {
    version: "1.0.0",
    requires: { zod: nestedVersion },
    dependencies: { zod: leaf(nestedVersion) },
  };
  const response = await fetch(
    "https://registry.npmjs.org/-/npm/v1/security/audits/quick",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dependencies, dev: false, metadata: {}, install: [], remove: [],
        requires: Object.fromEntries(Object.entries(dependencies)
          .map(([name, dependency]) => [name, dependency.version])),
      }),
    },
  );
  if (!response.ok) throw new Error(`registry status ${response.status}`);
  const report = await response.json();
  console.log(nestedVersion, report.metadata.vulnerabilities,
    Object.values(report.advisories).map(({ github_advisory_id, findings }) =>
      ({ github_advisory_id, findings })));
}
JS
```

All three requests returned HTTP 200 and one advisory key,
`GHSA-mrhx-c7xc-m3w5`. The single-location tree reports high = 1 and one
finding. Both two-location trees report high = 2 and two findings (paths `zod`
and `example>zod`), including the repeated-version tree. This explains the old
15-key / 16-finding discrepancy without relaxing the integrity check.

Offline regression command:
`pnpm exec vitest run tests/integration/dependency-exceptions.integration.test.ts --maxWorkers=1`.
Before the fix: 2 failed / 4 passed. After the fix: all 6 pass; changed versions
and unexcepted findings still fail the gate. Live audits for both scopes pass.

## Verification

- `pnpm exec vitest run src/i18n/messages.test.ts tests/integration/catalogue-search-budget.integration.test.ts tests/integration/prepare-browser-suite.integration.test.ts src/features/finishedGoods/FinishedGoodsTaskBack.test.tsx src/features/finishedGoods/PackingScreen.test.tsx src/features/finishedGoods/jobScan/JobScanScreen.capacity.test.tsx src/features/finishedGoods/jobScan/JobScanScreen.retention.test.tsx --maxWorkers=1`: **7 files / 100 tests passed**, 62.66 seconds, before implementation.
- `pnpm exec vitest run tests/integration/lint-inputs.integration.test.ts --maxWorkers=1`: before config fix **1 failed / 1 passed**; after fix **2 passed**.
- Combined dependency/lint regressions: **2 files / 8 tests passed**, 2.19 seconds.
- `pnpm exec vitest run tests/integration/prepare-browser-suite.integration.test.ts --maxWorkers=1 -t 'native cancellation synchronously kills only owned children and descendants and cannot report success'`: **10 consecutive runs passed**, targeting the previously reported process-cancellation case; all eight file cases also pass in the initial focused run.
- `pnpm audit:prod`: **passed**, zero high/critical, 2 moderate reported.
- `node scripts/ci/audit-dependencies.mjs --scope=app` and `--scope=release`: **both passed**, before and after the gate fix.
- `pnpm lint`: **passed**, zero warnings, both before and after the config change.
- `pnpm format:check`: **passed** for the repository.
- `PATH="$PWD/.cache/bun-checker/bun-v1.4.3-bun-darwin-aarch64:$PATH" pnpm typecheck`: **passed**, digest-verified Bun 1.4.3 / embedded TypeScript 7.0.2, route generation and 1,210 files checked.
- `pnpm typecheck:ts6`: **passed**, route generation and TypeScript 6.0.3.
- `pnpm ci:test-discovery`: **passed**, 468 Vitest files and 29 Playwright specs. The new test was staged before this tracked-file check; the earlier unstaged run correctly rejected it as collected but untracked.
- `pnpm check:navigation`: **passed**, 68 fixtures and the production gate (60 route/error policies, 314 exact state/overlay owners, 26 navigation intents). No navigation source or inventory changed.
- `git diff --check`: **passed**.
- `pnpm exec vitest run --maxWorkers=2`: **468 files / 5,814 tests passed**, no skips, exit 0; 1,048.45 seconds (17 minutes 28 seconds). All maintained Vitest projects ran. Output also contains a nonfatal jsdom document-navigation diagnostic and Node DEP0129 warning; neither was suppressed.

- Python follow-up after the JavaScript baseline: isolated CPython 3.12.13 venv; `uv pip install --python /tmp/pr1-manual-venv/bin/python -r docs/manuals/hr-user-guide-th/requirements.txt` installs all five resolved packages successfully with Pillow 13.0.0. `uvx --from pip-audit==2.10.1 pip-audit -r docs/manuals/hr-user-guide-th/requirements.txt --format json`: **no known vulnerabilities**, exit 0 (before: 39 Pillow advisories, exit 1).
- Existing `build.py` and `verify.py` both succeed before/after the Pillow update in a temporary copy at `/tmp/pr1-manual-smoke/docs/manuals/hr-user-guide-th/`, retaining repository-relative paths. Both verifier runs report **20 pages / all integrity checks PASS / zero duplicate instruction sentences**. Poppler renders all 20 before/after pages at 800px; pixel comparison finds **zero changed pages**, and the final contact sheet was visually inspected. Generated artifacts remain outside the checkout.

The only dependency update is the standalone manual generator; no runtime application
code changed. Browser workflows and remote CI are not yet verified by this
document. The parent owns final review and merge. Structural findings and
non-baseline A12 work belong to the parallel structural remediation.
