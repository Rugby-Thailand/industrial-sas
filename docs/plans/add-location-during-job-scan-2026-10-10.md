# Add missing locations during job scanning

Date: 2026-10-10. Status: proposed implementation.

At `/finished-goods/scan`, workers should be able to scan or enter a location that has not been registered, add it to a building, and continue saving pallet or package information. Create a reusable database location with a building reference, so the next worker can find or scan the same label. Keep measurements optional for this registration flow.

## Proposed worker flow

1. **Scan or type the location.** A registered, available code selects its location and displays the building and floor when known.
2. **Offer Add location when the code is missing.** Show `Add location “F2-L28-18”` after an exact lookup confirms it is absent. Search results alone cannot establish this. Keep `Save now, set location later` as a secondary recovery action.
3. **Add the location in the current step.** Prefill the code from the scan or typed input. Require a building from the current warehouse. Offer an optional display name and floor. Default the name to the code; an unspecified floor remains explicitly unspecified. Require no coordinates, dimensions, or capacity estimates.
4. **Choose Add location and continue.** Create the location once, select the returned database identity, and continue to ticket capture. Show `Building → Floor, if specified → Location` above the tickets. Closing or cancelling the form preserves the search text and any existing ticket drafts.
5. **Capture pallet or package information.** Preserve the existing photo extraction, barcode entry, manual entry, quantity validation, and duplicate review. Add a visible storage format choice using the existing `PALLET`, `BOX`, and `OTHER` values, with appropriate pallet/package wording. Legacy tickets may have an unspecified format.
6. **Save with the location reference.** Persist all tickets against the chosen location and show its building in the receipt and records. Scanning the same label later selects this location without another registration.

Use an inline form within the location step, with a clear Cancel action and validation next to each field. Give English and Thai users the same flow. If there are no active buildings, explain the prerequisite and link to building setup, preserving the scan/ticket draft before navigation. Creating a building remains the existing setup flow.

## Current behavior and implementation constraints

The deployed picker offers `Save now, set location later` for an unknown code. [LocationPicker](../../src/features/finishedGoods/jobScan/LocationPicker.tsx) passes only free text for that choice; it creates no master location or building relationship.

[Job scan saving](../../convex/finishedGoods/jobScans.ts) writes `finishedGoodsJobScans`. Its mapped destination currently requires a zone and optional position, while manual search lists only zones. The [shared scan resolver](../../convex/finishedGoods/scanning.ts) also resolves positions and validates the active building, floor, and ledger locations. It returns `LOCATION_UNAVAILABLE` for both missing and unusable locations, which is insufficient to authorize registration.

[Zone creation](../../convex/storageLayouts/zones.ts) requires geometry and generates a code. Position creation requires an existing area, geometry, and a code suffix. Neither operation provides the requested quick registration of an arbitrary physical label.

Saving a job ticket currently records information and its location. It does not create a finished-goods inventory unit or confirm physical storage. This plan preserves that behavior. Actual storage assignment continues through the existing inventory workflow; a named location needs a valid layout mapping before that workflow can use it.

## Location representation

Extend the existing `locations` catalogue with a named storage location type, proposed as `NAMED_STORAGE`. Add optional `label`, `buildingId`, `floorId`, and audit/version metadata to support these entries. Require the name and building in the registration mutation even though their schema fields remain optional for compatibility with existing records. Add tenant-prefixed indexes for listing registrations by warehouse, building, and type.

This retains one canonical location identity and the existing uniqueness contract on organization, warehouse, and code. A named location has no zone or position geometry. The building association supports ticket tracking; layout capacity and occupancy calculations continue to use measured areas and placements. Catalogue rows should show these entries as **Location recorded · Layout pending**, with dimensions shown as unknown and map actions unavailable until a valid mapping exists. Audit existing location-type consumers so registration does not make these entries eligible for dock, receiving, or geometric placement workflows.

Extend ticket records with optional canonical `locationId`, `buildingId`, `floorId`, and `storageFormat`. Retain `locationText`, location name/code snapshots, and existing zone/position references. On write, resolve the submitted identity on the server and derive its parent references. For legacy tickets, derive building and floor from the existing zone when possible; retain the current text fallback for unmapped tickets.

Use a discriminated destination in the picker and job-scan APIs: an existing layout destination or a registered named location. Avoid assuming every selected location has `zoneId`. Named registrations count as **Location set** for ticket records; the separate layout status indicates whether geometry is available. Keep registration changes additive so old records remain readable.

## Backend work

Add a small registration service under `convex/storageLayouts`, with building/floor choices, exact location lookup, and an idempotent create mutation. Reuse tenant functions, `masterData.storageLayout.read/manage`, normalization, master-data uniqueness, audit, and write envelopes.

- Normalize codes consistently with existing location resolution. Set a shared limit compatible with the picker’s current 200-character maximum, reject control characters and reserved identity payloads, and preserve the physical label’s code rather than generating a replacement.
- Distinguish **found**, **missing**, **unavailable**, **ambiguous**, **invalid identity**, and **access/lookup failure**. Only a missing ordinary label can start registration. A failed network request or an inactive existing location must not become an add-location prompt. Canonical `ISAS:` payloads represent existing identities and cannot be registered as free-text codes.
- Validate that the selected building is active and belongs to the current warehouse and tenant. Validate an optional floor against that building. Recheck parents inside every create, save, and reassignment mutation.
- Check code uniqueness across the canonical catalogue and legacy zone/position records before writing. If another worker registers the code meanwhile, return a conflict with a usable existing location choice. Never move an existing code to the submitted building implicitly. Retry the same request and payload with the same request identity.
- Validate the full command before writes. Unexpected failures after insertion must abort the transaction; returning a failure envelope after a partial write is insufficient.

Add job-scan resolution that accepts both destination kinds. Share existing hierarchy validation for layout locations and use explicit validation for named entries. Keep the shared storage-assignment resolver’s geometry requirements. Expand manual search to include active zones, non-default positions, and named entries, with building context, bounded pagination, and duplicate suppression for default position aliases.

Update `saveJobScans`, `assignJobScanLocation`, and `listJobScans` together. Reassignment must clear stale destination fields when changing between kinds and retain the existing all-records validation before bulk writes. Reuse the registration flow on the records page so older unmapped tickets can be assigned to a newly added location explicitly.

## Implementation order and affected files

| Step | Deliverable                                                                                       | Main files                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Additive location and ticket fields, registered-location service, validation and command coverage | `convex/schema.ts`, `convex/lib/validators.ts`, new registration service, schema policy/index contracts as needed                                                  |
| 2    | Unified job-scan lookup, search, saving and reassignment                                          | `convex/finishedGoods/jobScans.ts`, shared hierarchy helper, `src/lib/convex/finishedGoodsApi.ts`, `src/lib/convex/storageLayoutApi.ts`                            |
| 3    | Inline registration, location summary, format selection and receipt                               | `jobScan/LocationPicker.tsx`, new registration form, `ticketDraft.ts`, `TicketCard.tsx`, `JobScanScreen.tsx`                                                       |
| 4    | Records and catalogue display, legacy fallback, English and Thai copy                             | `JobScanRecords.tsx`, `JobScanRecordRow.tsx`, `convex/storageLayouts/locationCatalogue.ts`, `StorageLocationCatalogue.tsx`, `messages/en.json`, `messages/th.json` |
| 5    | Workflow, isolation, compatibility and browser verification                                       | Existing job-scan, scanner, catalogue and schema tests plus registration tests                                                                                     |

Coordinate future acquisition/session changes with this registration flow. Camera, image, handheld, and manual acquisition should reach the same job-scan lookup. Preserve cancellation/version guards so an earlier lookup or create response cannot select a location after text edits, cancellation, or warehouse changes. A successfully committed registration remains in the database even if the worker later cancels ticket capture.

## Acceptance and verification

- An unknown ordinary label exposes Add location. Registering it with a building permits ticket capture and saves every record against that location. A second scan finds the same entry.
- A worker can save pallet, box, or other package information without location measurements. Quantity and duplicate-review behavior remain correct, and saving information does not alter stock balances or storage confirmation.
- An exact existing position is found through typing as well as scanning. Inactive, ambiguous, reserved, inaccessible, and failed lookups cannot create duplicate registrations.
- Cancelling, changing the building, editing the code, or switching warehouse handles pending results safely. Save failures preserve ticket drafts. Competing creates and retries never create two locations or duplicate tickets.
- Building references, optional floors, and destination transitions are validated for tenant and warehouse isolation. Archived parents are rejected on save even if selection occurred earlier.
- New records display building/location context; old mapped and unmapped records still render, filter, and reassign correctly. Named locations appear in the catalogue without invented dimensions or occupancy.
- Verify mobile widths of 320 and 390 pixels and desktop in English and Thai, including keyboard access, focus, field labels, status announcements, and overflow.

Run focused picker, screen, records, and draft tests; registration and job-scan integration tests; related scan, catalogue, isolation, and production-schema compatibility tests. Complete TypeScript, ESLint, changed-file formatting, and a production build. Use an isolated development database for the complete add-location-to-saved-record browser flow. Re-read the relevant installed Next.js guides before implementing client UI changes.

## Implementation

Approved inline preview A, implemented on `codex/add-location-during-scan`. The job-specific registration service lives in `convex/finishedGoods/jobScanLocations.ts`; physical storage resolution remains restricted to existing layout destinations. The picker uses the new bounded canonical search endpoint while the legacy `jobScans.searchLocations` endpoint remains compatible for older clients. Named registrations have their own paginated section in both catalogue views. No measurements or inventory units are created by recording a job ticket.
