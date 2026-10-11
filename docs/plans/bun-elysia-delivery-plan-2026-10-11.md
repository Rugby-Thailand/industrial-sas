# Bun and Elysia delivery plan — October 11, 2026

Status: Phase 1 delivery. T00 and T01 are DONE: [PR #70](https://github.com/Rugby-Thailand/industrial-sas/pull/70) merged as `77ae110` and [PR #71](https://github.com/Rugby-Thailand/industrial-sas/pull/71) merged as `4c3db2e`, each automatically released. T02 remains in final local verification; T03 is awaiting initial independent audits.

## Outcome and authorization

Adopt Bun as the default wherever this repository preserves compatibility and correctness: dependency installation, script execution, standalone type checking, compatible test suites, Next development/build/start, CI, release tooling and supported deployment runtimes. Use Elysia for typed AI and integration HTTP endpoints, retain Clerk identity and organization authentication, and retain Convex's authorization, durable state and hosted runtime.

This follows “Adoption target and compatibility” beginning at line 27 of docs/plans/bun-migration-research-2026-10-11.md. A large speedup is not required for every command. Consistent tooling is a valid benefit after compatibility is demonstrated. Record each retained Node/pnpm/Vitest path with a concrete blocker, evidence and a revisit condition; continue the remaining compatible migration work.

The user authorized this task workflow:

1. Kiro Claude Opus 5.5 implements.
2. Codex independently audits and fixes.
3. Kiro Claude Opus 5.5 refactors.
4. Codex verifies the final changes, creates the PR, waits for required checks and merges.
5. Verify the merged commit and the repository's automatic release before beginning the next dependent task.

This file plans those actions. Existing local experiments are inputs, not already approved/merged deliveries. Future execution uses the authorization above without repeatedly asking permission for routine commits, PRs or merges. A failed automated gate remains a failed gate; fix it rather than bypassing it.

### Phase order

The user authorized two phases, executed in order:

1. **Phase 1 — this plan (T00–T20):** Bun adoption and Elysia AI/integration contracts.
2. **Phase 2 — [performance next steps](performance-next-steps-2026-10-11.md):** loading, navigation and interaction work under that plan's evidence-before-PR rules.

Phase 2 begins after Phase 1 closes (T20). It starts from a new frozen reference: a merged **and released** `main` SHA that contains the delivered Phase 1 Bun/Elysia changes and the integrated HR/Search work (PR #67, `1deda8f`, first released through `ca8c296`). Phase 2 must re-run its baseline on that SHA. The detached `9ac5da0` measurements remain historical evidence; they do not approve newer combined code. Phase 1 supersedes only that plan's “defer Elysia” clause; its other deferrals stand.

## Workspace and evidence

| Item                      | Observed state                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary working directory | `industrial-sas` (sibling worktree); local `main` at `733c6ac` with two unpushed commits; its 26 uncommitted paths are the AI pilot plus copied Bun/AI docs      |
| Checker worktree          | `industrial-sas-bun-typecheck-pilot`; use this single worktree even though the request named it twice                                                            |
| Checker branch            | codex/bun-typecheck-pilot-20261011                                                                                                                               |
| Checker base              | 8b0ef5385528fce32219e3ac1bd3a678d24abf95 (local commit, not on origin; merge-base with main `c64a882`)                                                           |
| Observed origin/main      | T00 base `ca8c296b2364fcbca33df81a5b18f9e1a213ac16`; main advanced to `9675ae7b77c7e2a1369e4ef5c520531e14b8d823` (PR #69, app-only) during T00; refresh per task |
| Existing toolchain        | Node 24.x, pnpm 10.33.2, Next 16.3.8, TypeScript 6.0.3, Vitest 4.1.10, Convex 1.46.0                                                                             |
| Bun pilot                 | Bun 1.4.3, embedded TypeScript 7.0.2, installed in the checker worktree's ignored .cache/checker-tools; Bun is not globally on PATH                              |
| Kiro availability         | CLI model inventory confirmed claude-opus-5.5 on October 11, 2026 (rechecked during T00); preview model; explicitly select it on every run                       |

Sibling worktree names are relative to the shared development directory. The [T00 workspace inventory](../reviews/bun-elysia/T00/workspace-inventory.json) records their dirty files, ownership and divergence.

Required starting documents:

- docs/plans/bun-migration-research-2026-10-11.md, especially adoption target, migration matrix and completion criteria. Delivered by T00.
- docs/reviews/bun-typecheck-pilot-2026-10-11.md and its raw assets (copied from the checker worktree by T00).
- docs/reviews/ai-search-clerk-performance-2026-10-11.md and its raw assets (copied from the primary workspace by T00). The AI pilot code itself stays in the primary workspace until T02.
- docs/plans/performance-next-steps-2026-10-11.md (Phase 2) for separate browser loading/navigation work. The older docs/plans/performance-improvement-2026-10-10.md exists only in the unpushed local commit `8b0ef53`, not on main.
- docs/operations/release-runbook.md and the existing CI/deployment validators.
- AGENTS.md and the relevant installed Next guides under node_modules/next/dist/docs before code edits.

Existing measurements are limited baselines:

| Experiment              | Result                                                                                                                             | Limit                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Checker pilot           | Complete Bun command 1.536 s versus full TS6 17.440 s and warm TS6 5.111 s; 729 project inputs matched; deliberate errors rejected | Three local samples on the pilot base; CI/build/runtime speed is unmeasured      |
| Clerk token reuse       | Warm route-auth median 308.83 ms to 2.44 ms; HTTP median 374.70 ms to 130.80 ms                                                    | Five interleaved local samples per path, no OpenRouter; Convex duration varied   |
| Real AI UI              | HTTP 200, grounded holidays destination, dialog closed; route auth 3.37 ms                                                         | One OpenRouter-inclusive request; no before/after model-latency result           |
| Current AI verification | 120 focused tests and production build passed                                                                                      | Uncommitted primary-workspace pilot; reconcile with current main before delivery |

Do not label these “10× faster application,” “10× faster Clerk,” or production Bun results.

## Intended architecture

- Next owns the UI, SSR, locale handling, uploads and framework routing.
- Elysia owns AI/integration HTTP contracts, input and output validation, sanitized errors, provider-facing orchestration and typed Eden clients where useful.
- Clerk authenticates interactive users. Verify session and organization identity before user-initiated operations.
- Provider webhooks authenticate with their provider's signature protocol. LINE/Sent/Composio webhooks do not have Clerk sessions.
- Convex owns tenant membership/permissions, transactional data, quotas, audit records, deduplication, durable jobs and authorized preflight decisions.
- Provider-specific modules own outbound SDK/API behavior. Do not force SDK response types into the public HTTP contract or assume an HTTP framework speeds up remote APIs.
- Start with Elysia mounted in Next. Adopt Bun execution of that verified path first. A directly served Elysia Bun app is a separate topology experiment, using the same contracts and same-origin platform routing; select it only after deployment and operational equivalence pass.
- Hosted Convex functions remain on Convex's supported runtime. Bun's local CLI/client execution does not change that platform runtime.

Keep public APIs small and implement shared policy once. Avoid a generic integration framework with speculative options. Each provider gets a focused module; share deadlines, safe error handling or idempotency only when actual callers need the same behavior.

## Required cycle for every task/PR

### A. Prepare a scoped branch

Refresh origin/main and record its SHA. Preserve all current work. Do not stash, reset, clean or commit unrelated files. Record the task's files, base SHA, expected behavior, tests and evidence directory before starting Kiro.

Use the existing checker worktree for T01 after reconciling its changes against current main. Other tasks get a clean worktree based on the latest merged main. Transfer the AI pilot by an explicitly reviewed patch containing only its files; do not copy the entire dirty primary workspace.

Keep each task independently buildable and mergeable. Any task below that becomes too large splits into suffixed PRs, each completing this full cycle. Do not combine a package manager, runtime, bundler and test-runner switch in one PR.

### B. Kiro implementation

Recheck model availability:

    '/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat' chat --list-models --format json-pretty

Run in the task worktree:

    '/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat' chat \
      --model claude-opus-5.5 \
      --effort high \
      --trust-all-tools \
      --no-interactive \
      "Implement task Txx from docs/plans/bun-elysia-delivery-plan-2026-10-11.md. Read AGENTS.md and relevant installed Next guides. Preserve existing work, edit only the declared scope, satisfy acceptance criteria and run relevant checks. Do not commit, push, create or merge PRs, deploy, change remote environment values or contact real recipients. Produce a handoff with changed files, test results, evidence and unresolved items."

Keep prompts and handoffs under docs/reviews/bun-elysia/Txx/. Kiro may use local reversible experiments. External credentials and live-provider fixtures must be explicitly part of the task's configured scope before use. If the requested model is unavailable, report it and obtain a model choice; do not silently substitute another model.

### C. Codex audit and fixes

Review the complete diff against the recorded base, including generated files and lockfiles. Audit both the documented repository standards and the task specification.

Focus on actual behavior: authentication and tenant isolation, transactional consistency, retries/duplicate side effects, loss of test coverage, runtime selection, audit/lifecycle guarantees, release target isolation, hidden Node subprocesses, error contracts and performance attribution.

Codex fixes findings directly and adds meaningful regression coverage where behavior needs proof. Record resolved findings and remaining limitations. Passing tests do not replace reviewing the implementation.

### D. Kiro refactor

Run the same model and effort with a narrowly scoped refactor prompt:

    "Refactor task Txx after the Codex audit/fixes. Read the audit and preserve all accepted behavior, security rules and test coverage. Simplify interfaces and remove duplication only where justified. Introduce no new feature, dependency upgrade, deployment change or unrelated edit. Run relevant checks. Do not commit, push, create/merge PRs or deploy. Report what changed and why."

A report explaining that no further refactor is justified is acceptable; do not manufacture churn. This step happens for every task, including documentation/configuration tasks at their appropriate scale.

### E. Final verification, PR and merge

Codex audits the refactor diff and resolves any new findings. Run the task checks plus all mandatory repository gates appropriate to the final tree. For docs-only work, formatting/link/scope checks are sufficient locally; GitHub still runs required checks. Runtime/security/toolchain changes require clean-install, full check and production build evidence. Browser changes require the relevant real flow.

Commit only the task's explicit file list. Write a reviewable PR body to a file, including problem/result, scope, validation, measurements, compatibility exceptions and rollback. Create the PR against main.

Immediately register its full URL with mcp__t3_code__link_pull_request. Register each PR if a task splits. Before finishing PR work, use mcp__t3_code__list_thread_pull_requests and link any missing PR. A registration error must be reported and corrected, not described as linked.

Wait for all required checks, including security and dependency review. Resolve conversations, confirm the PR is mergeable/up to date, and confirm the audited head SHA equals the PR head. A conflict resolution or subsequent code edit invalidates the previous final verification and requires another scoped audit/check run.

Merge the verified head through the normal PR path. Use a head-commit match when supported:

    gh pr merge <PR-number> --squash --match-head-commit "$TASK_HEAD"

Do not use administrator bypass or force-push to bypass protections. Keep local worktrees until evidence and the merged result are reconciled.

### F. Verify after merge

The existing main workflow automatically runs quality → staging → production. Main merge is therefore a release trigger. Preserve that automation and its exact-SHA, lock, backup, candidate-smoke and promotion safeguards. No new manual approval gate is part of this plan.

Record merge SHA, workflow/run URLs, staging and production outcomes and read-only smoke results. Confirm the running release SHA/runtime when a runtime changed. If another change supersedes the SHA, inspect the replacement release and reconcile the evidence.

A task is DONE only after the merged result is verified. A task is MERGED_PENDING_RELEASE when the merge succeeded but release evidence is pending. Fix a failed release through the existing controller/runbook; do not use ad hoc Vercel or Convex deployment commands.

## Task sequence and PR scopes

### T00 — Record the baseline and preserve the pilots

Dependencies: none.

Kiro inventories relevant tracked/untracked work, runtime commands, two independently locked dependency installs, seven test projects, required CI jobs, release configuration and provider endpoints. Add the research, this plan and portable evidence to a scoped documentation delivery.

Reconcile the checker branch's older base with current main without overwriting its uncommitted fixture/script/evidence changes. The AI pilot remains a separate scope. Inspect concurrent work in other worktrees before selecting files.

Acceptance: record fresh base SHA, complete command/test manifests, pilot ownership, existing PRs if any, clean-install baseline and task ledger. Link each source report. Do not mistake a local pilot for an already merged feature.

Rollback: documentation revert only.

### T01 — Promote the verified Bun checker to the default

Dependencies: T00.

Reuse the existing checker worktree and its three corrected move fixtures. Pin Bun 1.4.3 consistently in the documented local setup and CI. Make the ordinary typecheck command generate Next route types and explicitly invoke the standalone checker. Preserve aggregate formatting/lint/test checks and retain a clearly named TS6 comparison/fallback command.

Use bun --check rather than bare bun check because the repository has a check script. Retain TypeScript 6 for its compiler API consumers. Next build's checker remains enabled and separate.

Acceptance: both checkers pass current main plus the pilot; compare project input manifests; reject deliberate errors in src/tests/Convex/generated route types; verify clean and edited-file cases; run affected fixture tests and a full build. Demonstrate the pinned checker on Linux CI. Measure the full command, including typegen, separately from checker-only time.

Rollback: restore the prior typecheck command and CI step; retain valid fixture corrections.

### T02 — Deliver Elysia AI contracts and Clerk token reuse

Dependencies: T01.

Transfer the scoped primary-workspace AI pilot: Elysia app/contracts, Eden client, Next adapter, useAiSearch, relevant mocks/tests, precise Convex return types and benchmark/docs. Preserve the selected compatible Elysia/TypeBox/peer versions, verifying their graph on the new base.

Retain current browser session + Convex token acquisition for the captured organization. Clerk middleware authenticates the session bearer token; the route verifies the template token's signature/time/audience/origin and matches issuer/user/organization. Preserve v2 organization precedence, cancellation/account switching, sanitized responses and Convex permission/quota enforcement.

Acceptance: run real signed-token failures, missing/changed organization and pending-acquisition cancellation cases; both compiler paths; endpoint validation/date-string/error tests; full build; authenticated and anonymous browser checks. Repeat the real Clerk/Convex benchmark and one bounded local AI flow. Record cold/warm behavior separately.

Rollback: preserve the existing Convex action and a tested direct-client path or previous route version for a controlled revert. Never automatically retry a paid call after an ambiguous result.

### T03 — Prepare Bun dependency security and lifecycle parity

Dependencies: T01.

Add a Bun audit adapter and resolved-graph validation while existing installation remains the baseline. Preserve exact advisory/version/parent-path/scope/expiry exceptions for app and release installs. Registry errors, malformed reports or unknown paths fail closed.

Model lifecycle-script restrictions explicitly, including Bun's default trusted packages. Detect newly introduced unreviewed scripts. Verify parent/version-scoped security overrides against actual resolved versions; configuration syntax alone is insufficient.

Acceptance: clean/high/critical/expired/wrong-path/malformed/registry-error fixtures for both installs; compare old and new decisions on the real graph; verify blocked/reviewed/new build-script cases. Existing audit behavior remains enforced throughout.

Rollback: remove the candidate adapter/policy additions; old audit/install behavior stays operational.

### T04 — Switch root dependency installation and CI setup to Bun

Dependencies: T02, T03.

Migrate the root lockfile to a committed bun.lock with isolated linking selected explicitly. Preserve exact dependency versions, integrity, security overrides and reviewed lifecycle policy. Update package metadata, setup action, frozen installs, caches, dependency review and workflow validation coherently.

Keep the separate release install unchanged until T05. Retain a rollback lock snapshot until the migration passes; avoid two competing default package managers in active CI.

Acceptance: clean frozen installs on macOS/Linux; identical intended versions/overrides/peers; native/image/WASM helpers, codegen, typecheck, lint, all existing tests and build pass. Audit app and release scopes. Measure clean/cached installs under equivalent caches. Validate all workflow/action pins and invalid-install refusal.

Rollback: restore root metadata/setup/lock policy together.

### T05 — Migrate the independently locked release install and commands

Dependencies: T04.

Migrate tools/release separately to its own Bun lock and exact CLI pin. Convert locked installs, audit scope, release orchestration and Vercel build commands together with validator updates. Preserve environment contracts, exact main-SHA checks, backup locks, staging/candidate/live verification and promotion of the same deployment.

Check the pinned Vercel/Convex CLIs' actual runtime and subprocess behavior. Record any real Node-only requirement rather than declaring Bun merely because the launcher changed.

Acceptance: isolated release install/audit; wrong target/SHA/credentials and stale-main refusal tests; workflow validation; sanitized failed-child reporting; rehearsal through the trusted staging controller. No release guard or audit exception is weakened.

Rollback: restore the release install, commands and matching validators as one unit.

### T06 — Run compatible repository scripts and CLIs on Bun

Dependencies: T04, T05.

Inventory script entry points, shebangs, spawn/fork calls, executable shims and process.execPath assumptions. Convert compatible CI/reporting/codegen/local-seed/benchmark/release scripts to explicit Bun execution. Keep required framework/lint/browser tools.

Acceptance: inspect actual child runtimes; verify stdout/stderr/exit codes, signals, deadlines, temporary-file cleanup and failure reporting. Run every changed entry point's meaningful checks. A bun run command that launches explicit Node is recorded as partial until resolved.

Rollback: per-entry-point launcher changes and their validators.

### T07 — Adopt Bun for Next dev/build/start and local development orchestration

Dependencies: T02, T06.

Pilot explicit Bun execution of Next dev/build/start with the same current bundler flags. Adapt scripts/dev.mjs and CLI spawning only after direct execution passes. Keep generated output directories isolated from the user's development server.

Acceptance: Clerk sign-in/org switching/proxy/SSR, Convex subscriptions and codegen, UploadThing, Sharp/WASM/image/barcode flows, stream/cancellation behavior, HMR and Ctrl+C/child cleanup. Run a complete production build with type checks. Benchmark startup/HMR/build/HTTP behavior sequentially against Node with identical bundler/configuration.

Investigate removing --webpack in a separate suffixed experiment/PR if justified. Attribute Turbopack gains separately from Bun.

Rollback: restore explicit Node execution and the previous dev launcher.

### T08 — Migrate compatible pure tests to the native Bun runner

Dependencies: T06.

Start with pure domain/unit suites, then compatible property tests. Preserve assertions, fixtures, aliases, seeding, mocks, timers, isolation and CLI exit behavior. Add discovery/reporting that can cover a mixed-runner transition without counting a test twice or losing it.

Acceptance: compare discovered files/test cases and outcomes against the baseline; prove a deliberately failing test fails CI; preserve property-run seed/replay behavior. Measure under the same source tree and equivalent workers. Default compatible suites to native Bun after parity.

Rollback: restore those suites to their prior Vitest project.

### T09 — Migrate compatible UI, DOM and accessibility suites

Dependencies: T07, T08.

Evaluate the repository's real jsdom/React/Testing Library/a11y requirements, hoisted mocks, fake timers, setup order and Vite transforms. Migrate suites when actual behavior is preserved. Retained suites need a file/project-specific capability blocker.

Acceptance: keyboard/focus/navigation/cancellation and a11y behavior, failure isolation, discovery, mocks and real timer cases. Compare coverage scope/report behavior and produce equivalent CI results. Do not suppress failing cases, replace assertions with weaker ones or drop projects to make the runner green.

Rollback: restore affected UI suites and configuration to Vitest.

### T10 — Migrate compatible integration/isolation/Convex tests and CI reports

Dependencies: T08, T09.

Evaluate Convex's edge-runtime/convex-test and import.meta.glob requirements separately from ordinary Node integration tests. Migrate every compatible suite. If native Bun cannot reproduce a required capability, evaluate Vitest execution under Bun; retain a Node execution exception only with evidence.

Update shards, JUnit/report adapters, test discovery, weekly coverage, fail-on-empty and aggregate quality checks. Keep all seven current project responsibilities represented.

Acceptance: tenant/permission/webhook/action-quota and codegen/lifecycle cases; mock isolation; full inventory reconciliation; lost shard, missing report, zero-test and intentionally failed shard all fail the quality gate. Preserve reporting privacy and coverage meaning.

Rollback: restore runner allocation and matching shard/report/discovery rules together.

### T11 — Make AI orchestration and provider contracts reusable

Dependencies: T02, T07, T10.

Separate the OpenRouter transport and grounded search logic from hosting concerns, keeping validated request/response contracts and explicit deadlines. Measure the current route/action before changing where the provider call runs.

If moving provider calls into Elysia, first implement an authorized Convex preflight that atomically enforces tenant policy, durable quota and audit requirements. Pass only the minimal authorized facts needed for grounding. Keep an exactly-one-call policy, current errors and calendar strings; provider output remains untrusted.

The current runbook places OpenRouter credentials in Convex only. Moving execution requires a separate reviewed credential/environment-contract change before activation. It is not an implicit permission to copy secrets into Vercel or expose them through NEXT_PUBLIC values.

Acceptance: denied requests make no provider call; simultaneous requests obey durable limits; timeout/cancel/invalid output/refusal cases; no silent repeat billing; representative Thai/English navigation outcomes; caller/tenant isolation. Compare identical provider workloads and report network/provider waits separately.

Rollback: retain a selectable previous Convex action implementation; ensure only one path can issue a provider request for a given operation.

### T12 — Add focused integration contracts and durable operation handling

Dependencies: T11.

Define the minimum public HTTP contracts and provider modules needed by LINE, Sent.dm and Composio calendar. Add tenant-owned connection records, provider identity mapping, operation IDs, durable deduplication/outbox state and bounded worker handling where actual flows require it.

Interactive control endpoints use Clerk plus Convex authorization. Provider callbacks use raw-body signature verification followed by payload validation and stored tenant mapping. Persist an accepted event before acknowledging work that must survive process termination.

Acceptance: missing/invalid signatures, changed raw bytes, duplicate/out-of-order events, tenant mismatch, replay, simultaneous retries, crash/restart and bounded body cases. Prove one durable logical operation; do not claim arbitrary HTTP delivery is exactly once.

Rollback: disable new entry points while preserving durable records; do not blindly replay potentially completed outbound operations.

### T13 — LINE webhook and outbound adapter

Dependencies: T12.

Implement the specific agreed LINE test flow with official signature handling, event deduplication and typed outbound requests/errors. Verify webhookEventId and redelivery behavior from current LINE documentation. Map LINE identities/channels to tenant connections on the server.

Choose ownership explicitly: use either direct LINE or Sent routing for a given operation. An enabled direct adapter and a Sent adapter must not both deliver the same message.

Acceptance: raw-body signature rejection, duplicate/redelivered/out-of-order events, reply-token expiry, provider timeout/429 and ambiguous send outcomes; signed sandbox webhook through Elysia/Convex and a designated test recipient. Measure acknowledgement time separately from delivery time.

Required external configuration: sandbox channel, channel signing secret/access credentials and designated test identity. Missing configuration leaves sandbox verification pending; fixture tests are not reported as live success.

Rollback: disable the channel's new routing/worker while retaining processed-event/outbound records.

### T14 — Sent.dm messaging adapter

Dependencies: T12, T13 ownership decision.

Implement only the required messaging channels and delivery-status callbacks. Recheck current Sent authentication, signatures and idempotency semantics from its official API documentation. Keep vendor-specific IDs/statuses inside the adapter and normalized operational results in Convex.

Acceptance: accepted/delivered/failed transitions, duplicate callbacks, invalid signature, rate limits, retry exhaustion, network ambiguity and tenant isolation. Use a designated test recipient and verify one logical send across retries. Ensure LINE routing cannot double-send.

Required configuration: sandbox credentials, webhook settings, verified sender and test recipient.

Rollback: disable the adapter and preserve the outbox/status history for reconciliation.

### T15 — Composio calendar adapter

Dependencies: T12.

Bind connected accounts to authenticated Clerk users and tenant-owned records. Define which provider/calendar and calendar operations the first product flow needs before building broad tool execution. Begin with read-only calendar connectivity; enable writes only for the scoped feature/test flow.

Use explicit allowed calendar tools, validated dates/time zones and authorized connected-account IDs. Handle OAuth connection/revocation and provider errors. Do not let model-supplied account or tool IDs select another tenant's connection.

Acceptance: wrong user/org/account/tool denied; missing/expired/revoked connection; date/time-zone and pagination cases; durable write deduplication if writes are enabled. Verify a sandbox account; any event creation/update/cleanup targets only explicitly designated test records.

Required configuration: Composio auth configuration, selected calendar provider, authorized sandbox connected account and allowed operations.

Rollback: disable new calendar operations; retain connection and operation history without executing compensating calendar writes blindly.

### T16 — Verify Elysia/Bun deployment on staging

Dependencies: T05, T07, T11; provider-specific staging verification follows T13–T15 as configured.

Check current Vercel Bun support and Next/Elysia integration requirements. The researched runtime is Beta; explicit 1.4.x selection and Vercel-managed patch versions differ from an exact local 1.4.3 pin.

First deploy the verified Next-mounted Elysia path on Bun through the trusted staging controller. Scope the runtime/configuration change to staging so merging this experiment does not switch production prematurely. Verify environment identity using the controller's actual staging project; its Vercel target is Production and cannot be selected from VERCEL_ENV alone.

Test a directly served Bun/Elysia service in a separate suffixed experiment if it provides useful throughput/consistency. Confirm current Services/routing support before implementing topology changes; keep browser routes same-origin and avoid redundant authentication hops.

Acceptance: actual deployed runtime/version/SHA proof; Clerk anonymous/signed-in/org switch, SSR/locale/proxy/cache/cookies, Convex policy, uploads, images/WASM, streaming/cancellation, cold starts and sanitized telemetry. Preserve backups/release isolation. Test the Node rollback configuration through the controller.

Rollback: target-scoped Node config and the previous deployment via the existing runbook.

### T17 — Measure workload performance and set rollout budgets

Dependencies: T16; integration measurements require the corresponding configured provider task.

Measure equivalent Node/Bun execution of the same handler and topology. If comparing Elysia with another handler, hold runtime, auth, body, validation, logging and provider behavior constant. Do not combine that comparison with moving provider calls or changing bundlers.

Capture cold/warm startup, clean/cached installs, edited/full checks, build/test time, CPU/RSS, HTTP p50/p95/p99, bounded concurrency, error rate, webhook acknowledgement and separately provider completion. Run synthetic load locally/staging with deterministic providers; use only bounded real-provider samples permitted by quotas/test accounts.

Record source SHA, runtime versions, OS/hardware, worker counts, sample count, cache state and raw artifacts. Agree numeric latency/resource/error budgets from the measured baseline before rollout; do not invent guaranteed gains. Consistency-driven adoption can proceed without a large speedup when reliability and budgets hold.

Acceptance: no loss of correctness, authentication, permission or durable-delivery guarantees; materially regressing paths investigated or kept on their documented exception. Report tooling gains, framework overhead, token-flow gains and real request latency separately.

Rollback: keep the measured Node/topology baseline selectable until rollout is verified.

### T18 — Adopt the verified Bun runtime in production

Dependencies: T16, T17; only enabled provider features with completed acceptance join this rollout.

Promote the validated runtime/configuration through a scoped PR and the existing automatic main release pipeline. Preserve exact-SHA quality/staging checks, fresh backup, production lock, candidate smoke and promotion of the same deployment. Runtime adoption does not implicitly move backend-only credentials or enable unfinished integrations.

Acceptance: matching merged/release/deployment SHA; candidate and live read-only smoke; authenticated/anonymous/tenant flows and configured integrations; observed runtime/version; metrics within recorded budgets. Record rollback readiness and the actual deployment outcome.

Rollback: use the release controller/runbook to restore the reviewed Node configuration/previous verified deployment and reconcile any durable in-flight operations.

### T19 — Remove superseded defaults and reconcile compatibility exceptions

Dependencies: T04–T10, T18.

Remove inactive pnpm setup/locks, duplicate transitional commands and obsolete runtime/test configuration only after their replacements are verified. Preserve necessary Next, lint/format, Playwright and platform tools. Each remaining Node/Vitest/package-manager exception must name its command/files, reason, evidence, owner and revisit condition.

Update README, onboarding, CI, release docs, dependency-update automation, benchmark instructions and .env.example. Verify a fresh contributor/runner can follow the Bun defaults without the author's ignored cache or global installation.

Acceptance: frozen root and release installs; aggregate check, all runner inventories, production build, audit/workflow/codegen/clean-tree gates and browser flows. Search for remaining pnpm/node/Vitest execution and reconcile every result, including shebangs and subprocesses.

Rollback: restore the retained transition configuration from its reviewed commit; do not improvise an unreviewed lockfile.

### T20 — Close the migration with final evidence

Dependencies: all delivered tasks; pending providers/exceptions must be stated explicitly.

Kiro organizes the final migration report; Codex audits measured claims, remaining compatibility exceptions, PR/merge/release ledger and reproducibility. Kiro refactors the docs for clarity; Codex performs the final verification and documentation PR cycle.

Acceptance: the completion criteria below all hold, every shipped task has a linked PR and verified merge/release SHA, and any unconfigured integration is clearly pending rather than labelled complete. Publish measured performance without extrapolating microbenchmarks to user-visible gains.

Rollback: documentation correction; code/runtime reversions use the corresponding task's rollback.

## Common verification matrix

| Change                     | Required proof                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Checker                    | Generated route inputs, positive/negative diagnostics, both compiler paths, full build                                         |
| Package manager            | Two frozen installs, graph/overrides/peer parity, lifecycle policy, both audit scopes, CI validators                           |
| Runtime/scripts            | Actual process runtime, output/exit/signals/timeouts, full checks/build and relevant browser flows                             |
| Test runner                | Inventory and failure parity, environments/mocks/timers/isolation, nonempty shards, JUnit/coverage and aggregate failure cases |
| Clerk/API                  | Real signed JWT failures, identity/org binding, request/response/error contracts, cancellation and authorized Convex action    |
| AI provider                | Permission/quota before provider, grounding/contracts, deadline/cancellation, ambiguous-call handling                          |
| Webhooks/messages/calendar | Provider signature/account binding, durable deduplication/retry behavior, tenant isolation, configured sandbox flow            |
| Deployment                 | Exact SHA/target, trusted controller, backup/locks/candidate/live checks, deployed runtime and rollback                        |

During transition, run the current authoritative gates plus the candidate Bun path. After a switch, the Bun aggregate must retain formatting, type generation/checking, lint and complete tests. Do not use skip flags, ignoreBuildErrors, empty discovery or broad audit ignores as migration fixes.

Benchmarks run sequentially without overlapping builds/tests started by this migration. Verification tests run after timing. Existing user/background activity is recorded when uncontrolled.

## Evidence and task ledger

For each task, keep:

- Implementation/refactor prompts and handoffs.
- Recorded base and audited head SHAs; file scope and task specification.
- Codex audit findings/fixes and final verification.
- Relevant test commands/results; raw timing and runtime evidence.
- PR URL, linked-thread confirmation, merge SHA, CI/run URLs, staging/production outcomes.
- Rollback instructions and compatibility exceptions.

Initial state (planning, before T00):

| Task    | State                                                              | PR / merge / release |
| ------- | ------------------------------------------------------------------ | -------------------- |
| T00     | Planned                                                            | Pending              |
| T01     | Local checker pilot available; default/CI delivery pending         | Pending              |
| T02     | Local Elysia/Clerk pilot verified; reconciliation/delivery pending | Pending              |
| T03–T20 | Planned                                                            | Pending              |

Current ledger (update at every state transition; newest evidence wins):

| Task    | State        | Base / audited head                                                                                                                                                         | Evidence                                                                                                                                                                                                                                                                                                                                   | PR / merge / release                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T00     | DONE         | manifests at `ca8c296`; integration base `9675ae7`; audited/PR head `72310ec`                                                                                               | [handoff](../reviews/bun-elysia/T00/handoff.md), [Codex audit](../reviews/bun-elysia/T00/codex-audit.md), [refactor handoff](../reviews/bun-elysia/T00/refactor-handoff.md), [final verification](../reviews/bun-elysia/T00/final-verification.md); [release evidence](../reviews/bun-elysia/T01/T00-release/) supplied by the coordinator | [PR #70](https://github.com/Rugby-Thailand/industrial-sas/pull/70) merged 2026-10-11T04:52:28Z as `77ae110`; Planner quality run 38112960884 succeeded; staging `STAGING_PASSED` (12 passed, 1 optional skipped); production `RELEASED` (candidate and live 6 passed, 1 optional skipped); CodeQL succeeded                                                                                                                                                                                                            |
| T01 | DONE | audited/PR head `530105cd15406eda87794e413b79bcf0791847a4`; merge `4c3db2ec0be049bfe65640c3697cc16bdae69d25` | Final exact-head comparison: 90 serial observations; full gates passed. Raw evidence preserved by the coordinator and included in the pending T02 documentation. | [PR #71](https://github.com/Rugby-Thailand/industrial-sas/pull/71); [merge quality](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38118834876) and [CodeQL](https://github.com/Rugby-Thailand/industrial-sas/actions/runs/38118834924) passed. Staging 12 passed; production candidate/live each 6 passed, one optional unconfigured skip, zero required skips. Same candidate `dpl_B8oF3EPHbu4sBWE7oh8TCj7mhpof` promoted after a fresh storage-inclusive backup. |
| T02 | FINAL_VERIFY | isolated local candidate `93ce153f012fcbdb910ecda223df590f6918aa78`, base `d07f6282bfee73ac8c264f6cab4737487dc52a8e` | Final source audits clear; 16 repository gates passed (3,110 tests), independent 145 focused tests. Root warm authentication characterization complete; independent live/reload and bounded AI verification pending. These observations do not approve any later integrated version. | No PR, merge or release; native reload capability pending. |
| T03 | INITIAL_AUDIT_PENDING | base `d07f6282bfee73ac8c264f6cab4737487dc52a8e`; initial implementation `07cf888b651e5b67009bfe0ea6cc2a8460b63d63` | [Kiro handoff](../reviews/bun-elysia/T03/handoff.md), exact Opus 5.5 high exit 0 at 09:10:20.627055Z; direct targeted 133 + 54 tests passed. Opening timestamps are approximate and omit the coordinator pause; exact orchestration receipts govern and will be reconciled during audit fixes. | No PR; standards/spec audits, fixes, Kiro refactor and final gates pending. Advisory paths, graph differences, lifecycle path/completeness findings and Linux evidence block authoritative Bun adoption. Reconcile final T02 graph before adoption. |
| T04–T20 | PLANNED | — | — | None |

No Bun runtime or Elysia route has been merged or released. T01 releases only the pinned standalone checker and retains TS6 compatibility paths. T02 and T03 remain isolated local candidates. Provider sandbox identifiers are deferred by the user; no current request for them.

State transitions: PLANNED → IMPLEMENTING → IMPLEMENTED_LOCAL → CODEX_AUDIT_FIX → KIRO_REFACTOR → FINAL_VERIFY → PR_CHECKS → MERGED_PENDING_RELEASE → DONE. Use EXCEPTION with evidence for a proven compatibility limit and CONFIGURATION_PENDING for a provider test awaiting configuration. Neither state implies the whole migration is complete.

## Completion criteria

- Bun is the documented default for every verified-compatible installation, check, script, test, Next execution, CI and release path.
- Both dependency installs preserve exact versions/integrity, overrides, lifecycle restrictions and audit exception semantics.
- Next route generation and build type checks remain enabled.
- Every baseline suite/case is accounted for; missing/failed tests and reports fail CI.
- Elysia/Clerk endpoints preserve tenant permissions, quotas, contracts, cancellation and sanitized errors.
- Enabled LINE/Sent/calendar/OpenRouter flows pass their specified sandbox and deployment verification.
- Hosted Convex and all retained runtime/test/tool requirements are recorded with concrete evidence.
- Before/after measurements distinguish tooling, framework, authentication, database/provider and browser costs.
- Every delivered task followed Kiro implementation → Codex audit/fix → Kiro refactor → final verification → PR/checks/merge → post-merge verification.
- Fresh setup, trusted staging/production release and tested rollback work with the final defaults.
- Remaining configurations or exceptions are documented honestly; unconfigured provider features are not reported as live integrations.

## Primary documentation to recheck during execution

- [Bun checker](https://bun.sh/docs/runtime/check): compiler semantics and explicit check invocation.
- [Bun installs](https://bun.sh/docs/pm/cli/install), [lockfiles](https://bun.sh/docs/pm/lockfile), [overrides](https://bun.sh/docs/pm/overrides), [lifecycle scripts](https://bun.sh/docs/pm/lifecycle), [audit](https://bun.sh/docs/pm/cli/audit).
- [Next on Bun](https://bun.sh/guides/ecosystem/nextjs), [Node compatibility](https://bun.sh/docs/runtime/nodejs-compat), [Bun mocks](https://bun.sh/docs/test/mocks), [DOM testing](https://bun.sh/docs/test/dom).
- [Elysia in Next](https://elysiajs.com/integrations/nextjs), [Elysia overview/benchmark scope](https://elysiajs.com/at-glance).
- [Clerk request authentication](https://clerk.com/docs/reference/backend/authenticate-request), [template verification](https://clerk.com/docs/reference/backend/verify-token), [browser token caching](https://clerk.com/docs/nextjs/reference/objects/session#gettoken).
- [Convex runtimes](https://docs.convex.dev/functions/runtimes), [Bun tooling](https://docs.convex.dev/quickstart/bun), [Convex testing](https://docs.convex.dev/testing/convex-test).
- [Vercel Bun runtime](https://vercel.com/docs/functions/runtimes/bun), [Services](https://vercel.com/docs/services), [package-manager selection](https://vercel.com/docs/package-managers).
- [LINE receiving/signatures/redelivery](https://developers.line.biz/en/docs/messaging-api/receiving-messages/), [Sent docs](https://docs.sent.dm/), [Composio docs](https://docs.composio.dev/docs), [OpenRouter API](https://openrouter.ai/docs/api_reference/overview).

These links are execution references, not compatibility certification for this repository's pinned versions. Refresh them when executing the relevant task.
