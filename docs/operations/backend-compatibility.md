# Backend compatibility during a frontend rollout

The production workflow installs the Convex backend before promoting the frontend. Tabs with an older frontend can remain open after either step. Public validator compatibility is checked by `tests/integration/public-function-contract.integration.test.ts`; passing that check does not prove that a runtime behavior change is compatible.

## Storage actions release: optimistic concurrency

This release adds optional version arguments to existing write validators so old requests remain decodable, but edits without an observed version deliberately fail closed. They must not silently overwrite another user's changes.

- `finishedGoods/workflow:saveProduct`: creating a product needs no version. Editing an existing product requires `expectedUpdatedAt` equal to the saved product's current value. Missing or stale values return `VERSION_CONFLICT`. Successful edits advance the token even when the clock has not advanced.
- `finishedGoods/workflow:saveStackingLimits`: saves require the observed `expectedStackable` and `expectedMaxStackLevels` settings. An omitted maximum means no maximum was saved; an unset legacy stackable value reads as false. The validator arguments remain optional so old requests decode, but a missing or changed baseline returns `STACK_SETTINGS_STALE`. The current frontend retains dirty drafts and offers **Load current limits** before another save. Old tabs must keep a copy of unsent values and reload the frontend before saving; a frontend rollback temporarily makes unversioned stacking edits unavailable.
- Storage zone and position edits use the current record revision. Missing or stale edit revisions return `VERSION_CONFLICT`. Existing records without a stored revision get the server's legacy revision, which is included in reads. Schema fields remain optional; a destructive data migration is unnecessary.
- Saved job-ticket corrections are a new API. They always require the observed `expectedVersion` and return `STALE_REVISION` when the ticket changed. Corrections update metadata and its audit history, not inventory quantities or placement.
- Bulk job-ticket remapping accepts an optional complete `expectedVersions` list. The new frontend always sends it and checks every selected record before any write. The previous frontend's existing remap contract is retained during rollout.

A mutation's successful request identity is checked before live-version and occupancy checks. Retrying the same successful command returns its recorded result; reusing its identity with a different payload is refused. Failed requests retain their editable draft and can be reviewed or retried.

## User-visible migration and rollback

An already open old tab can read existing data and create products, but its unversioned product or layout edit is refused. The user needs to load the new frontend, restore or retain their draft, inspect the current saved values, and retry with a current token. The new product editor explicitly handles persisted drafts that predate version tokens and offers a comparison before merging changed fields or loading the saved product. Do not imply that refreshing an in-memory-only legacy layout draft preserves it; keep a copy of those entered values before reloading.

Promote the matching frontend promptly after the backend. If promotion fails, keep safe refusal in place rather than bypassing concurrency checks. A frontend rollback to code that omits edit versions temporarily makes those edits unavailable; reads remain available. Roll forward the matching frontend to recover editing. Do not remove schema fields or public functions as an incidental rollback.

## Reviewing the function snapshot

After reviewing every changed validator and its runtime behavior, refresh the snapshot with:

```sh
UPDATE_PUBLIC_CONTRACT=1 pnpm exec vitest run --project integration tests/integration/public-function-contract.integration.test.ts
```

A removed function, narrowed argument, newly required argument, or incompatible result shape needs an explicit expand/migrate/contract plan before accepting a breaking snapshot. Do not set `ACCEPT_BREAKING_PUBLIC_CONTRACT` just to make the test pass. Keep old callers supported until their migration is complete, or document a deliberate fail-closed runtime policy and the recovery path as above.

## HR foundation employee and logo protocols

`hr/setup:saveEmployee` accepts optional `replaceOrgFields: true`. The group is exactly
`branchId`, `departmentId`, `positionId`, `levelId`, `employmentType`, and
`probationEndDate`. With the marker, supplied values replace that group and omitted
members are cleared. Without it, each supplied member updates independently and each
omitted member retains its saved value. A create has nothing to retain. Both modes
validate the effective values before persistence: tenant references, newly selected
inactive masters, dates, and ACTIVE assignment requirements still apply. Current
inactive references may be retained, including by legacy omission. An unrelated old-tab
name edit therefore neither loses assignments nor demands that the old tab supply new
fields. This marker does not change replacement semantics for the pre-existing employee
fields. Employee `expectedVersion` and request-id replay checks remain in force.
The pre-existing provisional exception for already ACTIVE, unassigned legacy employees
is unchanged; this protocol correction does not approve that product policy.

`hr/org:getCompanyLogo` keeps its `null` absent result and image fields, and adds
`revision: { id, version }` for a present logo. `id` is the `hrCompanyLogos` row ID;
`version` is its positive integer write revision. `hr/org:saveCompanyLogo` accepts
optional `expectedRevision: null | { id, version }`. New clients always send it:
`null` means observed absent; a present token must match both identity and revision.
Both replacement and removal compare before changing the logo or profile `hasLogo`.
Row identity prevents delete/recreate ABA even though a recreated row starts at version 1.
A stale, missing-present, or mismatched token returns `LOGO_STALE`; an invalid numeric
revision returns `LOGO_REVISION_INVALID`. Registered validators reject wrong token shapes.
Exactly one upload pair or remove form is still required (including the P3 partial-upload
refusals). These remain separate profile and logo commands; logo writes never advance
profile version or stamps. Refusals may add a denied audit event, but do not change logo
or profile metadata. Successful replays are resolved before checking the current revision
and neither resurrect deleted images nor remove later replacements.

Legacy logo commands without a token decode, but can only create while currently absent
or remove an already absent logo. They cannot overwrite or delete any existing logo.
Old tabs must retain a copy of their chosen file, load the current frontend, inspect the
current logo, then explicitly choose the upload/removal again. A frontend rollback keeps
these safe refusals. The current UI pins the intent revision before file reading and
through uncertain retries; query refresh and remount cannot silently rebase a pending
command. A stale upload retains its selected bytes in the mounted editor and requires
**Apply selected file to current logo** after reviewing the current preview. A full reload
does not persist the selected image bytes; an uncertain request can be reconciled through
the existing request recovery flow. Profile text drafts remain independent.
