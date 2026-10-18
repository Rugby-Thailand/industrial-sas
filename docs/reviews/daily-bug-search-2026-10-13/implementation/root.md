# Shared clock and completion fixes — 2026-10-13

Baseline: `218493e280bdf25d2aa4cf955048b2c336cfae62`, a local snapshot of the existing workspace. These patches are reviewed as a delta from that snapshot.

## ROOT-01: live HR dates and deadlines

Commit `b4ee2ddf` adds `useHrQuery` to all eleven time-dependent public HR query families and their actual callers. The optional `clockRefresh` argument only invalidates the query subscription; queries and writes still use server time. One shared timer refreshes visible pages at most sixty seconds after a boundary, with immediate focus/visibility refresh and no hidden-page refresh. The timer is released after its last subscriber leaves.

While the replacement query loads, the previous query remains subscribed to the current record, filters and authentication. This retains mounted drafts without keeping an independent stale result cache. Both subscriptions follow argument changes and `skip`. Once the replacement answers, they converge on the same cached query.

Evidence:

- `HrClockRefresh.test.tsx` mounts the real access provider and Today caller. Its transport fixture caches each query by arguments, so changing server time without a DB write does not itself update the screen. With baseline source, the midnight assertion fails: access still displays 2026-10-13. With this patch, access and Today advance to 2026-10-14 after the timer, without a mutation.
- `useHrQuery.test.tsx` covers delayed replacement responses retaining dirty children, reactive revocation of the earlier subscription, record/skip changes, hidden-page resume and timer cleanup.
- The registered backend integration regression verifies that negative/future client tokens do not select the business date and a new token re-reads actual server time without modifying attendance rows.

The fixture verifies subscription invalidation and server authority separately; it does not simulate a deployed Convex websocket or a real overnight browser session. Visible-page freshness is bounded to a minute plus network latency, not exact to the second.

## ROOT-03: original asynchronous completion owner

Commit `e4237d90` captures an immutable owner per scope lifetime. Late results, error callbacks, completion callbacks and request clearing from an earlier owner cannot act on a replacement scope, including A → B → A. Completion explicitly schedules a render so an immediately settled write still hands navigation off after its pending guard clears.

New-building forms are keyed by warehouse, and response-side effects run only after the operation confirms that its owner is still current. The actual caller regression forces a warehouse replacement during a pending create and verifies that A's response cannot navigate B, clear B's draft or keep B pending. Shared hook tests also cover stale error/completion callbacks and returning to an earlier scope name. The exact navigation action inventory references the actual new-building caller test.

## Verification before assembly

- Normal root/HR caller and targeted integration run: 28 files, 160 tests passed.
- Full normal ESLint and TypeScript: passed.
- Navigation: 64 fixture tests; 43 route/error policies, 187 exact owners and 25 navigation intents passed.
- Root completion caller and hook regressions passed. The unchanged whole storage caller suite exposed a separate existing Sheet → editor handoff race; that is being fixed and independently reviewed as ROOT-04 in the inventory follow-up, not hidden as a test flake.
- The combined final candidate receives separate full-suite checks and independent standards/spec review before integration merge.

## ROOT-05: delayed picker focus interrupts search (additional P2)

The combined suite exposed another pre-existing race in the actual JobScanRecords caller: after opening Location assignment, its deferred animation frame could move focus from the search field into the picker just before the user typed. No search change then reached the input handler, and the owned picker history entry remained. The spec reviewer independently confirmed the path.

A deterministic regression holds animation frames, opens the picker, focuses Search, then releases the frame. It fails on the old source because focus moves into the region. The fix captures the opener and performs deferred focus/scroll only if focus still belongs to that opener or the document body. A later user-selected control retains focus. The test then types the search and verifies the picker entry is consumed. The full Records caller file passes 23 tests, including the original search → close → next Back case; navigation and normal full ESLint pass. This finding was discovered during implementation validation and does not alter the frozen 21-issue research ranking.
