# Navigation guard correction and shared code maintenance plan

Status: implementation authorized on 13 October 2026, Asia/Bangkok, including PR creation and merge after validation. The earlier delivery was documentation only. Fix the confirmed continuation defect first, preserve the existing navigation behavior, then remove proven duplication in small, independently reviewable changes.

Plan review: Sol 6.1 behavior and standards reviewers accepted the plan; the behavior reviewer also accepted the clarified Floor save-compatibility requirement. Kiro Opus 5.5 requested six material clarifications, then accepted the revised plan after the save/intent rules, removal controls, concrete Next harness, smaller pagination scope and reuse of existing measurement scripts were incorporated. This is design acceptance, not evidence that the planned fixes have been implemented or passed their gates.

## Baseline and evidence

- Reviewed branch: `codex/navigation-audit-plan-20261013`, HEAD `abc1e8e4af67b4e6416177ff73b95f4a8800e2e5`, [PR 87](https://github.com/Rugby-Thailand/industrial-sas/pull/87), currently open.
- Freshly fetched main: `7491a2f44cd2774fca18f7ac93e5c2b5b7920a02`. The branch is zero commits behind and three ahead; no rebase is needed at plan creation. Fetch and compare again before implementation.
- The [previous navigation plan](navigation-history-follow-up-2026-10-13.md) and [delivery evidence](../reviews/navigation-follow-up-2026-10-13.md) remain authoritative for the fixes already delivered and the unresolved browser paths.
- Independent Kiro Opus 5.5 and Sol 6.1 audits found no confirmed new regression in the scoped PR. Kiro's latest focused run passed 65 tests. These results do not cover the newly identified continuation failure.
- A public-provider regression probe reproduces the same defect on both main and PR HEAD: draft A starts Save and continue; B becomes pending during that save; A settles successfully; navigation still executes while B is pending. The successful single-draft control passes. This establishes a provider-contract defect, not confirmed reachability through the current Floor screen or production data loss.

## Problem and scope

The prompt currently grants continuation from the result of an earlier save attempt without rechecking the owner's current registrations. The owner already knows about other pending work, so the correction belongs in the guard module rather than in every feature form.

There are also three concrete maintenance opportunities: duplicated media-query subscriptions, buffer identity fields that must be cleared together, and similar history-metadata mechanics in three pagination hooks. They have different risks and must not become one broad global refactor. Existing route telemetry measures route-shell commit, which cannot by itself explain a report that data takes ten seconds to appear.

The core deliverable is the continuation correction, maintained real-Next regression coverage, and a shared media-query hook. A private buffer record follows only after those behavior gates pass. A traversal-state rewrite and pagination abstraction remain conditional follow-ups. Performance diagnosis can run independently and produces a measured report before an optimization is selected.

## Decisions and contracts

1. Preserve the public draft interface, single shell owner, feature-owned saving/disposal, history metadata format, and locale/query/hash behavior. Do not add another guard context or a state-machine dependency.
2. Put the final permission to continue inside the owner, where the synchronous registration map is authoritative. React prompt summaries are presentation state and must not authorize departure.
3. A successful save does not authorize leaving other dirty or pending registrations. If work remains, retain the requested action behind the existing prompt, show the current status, and require a fresh explicit decision. Do not automatically navigate later just because the other pending work completes.
4. A save returning false or throwing preserves the draft and prompt. Preserve the real Floor callback pattern: it returns true and reports clean through React updates without explicitly settling the guard. A sole, current Floor save must still continue exactly once without another prompt. An unconditional post-save active check could mistake its delayed registration update for unsaved work; automatically settling any true result could instead clear newer work. Capture the attempt's owner, prompt and registration identity, distinguish that attempt's completion from other or newly guarded work, and revalidate before navigation executes. If fresh work in the originating registration cannot be distinguished through the current interface, use a narrow explicit settlement handoff at the feature's existing current-completion seam. Never clear newer work merely because an old save returned true.
5. Revalidate at every asynchronous continuation boundary involved in this action, including deferred buffer removal. In particular, audit action execution in the removing branches of the popstate and history-write handlers, and in the disconnected branch of buffer removal. A new registration between save completion and the actual transition must still be protected; a disconnected obsolete owner must not run it. Include a successful Discard control whose clean React report is delayed, so the correction does not re-prompt for already disposed work. Confirm these behaviors with deterministic tests before deciding how much internal change is required.
6. An approved action runs at most once and belongs to the current owner and prompt intent. Owner teardown, superseding navigation, or a newer prompt invalidates an obsolete continuation. Keep this bookkeeping private and as small as the tests require. Never synchronize history with a delay or fabricate browser events.
7. Discard remains disabled while any write is pending. Preserve its existing disposal semantics and cover it as a control; do not change all feature discard callbacks as part of the save fix.
8. Share media-query subscription mechanics with one small `useMediaQuery` interface. Retain domain wrappers, all current breakpoints, false server snapshots, client match snapshots, and container-width logic. No global listener registry or cache is needed.
9. Replace the three owned-buffer fields with one nullable private record only after behavior is protected. Preserve unknown depth as unknown. Do not merge owned and orphan entries merely because their shapes resemble each other.
10. Keep history writes, committed query observations, and navigation progress as distinct contracts. A guard-traversal flag alone cannot guarantee isolation when another listener runs first.
11. Keep HR retry identities, uncertainty classification, ownership recovery, catalogue cursor policies, and Floor draft lifecycle in their feature modules. Similar-looking code does not justify merging these policies.

## Delivery sequence and small commits

Every landed commit must leave its applicable checks passing. Reproduce the new failure before fixing it, then commit its regression and correction together; do not land a deliberately failing or skipped regression. Run focused checks per commit and the complete required checks once on the integrated change, repeating only when later changes require it.

### Phase 0 Establish a safe implementation baseline

Preserve the existing plan and worktree contents. Read applicable repository instructions and the installed Next linking/navigation and router guides again if the dependency changes. Record the implementation base and whether PR 87 is still open or has merged.

Use a separate follow-up branch/worktree when implementation starts so the delivered PR remains independently reviewable. If PR 87 has merged, branch from fresh main. If it remains open, branch from its verified HEAD and describe the dependency in a stacked PR targeting that branch; retarget and revalidate after the dependency lands. Do not silently include PR 87's commits as unrelated follow-up changes against main. The subsequent user instruction explicitly authorizes merge, including the reviewed prerequisite PR 87 after checking its current head and gates. Preserve this plan when creating the follow-up checkout.

### Phase 1 Correct Save and continue and protect the behavior

**Commit 1 — correct continuation after asynchronous save.** Move or route the final approval and current intent through the owner and add the baseline-red/current-green regression using the public provider interface. First evaluate reusing the existing ID-based settlement flow, with the saving registration's identity retained alongside its callback; preserve the stale-intent and new-work protections in decisions 4–6 rather than blindly settling any true result. Cover a successful single draft using Floor's real true-returning, React-cleanup callback pattern, a second pending registration, a second dirty registration, newly dirty work in the saving registration, failure and rejection. Include Back during an in-flight save replacing the requested action, so completion cannot clear a newer prompt and run an old React closure. Assert draft contents, visible prompt/status, actual transition count, and the absence of unintended disposal. Exercise work arriving during queued buffer removal and owner teardown; if these expose a separate defect, document it and include a focused correction rather than hiding it in refactoring.

**Commit 2 — complete continuation lifecycle controls.** Cover rapid repeated input, a superseding transition/prompt, stale completion after unmount/remount, newly guarded work before removal completes, and a later explicit decision after B settles. Keep/discard and pending-only controls must retain their existing behavior. The saving indicator must finish normally without releasing a stale action. Add production changes here only when a new case proves they are necessary.

**Commit 3 — maintain a real Next browser harness.** Use a separate, credential-free Next test application with its own fixture routes, config and build output. Import the repository's actual guard, history tracker, query hooks and locale navigation adapter, and run the installed Next router with production build/start. Configure Turbopack's root to resolve the repository sources and aliases; match the relevant React compiler, StrictMode, locale-provider and shell listener-mount settings. Document omitted auth/backend middleware and providers rather than claiming full application parity. The harness must exercise the framework's history wrapper, not a copy. Keep fixtures outside shipped application routes; never introduce a production auth bypass or expose synthetic mutation controls.

Budget an additional production build in CI with independent output and port, and verify the normal application's build contains no fixture routes. Reuse existing Playwright policy/reporting where compatible and extend the hard-coded test-discovery config list. CI currently installs Chromium only: explicitly install Firefox/WebKit in the dedicated job if their results are claimed as CI coverage, or clearly label those checks local-only. Do not infer that a separate test app inherits application configuration automatically.

**Commit 4 — add native browser regressions.** Exercise the save/pending race, deferred buffer removal and successful single-save control through real interactions and native queued history traversal. Also retain the already-fixed reload/query/first-Back and active-query-push regressions, with a clean navigation control. Use the real Floor view and HR criteria hooks in fixture scenarios. Keep exhaustive race combinations in public-provider tests; choose browser scenarios for distinct Next/history integration risks rather than multiplying every case across every engine and viewport. Record fixture results separately from authenticated application checks.

Phase 1 exit gate:

- B becoming dirty or pending during A's save never causes automatic departure or disposal. With only the current A, successful save executes the original action exactly once without an extra prompt, including Floor's actual callback pattern. New work in A must not be mistaken for the saved attempt.
- Cancelled, superseded, failed and stale saves cannot execute an obsolete action. Newly guarded work at the deferred-history boundary stays protected.
- Browser controls preserve draft values and the supported URL/query behavior; no stuck navigation progress or page errors.
- Required credential-free Chromium desktop/mobile runs pass in CI. Run Firefox and WebKit for the new shared-provider cases and report each engine's result or exact blocker. A blocker limits the claim; it is not a pass or a reason to silently skip a regression.
- Separately verify actual Floor, HR and Scan Keep/Discard and pending protection with test credentials and isolated data. A two-registration fixture is not proof that a real Floor route exposes the same race. If authentication is unavailable, retain the fixture evidence and state the app-level verification gap.

### Phase 2 Remove low-risk media-query duplication

**Commit 5 — introduce the shared media-query module and migrate all three duplicated implementations.** Keep `useIsMobile` and `useStorageLayoutMobile` as domain wrappers and replace the private workspace media implementation. Preserve the existing 1023, 580, 1099, 850 and 1399 pixel query thresholds and the workspace's separate container measurements.

Test observable SSR/hydration and resize behavior, query changes, StrictMode, and unmount. Verify removal from the same MediaQueryList used for subscription; the existing no-op cleanup mock is insufficient. The subscription identity must remain stable until the query changes. Reuse existing layout tests and check representative sidebar/catalogue and Floor layouts immediately below, at and above their applicable breakpoints; do not introduce a screenshot matrix solely for unchanged threshold constants.

Phase 2 exit gate: callers retain their public interfaces and visual behavior; three independent subscription implementations become one; there is no new global state, dependency or breakpoint change. This is a maintenance improvement, with no claimed route-latency speedup.

### Phase 3 Simplify buffer state after behavior is stable

**Commit 6 — consolidate owned-buffer identity.** Replace coordinated ID, URL and optional-index assignments with one private nullable record. Keep orphan handling, traversal branches, event ordering and the current history mechanism unchanged. Delete replaced reset logic rather than retaining a second representation.

Phase 3 exit gate: provider, history and real-Next tests pass for reload/orphan adoption, unknown depth, same-page pushes/replacements, superseding writes, pending work, StrictMode and remount. The diff is a representation change; no new navigation behavior or Forward-preservation claim is included.

**Conditional commit 7 — represent mutually exclusive traversal states.** First enumerate the currently reachable restoring/removing/idle transitions and their cancellation rules. Proceed only if a private discriminated representation removes invalid combinations without changing event ordering or adding a parallel machine. Keep this separate from the buffer-record commit. If the seam requires rewriting the history mechanism or cannot be proved by maintained tests, retain the record improvement and defer this step with the concrete reason.

### Phase 4 Evaluate shared pagination metadata

**Conditional commit 8 — extract only proven common storage mechanics.** Start with a cheap source comparison: shared metadata writes already exist, while the two HR hooks share a keyed-object format and catalogue uses a different bounded array/legacy-slot policy. The preferred outcome is a small private HR helper, or no change. Their decoders, storage formats, scope/fingerprint rules, eviction limits, pagination algorithms and legacy compatibility remain domain-owned.

Only create a shared module if its interface is smaller than the duplicated mechanics and at least two existing callers can use it without optional policy switches. Preserve unrelated history fields and test malformed/legacy values and scope changes. For a pure storage extraction, retain the existing listener registrations and reuse their behavioral controls. If an extraction changes subscription timing or event delivery, additionally establish committed-traversal semantics and test cancelled/approved Back and same-page pushes/replacements. Filtering by a flag set after an earlier subscriber runs does not solve listener ordering. Migrate only proven callers; leave catalogue independent when its contract differs.

If this needs a new navigation-event framework or behavior fix, stop the abstraction, document that separate problem and keep the existing tested hooks. This phase does not block the guard correction or media-query reuse.

### Phase 5 Measure the reported delay and select a targeted correction

**Commit 9 — extend the existing local measurement scripts and write a diagnosis report.** Reuse the current performance measure and fixture-measure scripts, which already define loaded product/map outcomes, keep numeric results and enforce loopback/test identity. Parameterize their existing three-sample loops and add the missing navigation directions and actual Scan/HR flows as needed. Use a production build, isolated local Convex data and test Clerk credentials; preserve the scripts' refusal to target production. Scanner-fixture timing stays separate from authenticated Scan navigation. Missing credentials block that measurement, not the independent guard and reuse work.

Distinguish navigation intent, URL/route-shell commit and route-specific data ready. The Sentry instrumentation is reusable code, but availability of deployed traces is unverified and its current route trace measures only shell commit. Do not add or enable production telemetry as the default fix. Close or invalidate local measurements on superseding navigation, errors and unmount; retain numeric results without raw queries, entity IDs, draft contents or personal data. If local diagnosis later establishes a need for field data, scope that collection separately using existing normalization, sampling and privacy controls, and verify any new timing category survives sanitizer/export rules.

Measure catalogue/Floor and finished-goods/Scan in both directions, plus the affected HR flow if reproduced. Separate cold/warm caches, desktop/mobile and controlled network conditions, and label local production-build evidence distinctly from deployed field evidence. Record environment, sample count, timer definitions, p50/p95 and errors; treat small samples as descriptive. Start with at least 20 completed samples per selected reproducible scenario after warm-up, recording cancellations separately. Do not run heavy builds or parallel tests during timing.

Bound the first diagnosis to one collection/review cycle. Its exit is either a reproduced delay attributed to a measured phase, or an explicit statement that the delay was not reproduced and what field evidence is still needed. Only then propose a separate targeted optimization with a same-environment before/after comparison. Do not equate code deletion, a local warm result or conditional beforeunload with solving the ten-second report.

## Collaboration and file ownership

- Kiro Opus 5.5 at high effort implements most frontend/guard work and the media-query extraction. Check model availability at implementation start. It owns the guard implementation and its existing unit-test files during that task.
- Sol 6.1 behavior reviewer independently verifies the baseline failure, acceptance criteria and transition regressions. It owns separately agreed new regression files and the browser harness/CI integration; agree the exact file list before parallel edits.
- Sol 6.1 standards reviewer checks the resulting diff for unnecessary interfaces, duplicate state, policy mixing, cleanup correctness and documented repository standards. Reviewers do not rewrite implementation-owned files concurrently.
- Codex integrates commits, handles the branch/rebase decision, coordinates browser verification, checks scope and resolves disagreements using reproductions. Agree ownership again before changing phases; overlapping files are edited sequentially.
- After implementation, run independent Kiro and Sol reviews of the final integrated diff. The implementer review complements the independent Sol review; it does not replace it.

## Validation and delivery

Reuse existing provider/history/Floor/HR/Scan tests as behavioral controls. Test through public hooks and rendered interactions, with deterministic deferred saves; avoid assertions tied only to private flag names. Temporary audit probes must become maintained repository-relative tests and must not be required by CI from a local temporary directory.

Run the repository's required formatting, pinned type checker, lint, unit/accessibility tests, production build, browser smoke and workspace checks. Run generated-code, dependency, workflow and test-discovery checks as required by the repository workflows and by touched files. Recheck discoveries when adding a test project or CI job. Record actual results and blocked coverage for the final commit, rather than reusing old passing counts as evidence for new code.

Recommended review units are: (A) guard fix plus real-Next regressions, (B) media-query reuse, (C) buffer representation after A, and separate conditional pagination/performance changes. Each should have a small rollback surface; revert the affected implementation and its matching tests together if needed. Do not bundle a history-mechanism replacement into a maintenance PR.

The subsequent user instruction authorizes implementation, PR creation and merge after the acceptance gates and independent review pass. Delivery must include clear PR descriptions stating changed behavior, checks, dependencies and unresolved browser paths. The original plan-only stop no longer applies; merge authorization does not waive validation or expand the explicitly deferred browser scope.

## Deferred work and limits

- Existing Forward-branch truncation and broad multi-entry/Back-menu behavior remain unresolved under the previous bounded feasibility decision. Revisit only in a separately scoped browser experiment; neither a state record nor a shared hook corrects them.
- A URL-changing Next replacement that drops legacy guard metadata, and tracker/guard mount ordering, need concrete reachability and behavior evidence before additional production changes.
- HR successor ownership and retained manual setters retain their previous conditional status. Preserve uncertain retries and server-error classification; do not unify generic and HR mutation policies.
- No backend schema changes, global mutable data cache, speculative prefetch/cache policy, production test endpoint, dependency upgrade or generic mutation framework is included.
