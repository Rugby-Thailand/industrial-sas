# Business dates and timezones manual

Status: **Domain library, used by ledger posting.** Validated business dates, fixed
organization timezones, date arithmetic, instant conversion, and Gregorian/Buddhist
display formatting are implemented. Organization settings UI is not implemented.

## Who this is for

- Organization administrators choosing operating timezone/locale
- Developers recording transaction business dates
- Report and UI developers displaying Thai dates

## Core rule

Store and compare business dates in Gregorian `YYYY-MM-DD`. Buddhist Era is display
only and adds 543 to the display year. Never store a Buddhist Era year in ledger,
lot, or audit fields.

The default organization timezone is `Asia/Bangkok`. Ledger posting derives
`businessDate` from the server `occurredAt` instant and the active organization's
timezone; clients cannot backdate it.

## Supported zones

The pure module uses a code-owned fixed-offset zone registry, currently including
`Asia/Bangkok` and `UTC`. Unknown organization timezone values cause a named refusal
instead of falling back to the host machine timezone.

## Date input procedure

1. Accept or construct a Gregorian ISO date.
2. Parse with `parseBusinessDate` or construct with `makeBusinessDate`.
3. Reject impossible month/day combinations and years outside 1970–2999.
4. Store the normalized Gregorian value.
5. Choose `GREGORIAN` or `BUDDHIST` only when formatting for display.

## Instant conversion procedure

1. Read the organization's configured timezone.
2. Resolve it with `zoneById`.
3. Convert the server epoch-millisecond instant using `businessDateFromInstant`.
4. Store `businessDateToIso(result)` on the immutable transaction header.

Do not use `new Date("YYYY-MM-DD")`, host locale, `Intl`, or browser timezone to
decide the business date. Different hosts must produce the same answer.

## Operational examples

- A posting at `2026-08-11T17:30:00Z` belongs to 12 August in Bangkok, not 11
  August.
- Gregorian `2026-08-12` displays as Buddhist Era year 2569 when that calendar is
  selected, while storage remains `2026-08-12`.
- Stock expiring on `2026-08-12` is not expired during the business date 12 August;
  it becomes expired when the as-of date is later.

## Date arithmetic

Use the domain functions for comparing dates, adding days, calculating distance,
finding month end, and converting start-of-day to an instant. Every public operation
revalidates inputs and returns a `Result`; handle errors instead of casting.

## Troubleshooting

- Transaction appears on the wrong day: compare server instant, organization
  timezone, and Bangkok boundary; do not inspect only the browser clock.
- Year is 543 years wrong in storage: a display calendar leaked into persistence.
- Invalid organization timezone: correct the setting through a controlled migration;
  do not silently default existing data.
- GS1 two-digit year resolves unexpectedly: ensure the parser receives the intended
  explicit reference year.

## Implementation references

- `convex/model/time/businessDate.ts`
- `convex/model/gs1/date.ts`
- `convex/lib/organizationDefaults.ts`
- `convex/lib/inventoryLedgerStore.ts`
- [Thai-first UX ADR](../adr/0010-thai-first-i18n-and-accessibility.md)
