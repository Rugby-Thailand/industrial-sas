# Dashboard, occupancy, and exports

**Availability: application surface; unauthenticated.** The screens run, the
counters are maintained by the real mutations, and the exports walk real tables —
but with no configured Clerk instance every tenant-bound call is denied, so no
tenant's numbers have ever been displayed.

This manual covers the Phase 4 reporting surfaces: the dashboard counters, the
2D occupancy map, and the asynchronous export jobs
([ADR-0011](../adr/0011-async-jobs-reporting-and-observability.md)).

## What exists

### Domain kernels (`convex/model/reporting/**`, no Convex imports)

| Module         | What it decides                                                     |
| -------------- | ------------------------------------------------------------------- |
| `rollup.ts`    | Counter arithmetic, subject keys, drift comparison, clamp reporting |
| `occupancy.ts` | Bucket-count → band, grid layout, band tallies                      |
| `csv.ts`       | RFC 4180 quoting, formula-injection guarding, BOM, byte accounting  |

### Convex functions

| Function                            | Permission                 |
| ----------------------------------- | -------------------------- |
| `reporting/dashboard:readDashboard` | `reporting.dashboard.read` |
| `reporting/dashboard:readOccupancy` | `reporting.dashboard.read` |
| `reporting/rollups:verifyRollups`   | `reporting.jobRun.read`    |
| `reporting/rollups:repairRollup`    | `reporting.export.execute` |
| `reporting/exports:requestExport`   | `reporting.export.execute` |
| `reporting/exports:runExportChunk`  | `reporting.export.execute` |
| `reporting/exports:getReportJob`    | `reporting.export.read`    |
| `reporting/exports:listReportJobs`  | `reporting.export.read`    |

### Screens

| Route                 | Shell   | What it does                                 |
| --------------------- | ------- | -------------------------------------------- |
| `/{locale}/dashboard` | Desktop | Waiting-work counters and the occupancy map  |
| `/{locale}/reports`   | Desktop | Request an export, advance it, take the file |

## The counters, and why they are maintained rather than counted

A dashboard is the screen opened most often, and "how many receipts are open?"
reads naturally as a `count`. That count is a scan of the tables that grow
fastest, and it gets slower exactly as the pilot gets busier — which is why
`INV-0011-07` forbids it.

So each number is a **maintained counter** in `operationsRollups`, moved in the
same transaction as the domain change that earned the move:

| Metric                 | Moves when                                         | Kind        |
| ---------------------- | -------------------------------------------------- | ----------- |
| `RECEIPTS_OPENED`      | a receipt is created (never on a replay)           | cumulative  |
| `RECEIPT_LINES_POSTED` | a line is posted                                   | cumulative  |
| `QC_PENDING`           | an inspection opens, or leaves the queue           | backlog     |
| `QC_PARKED`            | a disposition parks for a second person, or clears | backlog     |
| `PUTAWAY_READY`        | a task is created, or claimed                      | backlog     |
| `PUTAWAY_CLAIMED`      | a task is claimed, or confirmed                    | backlog     |
| `LOCATION_OCCUPANCY`   | a balance bucket crosses zero at a location        | per-subject |

Two of them are cumulative totals rather than backlogs, and the tiles say so.
A receipt has no `status` column — there is no "close receipt" — so
`RECEIPTS_OPENED` counts what it says: receipts opened at this site, ever.
Calling it "open receipts" would have been a number that only ever grew while
implying a queue that never drained.

### Three properties that make a number worth reading

**A replay never counts twice.** `openReceipt` increments only when the write
actually created a row. A handheld retrying through a dropped connection replays
correctly, and a counter that climbed anyway would have been measuring network
quality.

**A wrong counter never stops a dock.** If the arithmetic is wrong, refusing the
posting would be the wrong trade: an operator cannot fix a rollup, and a
warehouse that stops receiving because a display number is off has failed much
worse. So a decrement that would go below zero clamps at zero and records
`underflowAt`; the tile then shows the number **and says it is suspect**.

**Every counter is recomputable.** `verifyRollups` derives each metric from the
tables that define it and reports agreement as well as drift — "checked and
fine" and "not checked" are different operational states. `repairRollup` writes
a freshly derived value, and it is a separate mutation on purpose: a read that
silently corrected what it found would make drift undetectable, because every
run would report balanced having just erased the evidence.

Occupancy is excluded from `verifyRollups`: it has one counter per location, and
walking those belongs to a scheduled job rather than to a query a supervisor
triggers. Saying so beats a report that implies it checked.

**Verification is bounded to one read per metric, and says when that was not
enough.** A Convex function execution may perform only one indexed read with a
continuation, so the verifier counts with a single `.take()` capped at the tenant
page size rather than paging. A metric whose source exceeds that cap is reported
as `incomplete` and left out of the comparison entirely — a lower bound cannot
disprove a counter, and a verifier that treated a capped page as a total would
report drift on every busy site. An earlier version paged five times per metric;
it worked on a small site and failed with an internal error on any real one.

## The occupancy map

A flat grid of the site's locations in code order, banded `EMPTY` → `LIGHT` →
`BUSY` → `FULL` by how many distinct stock buckets each holds.

**Buckets, not quantity.** 900 kilograms of steel coil and 900 bolts do not
occupy comparable space, and a map that added them would be confidently wrong. A
bucket is one (item, lot, status, handling unit, owner) combination physically
present — a count of things to walk past.

**Order is stable.** The map's only real use is noticing that a _particular_
aisle is full, so cells are drawn in location-code order and do not move between
refreshes.

**Colour is never the only channel.** Every cell prints the location code, the
band as a word, and the bucket count. The fill is redundant, which keeps the map
readable in greyscale, in direct sun on a dock, and to a screen reader
(`WCAG 2.2` 1.4.1). The four fills are design tokens with text contrast above
4.5:1 in both colour schemes (1.4.3).

**A capped map admits it.** The read is bounded, and a site with more locations
than one page shows a warning. "That aisle is empty" and "that aisle is not on
this map" are opposite instructions.

### A deviation from ADR-0011 §8, stated

The ADR says "2D SVG heat map". What ships is a `<table>`. The decision being
made — flat and accessible rather than Three.js (D-28, `INV-0011-11`; `three` is
absent from the dependency graph) — is honoured. A table then does better than an
SVG would: a warehouse map _is_ tabular data, so keyboard traversal, row and
column announcement, zoom, and text selection come for free, where an SVG needs
each reimplemented as an ARIA parallel that can drift from what is drawn.

## Exports

An export is a **job**, not a download button. "Give me this warehouse's balances
as a spreadsheet" reads as one call that walks a table, and that call is the one
that times out on the tenant with the most data — which is the tenant most
likely to have asked.

1. `requestExport` creates a `reportJobs` row and returns. One job per request:
   a repeated request replays the job it already created rather than starting a
   second walk (`INV-0011-02`). A request ID reused with a _different_ warehouse
   or kind is refused with `REQUEST_ARGUMENT_CONFLICT` — that is not a retry, and
   answering with the earlier job would hand a balances extract to somebody who
   asked for putaway tasks. It would look like a successful export until read.
2. `runExportChunk` advances it by one bounded page, appending rendered rows and
   storing the cursor **in the same transaction**, so a retry re-runs a chunk
   that either committed entirely or not at all.
3. `getReportJob` returns the artifact, behind `reporting.export.read` — a
   different permission from running an export, because generating a stock
   extract and reading one are different privileges.

### The CSV is written for the spreadsheet it will be opened in

- **Quoting** per RFC 4180. A Thai supplier name with a comma in it silently
  shifts every later column otherwise, and nobody reads the misalignment as
  corruption — they read the wrong number.
- **Formula injection defused.** A field starting `=`, `+`, `-`, `@`, tab, or
  carriage return is prefixed with a single quote. `=cmd|…` in an item code is
  code running on a supervisor's laptop. The value is preserved exactly, so the
  export stays evidence.
- **A byte-order mark and CRLF.** Without the mark, Excel decodes UTF-8 Thai as
  Windows-874 and every product name becomes mojibake.
- **Bytes, not characters.** Thai is three bytes per character, so a
  character-counted cap would be a third of the intended size in the product's
  first language.

### Receipt lines walk two levels, one cursored read at a time

A receipt line has no warehouse of its own, so the walk is this site's receipts
and then each receipt's lines. A cursor over receipts alone cannot say "halfway
through receipt 47" — and the first implementation took a fixed number of lines
per receipt, so a delivery with more lines than the page size **silently lost the
rest** while the finished file looked complete.

The position is now a record (`convex/model/reporting/exportCursor.ts`): the
parent cursor, whether the parent walk is exhausted, the receipt being drained,
and the cursor within it. Because an execution may perform only one indexed read
with a continuation, a chunk does exactly one of two things — advance to the next
receipt, appending nothing, or drain a page of the current receipt's lines. The
step is decided from the stored position, so the rule is checkable rather than
remembered.

Two consequences worth knowing:

- A large export takes one extra call per receipt, and the row count does not
  move on those calls. The job stays `RUNNING`; it is not stuck.
- `parentDone` is stored explicitly because "no parent cursor" means both _start_
  and _end_. Reading exhaustion as a start re-exported the first receipt for
  ever.

An unreadable stored position fails the job with `CURSOR_UNPARSEABLE` rather than
restarting: restarting would duplicate every row already written.

### What a stopped export means

`ARTIFACT_LIMIT_REACHED` means the file _would have been incomplete_, and the
job fails rather than truncating. A spreadsheet that looks complete and is not is
the worst outcome this feature can have — somebody counts stock from it. The
register shows the code and offers no download.

## Where delivery stops, precisely

`INV-0011-08` requires artifacts to be private and delivered through a
short-lived signed URL. That is `FileStoragePort`
([INT-08](../integration-contracts/file-storage-port.md)), whose vendor is not
configured. There is no signed URL and none is pretended.

The artifact lives on the job document and is fetched through a
permission-checked query, then saved by the browser as a local blob. That is a
**narrower** channel than a signed URL, not a substitute claim: it cannot be
forwarded as a link and cannot be opened by an unauthenticated fetch. The screen
says exactly this, because "downloaded" and "delivered through a signed URL" are
different security claims.

The consequence is a real cap — a document has a size limit, so the artifact
does too. A production-scale export needs the storage vendor.

## What is deliberately absent

**A reachable advance control requires a provisioned tenant.** `ServerAdvance`
runs once the workspace resolves; it handles ran, refused, denied, and transport
failure outcomes, each announced through `role="alert"`.

**A scheduled runner.** Chunks are advanced by a control the operator presses,
one bounded page per press, with the row count moving where they can see it. The
production shape is a Workflow/Workpool worker (`INT-06`), whose vendor
components are not provisioned. A visible button that does one page is honest
about which of those exists.

**Low stock and reconciliation health.** The first needs a per-item reorder
policy no table holds; the second is the ledger reconciliation job's own report
rather than a tile. Both were in the plan's §2.1 sketch and neither is claimed.

**XLSX and PDF.** CSV only. XLSX needs a spreadsheet writer and PDF needs a Thai
font embedded for the same reasons the label templates do; both are additions to
this job shape rather than changes to it.

**Occupancy verification.** Stated above: per-location counters are not compared
by `verifyRollups`.

## Verification

| Tier        | File                                                         |
| ----------- | ------------------------------------------------------------ |
| Unit        | `convex/model/reporting/{rollup,occupancy,csv}.test.ts`      |
| Property    | `tests/properties/reporting.property.test.ts`                |
| Integration | `tests/integration/reporting.integration.test.ts`            |
| Isolation   | `tests/isolation/reporting.isolation.test.ts`                |
| Component   | `src/features/reporting/{Reporting,AdvanceControl}.test.tsx` |
| A11y        | `src/features/reporting/Reporting.a11y.test.tsx`             |
| E2E         | `tests/e2e/reporting.preview{,.handheld}.e2e.spec.ts`        |

The property suite states the two claims that fixtures cannot: a rendered CSV
round-trips through an **independent** RFC 4180 reader for any text a tenant
could type, and a counter never reads negative for any sequence of deltas. Both
have negative controls that assert the property _fails_ against a deliberately
broken implementation.

The integration suite drives the real mutations — open a receipt, post a line,
park a disposition, claim a task — and then compares each tile to a fresh
derivation. That is the claim the dashboard rests on, and it is not "the number
is plausible" but "the number equals what counting the source tables says".

## Related

- [ADR-0011 Asynchronous jobs, reporting, and observability](../adr/0011-async-jobs-reporting-and-observability.md)
- [ADR-0010 Thai-first internationalization and accessibility](../adr/0010-thai-first-i18n-and-accessibility.md)
- [Inbound receiving slice](./inbound-receiving-slice.md) — where the counters move
- [Inventory ledger](./inventory-ledger.md) — where occupancy moves
- [Backup and restore](../runbooks/backup-and-restore.md)
