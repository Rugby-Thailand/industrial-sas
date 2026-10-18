# `convex/model` — domain modules

This directory keeps **reusable TypeScript domain logic separate from Convex
handlers**: validation, arithmetic, parsing, and decisions over supplied values.
No module imports the Convex runtime or reads or writes the database. Most of the
code is pure; everything needed to make a domain decision arrives as an argument.

There are two qualifications to that boundary. `finishedGoods/scanning.ts` uses
generated Convex document and id types, so its types are tied to the schema.
`search/provider.ts` is an I/O adapter: it makes the AI Search request and owns its
timeout. Neither is a reason to put database access into a domain validator.

That is not stylistic. Three things depend on it:

- **Testability.** Domain rules can be exercised with ordinary function calls,
  without a database harness. The provider adapter accepts a transport supplied
  by the test, so failure handling can be checked without a live AI service.
- **Determinism inside a mutation.** A Convex mutation may be re-executed. Domain
  decisions must not depend on an ambient clock or randomness. `evaluateDay`
  takes `now`, and `readDates` takes the business date against which relative
  words are read. The same inputs can therefore reproduce the same decision.
- **Lock-in containment.** The rules that decide whether a quantity is valid,
  whether a box fits, or what an attendance day means should survive a change of
  backend. Keep storage and service orchestration outside those rules.

## What is here

| Module                                   | Owns                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `result.ts`                              | Shared `Result<T, E>` success/failure values with shallow-frozen wrappers               |
| `guards.ts`                              | Structural guards and the shallow-frozen containers a `readonly` type cannot give       |
| `authorization/navigationPermissions.ts` | Storage-layout and HR permission codes that gate navigation and handlers                |
| `finishedGoods/jobScans.ts`              | Job-ticket (FM-PD-02) AI schema, prompt, field parsing, and barcode/code checks         |
| `finishedGoods/locationImage.ts`         | Location-label photo AI schema, prompt, candidate parsing, and image-size validation    |
| `finishedGoods/packing.ts`               | Packing quantities in integer thousandths, package splits, and packing validation       |
| `finishedGoods/placement.ts`             | Millimetre boxes and surfaces, overlap and placement errors, and first-fit placement    |
| `finishedGoods/scanning.ts`              | Scan-assignment types and group/fill checks; imports `Doc`/`Id` types from `_generated` |
| `gs1/checkDigit.ts`                      | The GS1 modulo-10 check digit (GTIN, SSCC)                                              |
| `hr/calendar.ts`                         | ISO business dates, local minutes, and instants in fixed-offset organization zones      |
| `hr/schedule.ts`                         | One-shift-per-day schedules and the planned day they produce                            |
| `hr/attendance.ts`                       | One employee day's status, effective interval, minutes, and certification validity      |
| `hr/employee.ts`                         | Employee code, name, employment-range, and reason input rules                           |
| `hr/period.ts`                           | Bounded attendance periods: complete row set, totals, and close readiness               |
| `hr/csv.ts`                              | Attendance CSV v1 export (UTF-8 BOM, RFC 4180, formula neutralisation)                  |
| `identifiers/normalization.ts`           | Raw scan, SKU, lot code, and GTIN normalization                                         |
| `inventory/requestIdentity.ts`           | UUIDv7 request IDs, operation names, request namespaces, and canonical argument text    |
| `search/text.ts`                         | Search text normalization shared by menu matching, HR resolvers, and AI grounding       |
| `search/dates.ts`                        | Deterministic Thai/English date expressions and ranges against a supplied business date |
| `search/references.ts`                   | Employee-code, date, version, and selected-record references in the user's own words    |
| `search/intent.ts`                       | The allowlisted AI navigation intents, their validation, and grounding in the query     |
| `search/provider.ts`                     | The single OpenRouter chat request behind AI Search                                     |
| `storageLayout/storageLayout.ts`         | Building/floor/reserved-block validation and layout summaries                           |
| `storageLayout/storageZone.ts`           | Storage-zone rectangles, containment/overlap validation, stack planning, codes and QR   |
| `storageLayout/storagePosition.ts`       | Area modes, position validation, rack position generation, and position QR values       |
| `storageLayout/occupancy.ts`             | Occupied floor footprint as a rectangle union                                           |
| `storageLayout/areaUsage.ts`             | Stored and held footprint usage per zone                                                |
| `storageLayout/areaColor.ts`             | Normalization of supported `#RRGGBB` area colors                                        |
| `storageLayout/fg1ApprovedPlan.ts`       | The approved FG1 layout revisions as millimetre cells and blocks                        |
| `storageLayout/pdApprovedPlan.ts`        | The approved PD layout revision as millimetre cells and blocks                          |

## The boundary a cast cannot walk through

TypeScript erases its types. These modules receive values from Convex documents,
HTTP bodies, scanners, and AI responses, so their inputs can violate a declared
type just as easily as a cast can:

```ts
const day = "2026-02-30" as IsoDate; // compiles; the date does not exist
const size = { lengthMm: NaN, widthMm: 800, heightMm: 600 } as MeasuredSize;
const scan = 42 as unknown as string; // compiles; it is still a number
```

Four rules guide this boundary. Their scope matters; the directory does not have
one universal return type or a guarantee that every output is deeply immutable.

1. **Validate at the public boundary.** `normalizeRawScan` and
   `verifyGs1CheckDigit` check that their inputs really are strings.
   `normalizeCode` also checks its options: the length bound must be a positive
   safe integer and the case-folding policy must be supported. `dayNumber`
   refuses an impossible date with `null`, and `quantityToMinor` refuses
   non-finite numbers and unsupported quantity precision with `null`. A declared
   type is not evidence that those checks have happened. Some helpers assume
   validated inputs: `compareDates`, for example, compares ISO strings
   lexicographically. Callers must validate before using that ordering.
2. **Domain errors are values, and work must terminate.** Validators commonly
   return a `Result`, an error code, or `null`; callers handle the failure rather
   than discovering it in arithmetic or rendering. `gs1CheckDigit` bounds its
   input before iterating, and `canonicalArgumentText` caps recursive depth and
   rejects non-finite numbers and unsupported values. A limit is a rejection,
   not permission to return a partial answer. This is not a claim that nothing
   throws: `addDays` and `fromLocal` throw on invalid arguments, and
   `parseLocationLabel` throws `AI_UNREADABLE` for malformed model output. Their
   callers must honor those contracts and translate failures at the I/O boundary.
3. **What is shallow-frozen, and what is not.** `readonly` is a compile-time
   claim. `frozenArray` copies and freezes an array; `frozenRecord` builds a
   frozen null-prototype lookup. The timezone registry uses the same kind of
   lookup, so inherited names cannot masquerade as supported zones. `ok` and
   `fail` freeze only the `Result` wrapper: neither freezes the value or error
   carried inside it. `validateStorageZone` explicitly freezes its returned
   candidate, while `validateSchedule` freezes the schedule record but leaves its
   copied `workDays` array mutable. Other modules return plain arrays or objects.
   `Object.freeze` is shallow; immutability extends only as far as the builder
   actually freezes, and a type annotation cannot extend that guarantee.
4. **Translate dependency failures at the adapter boundary.**
   `requestSearchIntent` accepts an injected `fetcher` and a timeout. A thrown
   transport error or unsuccessful HTTP response becomes `AI_UNAVAILABLE`; an
   abort becomes `AI_TIMEOUT`; malformed JSON or an invalid intent becomes
   `AI_UNREADABLE`. These are failed results rather than transport exceptions
   escaping to the caller. The adapter owns the request and abort timer, while
   intent validation remains ordinary logic over returned values.

Two semantic rules exist for the same reason — a plausible reading is not an
acceptable answer:

- **A business date belongs to the organization's timezone.**
  `timezoneOffsetMinutes` accepts only the fixed-offset zones the calendar
  implements; a zone with daylight-saving transitions is refused rather than
  approximated. Relative search dates use the supplied business date, so a
  browser's timezone cannot quietly change what "yesterday" means.
- **AI output needs evidence from the user's words.** `parseModelIntent`
  validates an allowlisted shape; `groundIntent` then checks employee references
  against the query and reads dates deterministically. A model-invented employee
  code is dropped even if a record with that code happens to exist. The selected
  record is usable only when the query refers to it and the corresponding
  selection is available; a model flag alone is not evidence.

## What is deliberately absent

- **Ledger posting.** `inventory/requestIdentity.ts` validates request identity,
  encodes namespaces, and renders canonical argument text. It does not post a
  transaction, compute a balance, or enforce idempotency against stored requests.
- **Persistence.** These modules do not read or write tables. Employee-code
  uniqueness, account links, and cross-organization references need the Convex
  layer that owns the data. A valid draft is not proof that a write is authorized
  or that a referenced record exists.
- **Money.** Packing quantities are not currency. This directory has no money
  type or currency-scale policy; its quantity precision must not be reused as one.

## Conventions

- State what the caller must validate, what signals failure, and what is frozen.
  Use the module's actual contract rather than assuming every operation returns
  a `Result` or every returned array is immutable.
- Errors use stable codes, sometimes with structured fields; the UI owns their
  translation. Keep transport details and user-facing prose out of domain errors.
- Keep arithmetic in its documented units. Packing allocates integer thousandths;
  `quantityToMinor` checks that converting back reproduces the input and that
  piece units are whole. `splitEqually` distributes remainders without changing
  the total. Attendance's `workedMinutes` counts whole elapsed minutes and
  subtracts the unpaid break. There is no universal rounding policy to borrow.
- Keep calendar arithmetic independent of platform date parsing and browser
  locale. Validate dates before ordering them, and supply the organization's
  offset and current business date explicitly.
- Bound work where inputs enter: package splits allow at most 50 packages, rack
  generation validates its counts and dimensions, and attendance periods are
  limited to 31 days. A caller must not interpret a rejected input as an empty,
  successfully completed operation.
- Document support limits. The HR calendar header explains its fixed-offset
  restriction, and schedules support one shift per employee per business date.
  A parser that claims an unimplemented format is worse than one that rejects it.
