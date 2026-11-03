# Leave period reuse and refusal order — 2026-11-03

`periodLockReader` is created within each preview/submission, approval/cancellation
confirmation or adjustment execution. Its callers do not write `hrPeriods`.
It lazily reads the authorized warehouse's periods ending on or after the minimum
requested date and retains index order. Dates are checked in caller order.
Earlier employment and attendance validation therefore retains its position.

Limit-enabled public-handler regressions in
`tests/integration/hr-policy-leave.integration.test.ts` establish:

- Three-day operations read the relevant range once and return two period
  documents despite 1,080 expired periods. Preview, submission, approval,
  cancellation confirmation and unsorted restoration all exercise this bound.
- Overlapping and overlong legacy periods retain CLOSED/CLOSING refusal codes.
  A newer draft does not hide a lock. Last-date refusals do not partially change
  leave balances or attendance.
- Reversed restore dates still use the earliest supplied date as the lower
  bound while returning the first refusal in the supplied order.

## Exceptional capacity fallback

A reversed restore can start on a later, locked date while more than 1,000
periods end between that date and the earlier requested date. The combined
minimum-date range then exceeds the existing cap, even though the original
first-date lookup would have returned its lock. The regression initially failed
with `CAPACITY_DATA_LIMIT` instead of `HR_PERIOD_CLOSED`/`HR_PERIOD_CLOSING`.

Only `TenantDbError` with code `CAPACITY_DATA_LIMIT`, from a combined range that
starts earlier than the first checked date, triggers a fallback. The reader then
uses the existing bounded per-date lookup in original order. It does not catch
tenant authorization errors, other database errors or runtime transaction-limit
errors. The 1,000-period cap is unchanged.

The two CLOSED/CLOSING regressions now observe two ranges and 1,002 documents:
1,001 documents from the rejected combined range plus the one-row first-date
lookup. After reopening that first-date lock, both tests still refuse with
`CAPACITY_DATA_LIMIT` on the earlier date, leaving leave balances unchanged.
Exceptional operations can therefore repeat reads and may still safely refuse
at transaction limits. Normal supported operations retain one period range.
