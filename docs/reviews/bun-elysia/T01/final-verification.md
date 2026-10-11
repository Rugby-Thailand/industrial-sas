# T01 final local verification

The final Kiro Opus 5.5 high refactor completed with exit 0. Both independent Codex standards/specification audits found no remaining concrete defect. Exact source/configuration hashes are in [audited-source-hashes.json](audited-source-hashes.json). The candidate remains pending independent timing, committed discovery/clean-tree verification, Linux protected CI and merge/release verification.

[Final gate records](final-gates/results.json) capture subprocess exit status directly; [raw output](final-gates/) is portable. Commands ran serially, with no timing comparisons active:

- Fresh `pnpm install --frozen-lockfile`: 880 packages reused, zero downloaded; warm store. Prior node_modules preserved under ignored `.cache/T01-pre-final-node_modules/`.
- Checksum-verified checker installation; `pnpm check`: formatting, Bun check, lint and 249 files / 2,980 tests passed.
- `pnpm typecheck:ts6` passed.
- Production `pnpm build` passed with minimal environment and Bun absent from PATH. A deliberate source type error caused build exit 1 / Failed to type check. The guard was removed in finally, and the restored build passed.
- `pnpm audit:prod`, guarded application/release dependency audits, independently locked release install, workflow pins/actionlint, Convex codegen and 8 release/CI contract files / 184 tests passed.

No dependency lock, Next runtime/bundler, test runner or deployment controller changes. Scope stays T01. Historical timing results remain provisional; no application/provider/build/CI performance claim.

Rollback: revert the T01 delivery commit, or restore the previous default checker and CI install/order step while retaining the valid fixture corrections. Preserve existing release-controller safeguards. No remote change has been performed for T01.

Portable terminal logs normalize carriage returns and trailing whitespace for Git delivery; exact original logs remain in the sibling preserved bundle. [Normalization hashes](log-normalization.json) record original and delivered bytes. JSON measurements are unchanged.

## Independent comparison

The [independent report](independent-comparison/reviewer-report.md) accepts correctness and local timing on committed candidate `f7d197dc886c3e79f79bb656b91613ded761cace`. All 90 timed processes exited zero in matched forward/reversed order; both checker manifests select 775 project inputs; all 4,237 input fingerprints and 1,291 non-benchmark tracked files match before/after. Whole-command medians: TS6 full 16.199550s, primed cache 4.116207s, Bun 2.043833s. Every paired comparison favored Bun; edited-file cases passed with no regression. Raw distributions, commands and captured foreground exit are delivered under [independent-comparison/](independent-comparison/). The complete identical before/after map is compressed once, with exact-byte hashes in its receipt. Workstation load was uncontrolled (3.3–14.76); no application/provider/build/CI speedup is claimed.

After this evidence-only ledger integration, the coordinator will freeze the final PR commit, repeat mandatory gates and the independent affected comparison on that exact head, and capture final approval externally before PR creation. No further candidate edit is planned. PR, merge and release metadata will be recorded externally and carried into both repository ledgers by the next dependent task after release verification.

Committed `pnpm ci:test-discovery` and `pnpm ci:clean-tree` passed on `f7d197d`; final fixture-specific run passed 2 files / 25 tests. These captured gate receipts remain in the sibling preserved bundle until final-head verification is complete.
