# Production daily bug reconciliation

Production base: `59fb1d134dfc56bb0ce2c0fbc874c41c2741d92f`.
The original daily audit identified 21 confirmed issues and two caller races during validation: 23 items, ranked P1: 3, P2: 11, P3: 9. This release reconciles those fixes with the newer production branch; it does not merge the unrelated local workspace snapshot.

## Scope and ranked coverage

| Rank | Area                     | ID       | Required behavior                                                                                                                                  |
| ---- | ------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1   | HR write recovery        | DAILY-01 | Remounts retain pending command ownership; cold recovery cannot replay new input under an old request ID or confirm an earlier clock as today's.   |
| P1   | Inventory concurrency    | INV-04   | A stale legacy pallet measurement cannot overwrite a newer save.                                                                                   |
| P1   | Layout idempotency       | INV-02   | An old zone retry cannot rewrite newer child geometry. Preserve the production fix.                                                                |
| P2   | Inventory concurrency    | INV-03   | Product edits retain their loaded baseline and conflicting draft. Preserve production's monotonic updatedAt implementation.                        |
| P2   | HR authorization         | KIRO-03  | Unlinking/relinking cannot enable attendance or shared leave self-review, including retained legacy affiliations.                                  |
| P2   | HR bounded reads         | KIRO-05  | Employment overlap is applied before period/queue workflow employee limits. Incomplete reads are explicit.                                         |
| P2   | Quantity validation      | INV-05   | Discrete quantities reject fractional units consistently.                                                                                          |
| P2   | Acquisition limits       | INV-09   | Every ticket acquisition and submission path enforces the shared 50-ticket maximum atomically.                                                     |
| P2   | Layout idempotency       | INV-01   | Exact authorized retries resolve before mutable status/version checks, including schematic approval.                                               |
| P2   | HR draft protection      | KIRO-10  | Live employee versions cannot remount and discard dirty forms.                                                                                     |
| P2   | HR time freshness        | ROOT-01  | Live server-clock queries refresh without unmounting drafts. Preserve clock-free access display and frozen-period queries.                         |
| P2   | Task navigation          | DAILY-02 | Back to Today consumes the customization task and preserves real origin intent.                                                                    |
| P2   | Mobile navigation        | ROOT-04  | Inspector history and focus are released before the editor opens. Preserve current shared Sheet handoff.                                           |
| P2   | Search navigation        | ROOT-05  | Deferred picker focus respects the user's new input; invalidated history traversal retains every later keystroke, query and hash.                  |
| P3   | Correction precision     | KIRO-07  | Untouched correction timestamps retain original seconds and milliseconds.                                                                          |
| P3   | HR result completeness   | KIRO-11  | All bounded open-day results remain reachable. Preserve current pagination rather than rendering a truncated slice.                                |
| P3   | Layout inheritance       | INV-06   | Omitted floor offsets clear saved overrides consistently with validated inheritance.                                                               |
| P3   | Search pagination        | INV-07   | Stable cursor boundaries and truthful continuation. Preserve production's bounded scan/keyset implementation.                                      |
| P3   | Shortcut state           | DAILY-03 | Clean editors adopt live preferences; dirty drafts retain their baseline and confirmed remount receipts advance it once.                           |
| P3   | Async ownership          | ROOT-03  | Old callbacks cannot adopt a new workflow, including A→B→A; warehouse replacement cannot keep the previous form draft.                             |
| P3   | Request links            | ROOT-02  | Malformed, missing, wrong-table and foreign personal request IDs return the same scoped NOT_FOUND result.                                          |
| P3   | Search coverage          | INV-08   | Job search includes displayed location names. Preserve current normalized search.                                                                  |
| P3   | Photo resource ownership | INV-10   | Unsubmitted Blob URLs are released; transferred preview ownership and late callbacks remain safe. Preserve current photo selection implementation. |

The five original policy questions are excluded: retroactive employment dates, organization-wide HR administration policy, live historical schedules/holidays, correction closure of an open shift, and prior-year inference.

## Performance and compatibility

- Review identity history is cached within one authorized request. Two leave requests for one employee perform one legacy affiliation audit read. A page of twenty former employees avoids all holiday, day and affiliation reads.
- Existing bounded inventory pagination, location-name search, monotonic product versioning, photo ownership and mobile handoff improvements are retained.
- Shared clock invalidation is opt-in for live time-dependent reads, with one visible-page timer, immediate resume and retained reactive subscriptions. Access display and frozen previews keep their existing clock-free optimization.
- Layout retry adapters are simplified only within the existing authorization/idempotency boundary.
- New schema fields and query/mutation arguments are optional. The public validator compatibility check refuses breaking changes; no breaking override is used. Legacy fresh measurement writes lacking a loaded baseline receive a conflict, while exact completed retries still succeed.

## Release verification

Implementation details are recorded in the accompanying reports. The pull request records independent reviewer decisions and the final commit-specific CI results. The repository's existing automatic release pipeline requires quality/security checks, a Convex backup, staged production candidate smoke, promotion of that same deployment and live smoke. Its existing `STAGING_ENABLED=false` setting is preserved, so this release does not claim an authenticated staging write suite.

Original uncommitted workspace files are not staged or overwritten by this release.
