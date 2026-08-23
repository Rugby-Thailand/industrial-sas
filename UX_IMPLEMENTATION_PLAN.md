# UX implementation plan

Date: 2026-08-23

Source backlog: [`UI_UX_IMPROVEMENT_BACKLOG.md`](./UI_UX_IMPROVEMENT_BACKLOG.md)

## Sequencing principles

1. Correct misleading state before improving appearance.
2. Fix shared gates before individual screens that depend on them.
3. Run work in parallel only when file ownership and behavior boundaries are independent.
4. Avoid large workflow redesigns until navigation, authentication, and error semantics are stable.
5. Leave vendor, hardware, and pilot evidence until the application workflows are internally coherent.

## Work waves

| Wave             | Timing        | Stream                                                                                        | Depends on                           | Can run with                               | Exit condition                                                                                                      |
| ---------------- | ------------- | --------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 1A               | First         | Remove Dashboard setup/release-status sections; correct SetupChecklist ready/missing behavior | None                                 | 1B, 1C                                     | Configured Dashboard has no setup diagnostics; setup/sign-in states remain correct and tested.                      |
| 1B               | First         | Gate workspace query on settled authenticated Convex state                                    | None                                 | 1A, 1C                                     | Hard refresh cannot issue tenant query while auth is loading/signed out; provider tests cover every state.          |
| 1C               | First         | Correct multi-query denial/error attribution                                                  | None                                 | 1A, 1B                                     | Fulfillment, Production, and Transfers report the actual failing query and request reference.                       |
| Integration gate | After Wave 1  | Merge behavior, run focused tests, a11y, typecheck, and browser smoke                         | 1A–1C                                | Nothing                                    | Wave 1 is green and the authenticated Dashboard/representative denied pages are verified in browser.                |
| 2A               | Next          | Permission-aware desktop/handheld navigation; add Production; unique icons                    | 1B, integration gate                 | 2B, 2C with separate translation ownership | Users see only relevant/available work; Production is discoverable.                                                 |
| 2B               | Next          | Replace developer/setup language, improve permission and empty-state copy                     | 1A, 1C                               | 2A, 2C if message files are coordinated    | No operational page exposes env variables, idempotency internals, provider architecture, or wrong-scope empty copy. |
| 2C               | Next          | Reporting tab semantics, independent query failures, shared date/status formatting            | 1C                                   | 2A, 2B with separate files                 | Tabs are keyboard-correct; one report failure does not erase others; Thai/timezone formatting is consistent.        |
| Integration gate | After Wave 2  | Full navigation, locale, accessibility, and role-matrix verification                          | 2A–2C                                | Nothing                                    | Desktop and handheld route matrices are permission/locale correct.                                                  |
| 3A               | Then          | Engineering workflow decomposition and structured repeatable rows                             | Wave 2 navigation/copy               | 3B, 3C                                     | Queue/detail/editor/release are separated; no pipe-delimited authoring or client-owned verification placeholders.   |
| 3B               | Then          | Real Purchase Order and Opening Stock file-import experiences                                 | Wave 2 copy/error states             | 3A, 3C                                     | File picker, mapping/preview, row errors, automatic hash, reason selectors, resume/progress.                        |
| 3C               | Then          | Handheld task prioritization and scan-first work                                              | Wave 2 permissions/navigation        | 3A, 3B                                     | One dominant action per task, authorized task counts, scanner/offline status, human UOM entry.                      |
| 3D               | After 3A–3C   | Label template preview/diff/test-print boundary and operational report deep links             | Workflow data stabilized             | Limited parallelism                        | Users can validate artifacts and navigate from summaries to exact records.                                          |
| 4A               | Last internal | Persistent offline queue/drainer, background job orchestration, signed file delivery          | Stable workflows and error semantics | 4B where adapters are independent          | Long-running/offline/file operations are reliable and observable.                                                   |
| 4B               | Last external | Printer/scanner/provider adapters and credential/worker infrastructure                        | 3D, security review                  | 4A where independent                       | Real integrations pass recovery, permission, and failure-mode tests.                                                |
| 4C               | Last evidence | Target Android, scanner, printer/media, Thai glyph, weak-network, gloves/lighting pilot       | 4A–4B                                | Nothing                                    | Physical release gates and pilot evidence are complete.                                                             |

## Active Wave 1 ownership

| Agent                | Stream      | Primary files                                                                     | Status   |
| -------------------- | ----------- | --------------------------------------------------------------------------------- | -------- |
| `wave1_dashboard`    | 1A          | Dashboard page, SetupChecklist, focused tests, Setup/Dashboard message keys       | Complete |
| `wave1_auth`         | 1B          | WorkspaceProvider and provider tests                                              | Complete |
| `wave1_query_states` | 1C          | FulfillmentBoard, ProductionBoard, TransferBoard, shared query-state helper/tests | Complete |
| Root                 | Integration | Plan, overlap control, review, browser verification, full test gate               | Complete |

## Wave 1 integration result

Completed on 2026-08-23.

- Dashboard and setup tests: configured screens no longer expose deployment diagnostics, while missing dependency states retain actionable remediation.
- Workspace auth tests: the tenant query is skipped until Convex auth is settled and authenticated, preventing transient false denials.
- Multi-query tests: Fulfillment, Production, and Transfers attribute denials and domain failures to the query that actually failed.
- Verification passed: 73 focused unit tests, 1,561 full unit tests, 82 accessibility tests, TypeScript, scoped ESLint, scoped Prettier, 74 desktop/handheld end-to-end tests, and English/Thai authenticated browser smoke.
- Three consecutive authenticated Dashboard reloads showed no false organization denial, setup-status section, or environment-variable guidance.

## Active Wave 2 ownership

| Owner | Stream      | Primary boundary                                                         | Status   |
| ----- | ----------- | ------------------------------------------------------------------------ | -------- |
| Root  | 2A          | Server-owned navigation grants, desktop/handheld filtering, route icons  | Complete |
| Root  | 2B          | Operational copy and status/empty-state language                         | Complete |
| Root  | 2C          | Independent report outcomes, accessible tabs, shared dates/status labels | Complete |
| Root  | Integration | Code audit, fail-closed refactor, full automated gates                   | Complete |

## Wave 2 integration result

Completed on 2026-08-23.

- The workspace snapshot now returns a bounded set of server-resolved navigation grants. Desktop and handheld navigation fail closed until that snapshot is ready, hide work without the required grants, and still rely on every destination's server authorization.
- Production execution is present in the Order-to-Ship navigation. Primary destinations use distinct icons.
- Reports keep exception, stock, and movement outcomes independent. The stock views implement tab/list/tabpanel semantics, roving focus, arrow keys, Home, and End.
- Shared formatters now own operational date rendering; Production and Order-to-Ship no longer use browser-default locale formatting. Fulfillment and Transfers localize closed-set statuses.
- Developer-facing operational copy was replaced with user outcomes and recovery actions.
- The passing implementation was refactored to reuse one permission set per navigation pass, express composite routes as explicit `ALL`/`ANY` policies, share report outcome rendering, and make the workspace fallback fail closed.
- Verification passed: 2,892 full Vitest tests, 82 accessibility tests, 550 integration tests, TypeScript, ESLint, Prettier, tenant-boundary/workflow/native-select guards, production build, and 74 desktop/handheld end-to-end tests.
- The in-app browser session was signed out after the development build refresh, so a second live authenticated screenshot pass was not claimed. Authenticated role-switch and deep-link E2E remain an explicit next test fixture.

## File-overlap rules

- Only one stream owns `messages/en.json` and `messages/th.json` at a time.
- Navigation and permission work begins only after workspace auth behavior is merged and tested.
- Workflow redesign agents do not edit shared shell/providers.
- Integration/provider work does not start until local workflows have stable commands, statuses, and recovery states.
- Existing uncommitted user files under `docs/plan/**` are out of scope and must remain untouched.

## Verification gates

Every wave must pass, in this order:

1. Focused tests for changed modules.
2. `pnpm test:a11y` for shared UI/shell changes.
3. `pnpm typecheck`.
4. A serial rerun of any full-suite timeout before declaring a behavioral failure.
5. Authenticated browser smoke for changed routes in English and Thai.
6. `pnpm test:e2e` when routing, auth, security headers, or locale behavior changes.

## What should not be parallelized

- Two agents editing the translation catalogues.
- Permission-aware navigation and shell auth changes before the auth seam is stable.
- Engineering page decomposition and master-card data-shape changes by different agents.
- Offline persistence and background job orchestration before command/error semantics are fixed.
- Physical printer/scanner work before preview, evidence, and recovery boundaries are complete.

## Completion definition

The UX backlog is complete only when:

- users never see contradictory setup/auth/permission states;
- operational flows use human references, selectors, and scans instead of database IDs;
- desktop and handheld navigation reflect role and availability;
- long workflows are structured, recoverable, and independently testable;
- Thai, timezone, accessibility, and target-device behavior are verified;
- external adapters and physical operations have release-gate evidence.
