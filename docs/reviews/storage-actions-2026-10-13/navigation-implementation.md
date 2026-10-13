# Navigation implementation — warehouse and Storage Layout

Based on origin/main ad22d0b6, retaining its single NavigationGuardProvider, tracked-history wrapper, committed browser snapshots, and useOperationLifecycle. The original dirty workspace is reference-only; its older stacked guard is not copied.

Shared support adds named useWorkflowStep, Back-aware shared Dialog/Sheet, foreground draft scoping, guarded task cancellation/completion, retained origin locale/query/hash, and live operation completion. The newer `run(action, onSuccess)` remains supported: synchronous UI changes belong in onSuccess; use `op.complete(() => completeTask(destination, router.replace))` there or after a successful run. `navigation: "write"` registers pending writes; `"owned"` leaves registration with the existing save-capable caller owner. Rejected, superseded, unmounted, or changed-scope operations cannot publish completion.

Validation at the shared API checkpoint: 114 tests across current NavigationGuardProvider suites, useAsyncOperation, ForegroundBack, ForegroundOrdering, and taskNavigation passed. Targeted ESLint passed. TypeScript passed before the final lint-only adjustment; full checks will run again after F05.

The reference full Back inventory does not match latest main: an initial read-only gate run reports 469 diagnostics, including newer HR/AI routes, reference-only tests, changed single-owner infrastructure functions, and genuinely unowned caller foregrounds. This checkpoint does not assert global gate completion. Gate files remain a separate work-in-progress for individually reviewed current-source reconciliation; no directory exemption or fabricated evidence is introduced.

F05 warehouse switching and caller-level storage integration remain in progress. Runtime tests here use jsdom browser history and mocked writes; they do not establish behavior against real backend data or every physical device.
