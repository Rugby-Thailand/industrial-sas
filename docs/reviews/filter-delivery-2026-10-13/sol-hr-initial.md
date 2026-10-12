# Sol initial HR backend audit

Read-only application audit of the actively edited worker `/Users/macbook/Development/industrial-sas-filter-hr`, based on `11c8c2cc`, October 13, 2026. Reviewed `convex/hr/pagination.ts` and the additive `setup.ts` endpoints; inspected their tenant database, membership-directory and site-scope dependencies. Worker changes were not integrated and Kiro was still writing. This is not the final full-HR/UI review. No product edits, browser, production calls, commits or deployment.

## Mandatory finding

**P1 — Employee pagination cannot reach employees at authorized sites after the first 50.**

`setup.ts:143` constructs lanes using `scopedSites(ctx, await siteScope(ctx))`. `shared.ts:135–151` returns only `MAX_SCOPE_SITES` active sites for an organization-wide actor; `shared.ts:103–120` also caps a warehouse-scoped actor's grants. The optional requested site is filtered **after** that cap (`setup.ts:144–148`). Thus an organization-wide administrator requesting a valid active site sorted 51st receives `SITE_UNAVAILABLE`, although `siteOf` would authorize it, and unfiltered pagination never includes that site's employees. `sitesComplete: false` makes the limitation explicit but does not provide reachability.

Reproduction logic: create 51 active sites in one organization in increasing code order, place a uniquely named employee only at site 51, and use an `ORG_WIDE` HR administrator. Call `setup.employeesPage` with no site and walk every logical/scan cursor; the employee is never returned. Call it with that site's ID; it returns `SITE_UNAVAILABLE`. Repeat search with the late employee's unique name; it settles without that authorized match. This finding is established by source control flow; this initial audit did not seed a real Convex fixture for it.

Required fix: selected-site authorization must resolve the requested site independently of a capped option list. Cross-site list traversal/options must also offer complete authorized-site continuation, or otherwise eliminate the cap through a bounded resumable traversal. Keep site authorization conservative on every retained ID; do not simply raise 50 or widen warehouse-scoped grants. Tests must cover both organization-wide and warehouse-scoped >50-site reachability/revocation.

## Ordering observation, not a completeness blocker

`activeMembersPage` traverses `by_orgId_status_userId`, then sorts display names within each returned page (`setup.ts:392–397`). Traversal remains deterministic by account ID and complete; this does not create duplicate/skipped records for a stable dataset. It differs from old `accessMembers`, which globally sorted its complete array by name. Treat this as an ordering/UX decision. Do not advertise global alphabetical order from this result, and do not introduce a maintained name projection merely to retain alphabetical presentation unless that is the chosen contract. A page size change naturally changes these local alphabetical groupings.

## Authorization and continuation assessment

- New queries remain behind `queryWithOrg` and `hr.admin.manage`; all index/get operations use `ctx.tenantDb`. Member names are resolved through the current organization's membership directory, including effective dates and active user status. The new member endpoints preserve the old organization-wide member visibility contract and continue hiding employee linkage details outside the actor's site scope.
- Cursor scope binds organization, actor, surface, criteria and page size. The current lane must still belong to the current authorized lanes; otherwise the helper returns `reset` (`pagination.ts:168–173`). Retained rows are loaded again through tenant access and passed through the endpoint match predicate before hydration (`pagination.ts:255–266`). Employees recheck current site/status/search; holidays recheck site/year; audit rows recheck exact employee/entity and allowed-change criteria. Endpoint-level employee/site authorization is also performed again.
- Unsigned continuation IDs are not an access bug by themselves. An authorized user editing their own lane/order/pending IDs may change their own traversal, while IDs that fail current tenant/endpoint checks remain hidden. This initial audit found no concrete unauthorized-row disclosure in these endpoints.
- Carrying overflow IDs avoids silently discarding matches from a 99-row chunk. Native split state is reused through `advanceNativeRange`. The helper performs one native page plus up to eight bounded `take` peeks; it does not issue multiple native paginate calls in one request.
- Changed/deleted retained matches can shorten a ready page: revalidation occurs after choosing the logical slice, and invalid IDs are dropped. A short or empty page with continuation must remain navigable and must not become final “no records.” This is an expected client contract to verify, not evidence that the UI currently mishandles it.
- New endpoints are additive. Original `listEmployees`, `employeeHistory`, `memberOptions`, `listHolidays` and `accessMembers` contracts remain in place, so the reviewed additions preserve old-client entry points. Shared page sizes are explicitly 20/50 and unsupported sizes are refused. Generated references/public contract fixtures and callers were unfinished and were not treated as final defects.
- Holiday-year filtering currently starts at newest site date and scans past later years until reaching the selected one (`setup.ts:667–679`). It is complete but can require many continuations for an old year; indexed date-range performance is a separate pending plan requirement. This is not an authorization or late-record omission.

## Read-only probe executed

The helper was imported directly with `/Users/macbook/.bun/bin/bun --no-env-file -` and exercised against an in-memory `tenantDb` adapter. No source/test file was written in the worker. The shell's bare `bun` was absent from PATH; retrying the installed absolute executable succeeded.

Command shape, from the HR worker directory:

```sh
/Users/macbook/.bun/bin/bun --no-env-file - <<'TS'
import { hrScanPage } from './convex/hr/pagination.ts';
// Two index lanes: A has 121 rows, B has 1,000; each ordered by n.
// Adapter page slices at its numeric cursor, take returns a bounded prefix,
// get retrieves IDs, and tenant scope is { organization: 'org', actor: 'actor' }.
// Match n % 10 === 7; pageSize20, chunk99. Follow scanCursor while scanning,
// then collect ready rows and follow continueCursor until isDone.
// Assert IDs equal the entire ordered matching universe and count native calls.
// Start an unfiltered page, then: remove current lane; narrow row authorization;
// change actor. Assert reset / no unauthorized retained rows / reset respectively.
TS
```

Actual output:

```json
{"scenario":"sparse multi-lane traversal","rows":1121,"matching":112,"requests":13,"maxNativeCalls":1,"duplicates":0}
{"scenario":"continuation reauthorization","revokedLane":"reset","revokedRetainedRows":0,"changedActor":"reset"}
```

The probe confirms stable in-memory traversal beyond the old 99/200-row caps and the helper's revalidation branches. It does **not** prove real Convex grant enforcement, native cursor integrity, split/recommended/reactive-page behavior, site51 reachability, frontend restoration or production latency. Those require the final endpoint integration tests and full diff review after Kiro finishes. No passing source audit should substitute for those tests.
