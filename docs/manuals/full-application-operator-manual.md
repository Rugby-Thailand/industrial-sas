# Industrial SAS Full Application Operator Manual

Version: 2026-08-26
Audience: warehouse operators, supervisors, planners, HR reviewers, administrators, and support staff
Coverage: all 53 route pages under `src/app/[locale]`

## Document purpose

This manual explains how to use every page currently present in Industrial SAS. It covers both desktop and handheld workflows, including pages that redirect, show access state, or handle unknown links. The instructions describe the application as implemented in the repository on the version date above.

The application is bilingual. English routes use `/en`; Thai routes use `/th`. Examples below omit the locale prefix when the same instructions apply to both languages.

## Safety and operating principles

1. Confirm the organization and selected warehouse before every write. A warehouse change changes the records and work queues shown by warehouse-scoped pages.
2. Use stable business identifiers such as order number, SKU, receipt number, task number, and building code. Internal document IDs may appear only where no business label is available.
3. Read the status before pressing an action. Most pages expose only the next legal action for the current state.
4. Do not refresh repeatedly after a network failure. The application reuses the same request identity when retrying the same intent so a safe retry does not create a duplicate.
5. A denied request means the signed-in member lacks permission. A refused request means the member was allowed to try, but a business rule rejected the data or state.
6. Several workflows require two different people. The person who creates, captures, or reports an item cannot approve the same controlled decision.
7. Inventory history is append-only. Correct stock through the controlled reversal, reconciliation, return, or disposition workflow. Do not expect an edit button on ledger history.
8. Preview notices mean the screen is demonstrating layout with synthetic data. Preview actions do not write live tenant data.
9. Page and form descriptions are behind the information icon. Optional fields are grouped under **More options**. Required fields remain visible, except advanced fields with documented defaults such as count-risk thresholds.
10. Private photos and attachments require server verification. Do not paste credentials, tokens, or personal secrets into ordinary note fields.

## How to navigate the application

- The desktop sidebar is permission-aware. A missing navigation item usually means the member does not have the permission that makes the page useful.
- The organization name is fixed by the active identity context. Change organizations through the identity provider, not by typing an organization ID.
- Select a warehouse in the context bar. Warehouse-scoped pages show **No warehouse selected** until a warehouse is chosen.
- Use the language switcher to move between English and Thai while remaining on the equivalent route.
- On handheld, start at **Operator tasks**. Each large row opens one task-focused flow.
- The information icon beside a page or form title reveals guidance without permanently occupying the work area.
- Tables may scroll horizontally on small screens. Use pagination controls rather than assuming the first page is the complete register.

## Save and error states

- **Saving**: wait; do not press the action a second time.
- **Saved**: the server wrote the record and appended audit evidence.
- **Already saved earlier**: a safe retry replayed the earlier result; no duplicate was created.
- **Access denied**: ask an organization administrator for the missing permission and provide the displayed request reference.
- **Not saved**: correct the highlighted field or workflow state and submit again.
- **Could not reach the server**: the result is uncertain. Retry the same unchanged intent; the application preserves its idempotency key.
- **Backend not configured**: the environment is missing its Convex URL. This is an administrator setup issue.
- **Sign-in required**: complete sign-in before tenant data can be read.

# Part I - End-to-end operating flows

## Inbound: supplier order to available stock

1. Create suppliers, items, locations, storage classes, and any required reason codes or label templates.
2. Create a purchase order and add its lines.
3. Open a receipt against the order.
4. Post received lines at a receiving or staging location. Lot-tracked items require the correct lot.
5. If an unexpected item, shortage, damage, or delivery problem occurs, raise a receiving exception instead of forcing it through the ordinary path.
6. Complete quality inspection and independent approval when stock lands in QC hold.
7. Review the recommended putaway destination, claim the task, scan the destination, and confirm the move.
8. Verify the result in Inventory balances and, when investigation is needed, Inventory history.

## Order to ship: customer demand to proof of delivery

1. Create the customer order and required order lines.
2. Engineering records requirements, assigns the design request, creates or revises the master card, performs independent review, and releases the revision.
3. Issue and acknowledge the factory packet.
4. Create and independently release the production order when production is required.
5. Issue materials, report output, receive finished goods into QC hold, and record final quality disposition.
6. Route fulfillment demand, release it, reserve available stock, create and release a pick wave, and build the shipment.
7. The picker completes one instruction at a time. A different person independently checks, packs, stages, and issues the shipment.
8. Create a vehicle trip, assign the shipment, load all packages, seal, gate out, and depart.
9. Capture proof of delivery or record a failed delivery. A different reviewer accepts or rejects captured proof.

## Warehouse transfer

1. Request a transfer to another warehouse and add the required stock lines.
2. A different authorized person approves the request.
3. At the source, scan the exact stock bucket and dispatch quantity. Stock moves to transfer-in-transit.
4. At the destination, record received and discrepant quantities separately.
5. Resolve every discrepancy as found at destination or returned to source. Quantity must never disappear into a completed state.

## Stock counting and reconciliation

1. Create a plan for a physical stock bucket.
2. Choose full, cycle, or spot scope; blind or visible count; and movement-aware or frozen operation.
3. Review advanced risk thresholds only when the default policy is unsuitable.
4. Release the plan so handheld count tasks become available.
5. The operator claims a task, enters observed quantity and evidence, and submits it.
6. Prepare reconciliation, choose the root cause, and record the approved outcome.

## Attendance and leave

1. Link the signed-in identity to an active employee profile.
2. Record clock-in, break, return, or clock-out using the action that is true now.
3. Request a correction rather than editing historical clock events.
4. Submit leave dates, duration, and any private reason.
5. A supervisor reviews the team inbox and records an approval or rejection. Private reasons are not exposed in the team list.

# Part II - Access and routing pages

## Page 1 - Locale entry

Route: `/{locale}`

Purpose: This is the localized application entry point. It does not contain an operational form; it sends the user to the correct first destination based on application routing.

How to use:

1. Open `/en` for English or `/th` for Thai.
2. Allow the redirect to complete.
3. If the browser remains on this route, check that scripts and middleware are enabled and reload once.

Expected result: the user reaches the sign-in, setup, dashboard, or other appropriate entry page.

## Page 2 - Sign-in landing

Route: `/{locale}/sign-in`

Purpose: Starts authentication for users who do not yet have a verified session.

How to use:

1. Confirm the language in the URL.
2. Choose the identity-provider sign-in action.
3. Complete the provider's verification step.
4. Return to the application and confirm that the organization and warehouse context appears.

If sign-in succeeds but no tenant data appears, the user may be missing an active organization membership or warehouse scope.

## Page 3 - Sign-in provider continuation

Route: `/{locale}/sign-in/[...sign-in]`

Purpose: Handles the provider's multi-step sign-in paths, callbacks, and verification screens.

How to use: follow the provider prompts exactly. Do not bookmark a deep continuation URL; bookmark `/sign-in` or the dashboard instead. If a continuation link is expired, return to `/sign-in` and begin again.

## Page 4 - Unknown localized route

Route: `/{locale}/[...rest]`

Purpose: Handles a localized link that does not match an application page.

How to use: return through the visible navigation or open `/dashboard`. Check copied order, receipt, item, or building links for a missing or extra character. This page never creates or changes records.

# Part III - Desktop pages

## Page 5 - Owner dashboard

Route: `/dashboard`

Purpose: Gives owners and supervisors a decision-first summary of live operations, exceptions, and capacity.

How to use:

1. Confirm the selected warehouse.
2. Use Quick actions to open the most frequent operational pages. Customize order or visibility if your role permits.
3. Read the pulse cards for current operational metrics.
4. Review **Needs attention** before general volume. Open the relevant workflow to resolve the underlying record.
5. Check the occupancy map for tightening areas, partial data warnings, and available capacity.
6. Use the operations summary for bounded volume context, not as an accounting statement.

The dashboard is read-oriented. Correct problems in the source workflow rather than trying to change a dashboard metric.

## Page 6 - Devices

Route: `/devices`

Purpose: Registers scanners, tablets, and workstations and shows whether they are bound, active, retired, or recently seen.

How to use:

1. Enter the physical asset label and choose the device kind.
2. Choose whether the browser currently open is the installation on that physical device.
3. Save the registration.
4. For an unbound row, use **Bind this app** only while standing at the physical device it represents.
5. Use **Retire** when the asset must stop receiving new work. Retirement preserves history and releases its app binding.

Never paste the private installation correlation value into notes or tickets. The registry intentionally does not display it.

## Page 7 - Engineering designs

Route: `/engineering/designs`

Purpose: Controls design requests, requirement confirmation, master-card revisions, similar-design reuse, independent review, and release.

How to use:

1. Select the design request from the queue.
2. Record all required confirmations and an optional note.
3. Assign the request and move it to the next permitted status.
4. Review similar candidates before starting a new master card. Confirm reuse only when the candidate is genuinely equivalent.
5. Create or edit the master-card draft, including construction, dimensions, materials, print, packing, route, and quality details.
6. Submit the revision for review.
7. A different authorized person approves or rejects it.
8. Release the approved revision and fulfill the design request.

Released revisions become the authority used by factory packets and production. A newer revision does not silently rewrite an active production order.

### Numbered controls on the engineering page

![Engineering design controls with numbered red squares](./assets/full-application/engineering-designs-annotated.svg)

1. **Sales orders** opens the customer-order stage of the order-to-ship workflow.
2. **Factory** opens released factory packets and production handoff work.
3. **Create card** opens the full master-card workspace for a new design draft.
4. The **edit icon** changes the design request priority and due date.
5. **Find similar design** searches approved structured designs for an exact reusable match.
6. **Show revision history** opens the selected master card's immutable revision record.

The square around each control uses the same number as this list. The icon-only edit action retains an accessible name and tooltip even though its visible text is intentionally omitted.

## Page 8 - Fulfillment control

Route: `/fulfillment`

Purpose: Routes released customer demand, reserves available stock, creates warehouse work, and advances picked goods through outbound issue.

How to use:

1. Create fulfillment demand for a released customer-order line. Enter the ship-to identity and required address; optional district, postal, and recipient fields are under **More options**.
2. Review ATP and whether production is required.
3. Release demand, then reserve available stock using the explained rotation order.
4. Create and release a pick wave.
5. Build a shipment only from issued packages, then release it to transport.
6. In the execution board, perform only the action shown in the current column: independent check, pack, stage, or issue.

The checker must differ from the picker. Issuing stock is an append-only ledger event and should occur only after physical evidence matches the screen.

## Page 9 - Attendance and leave

Route: `/hr`

Purpose: Combines employee self-service with the supervisor decision inbox.

How to use as an employee:

1. Review today's business date and attendance status.
2. Choose the clock action that is true now and record it.
3. Request a correction with the proposed clock times, break minutes, and reason. Original events remain immutable.
4. Request leave with dates, type, duration, and hours when required. Put private detail only in the private-reason field.
5. Review request history and statuses.

How to use as a supervisor: review the team inbox, select the request, approve or reject, and enter the required decision note. The reporter cannot decide their own controlled request.

## Page 10 - Inbound control board

Route: `/inbound`

Purpose: Gives supervisors one status board from purchase order through receipt, quality, and putaway.

How to use:

1. Choose Orders, Receipts, Quality, or Putaway.
2. Read each card's status, business identifier, quantity summary, and next operational state.
3. Open the dedicated purchasing, receiving, quality, or putaway page to perform a write.
4. Use empty columns as a workflow signal: confirm that upstream documents were released rather than creating duplicate work.

This board is for prioritization and handoff. It does not replace the detailed source pages.

## Page 11 - Integration health and recovery

Route: `/integrations`

Purpose: Monitors outbound adapter delivery without exposing provider credentials or undoing committed business work.

How to use:

1. Read the adapter, delayed, and blocked summary.
2. Inspect each adapter's state, pending/retry/dead-letter counts, last result, and recommended action.
3. Register an adapter using a code, display name, kind, and server-side configuration reference. New adapters start disabled.
4. Enable only after provider verification. Disable when delivery must stop claiming new events.
5. For blocked events, fix configuration and deliberately recover the original event key. Do not recreate the source stock or order transaction.

Credentials belong in the approved secret store, never in the configuration-reference field.

## Page 12 - Inventory balances

Route: `/inventory/balances`

Purpose: Reads current stock by physical or logical bucket for the selected warehouse.

How to use:

1. Confirm the warehouse and read-only notice.
2. Review item, location, lot or other bucket dimensions, stock status, unit, and exact minor-unit balance.
3. Use pagination to continue through the bounded result.
4. If a balance looks wrong, open transaction history and trace the ledger events.

There is no direct balance edit. Use a reversal, reconciliation, return, receipt, issue, or other controlled ledger operation.

## Page 13 - Stock count plans

Route: `/inventory/counts`

Purpose: Creates count plans, releases handheld tasks, and prepares reconciliation for submitted counts.

How to use:

1. Select the physical stock bucket and enter a business plan number.
2. Choose count scope, quantity visibility, and movement policy.
3. Open **Risk settings** only when quantity threshold, value threshold, item class, or unit value must differ from defaults.
4. Create the plan, then use **Release tasks** so counters can begin.
5. In the reconciliation queue, review submitted observations, enter a root-cause code when known, and prepare the controlled reconciliation.

Frozen counting blocks movements only for its defined window. Movement-aware counting leaves operations open and accounts for intervening ledger activity.

## Page 14 - Inventory history

Route: `/inventory/history`

Purpose: Shows immutable, bounded transaction history for investigation and audit.

How to use:

1. Review business date, event type, item/bucket identity, quantity, reason, and request or source reference.
2. Use pagination to follow older activity.
3. Compare related entries when a move, transfer, receipt, issue, or reversal creates balanced legs.
4. Quote business identifiers and request references in an investigation.

History cannot be edited. A correction must append a new controlled event that preserves the original evidence.

## Page 15 - Opening stock

Route: `/inventory/opening-stock`

Purpose: Loads, validates, applies, and reviews an opening-stock batch during controlled onboarding or migration.

How to use:

1. Create a batch with its source reference, source file name, source hash, and reason code.
2. Add rows with SKU, location code, lot when applicable, unit, and quantity.
3. Validate before applying. Resolve every rejected or duplicate row.
4. Apply only the reviewed batch.
5. Review the result and verify balances/history.

Do not use opening stock for ordinary corrections after go-live. Use the normal inventory workflows.

## Page 16 - Item detail

Route: `/master-data/items/{itemId}`

Purpose: Maintains one item's barcodes, alternate units, lots, and lifecycle state.

How to use:

1. Confirm the SKU and base unit at the top of the page.
2. Add or retire barcodes. Choose the correct barcode kind and avoid assigning the same active code to two items.
3. Add alternate units with an exact conversion ratio to the base unit.
4. Add lots when the tracking policy requires them. Optional expiry is under **More options**.
5. Use row actions to activate, deactivate, or maintain supported child records.

Base identity and tracking decisions affect receiving, rotation, and counting. Do not change them casually after transactions exist.

## Page 17 - Items

Route: `/master-data/items`

Purpose: Lists the item catalogue and creates new items.

How to use:

1. Search or page through the register and open an item for child records.
2. To create an item, enter a unique SKU, clear name, base unit, and tracking mode.
3. Save and confirm that the new row appears.
4. Open the item detail page to add barcodes, alternate units, or lots.

The SKU and base unit are foundational identifiers. Verify them before saving rather than relying on later correction.

## Page 18 - Label templates

Route: `/master-data/label-templates`

Purpose: Stores versioned label payload templates and controls independent publication.

How to use:

1. Create a template with code, name, version, and exact body text.
2. Review the saved draft in the register.
3. A different authorized person publishes the approved version.
4. Retire versions that must not be used for new evidence.

The application stores the body exactly as entered. This page does not parse, preview, render, or send content to a printer. Publishing authorizes the template for label-evidence generation; it is not physical print confirmation.

## Page 19 - Locations

Route: `/master-data/locations`

Purpose: Lists and creates warehouse locations used by receiving, QC, storage, picking, production, and returns.

How to use:

1. Review code, name, type, and operational status.
2. Create a unique location code and choose the correct type.
3. Save, then verify it appears in the selected warehouse.
4. Retire or deactivate only after active work and stock dependencies are understood.

Receiving requires a dock or staging location; putaway requires eligible storage destinations; returns may require QC or quarantine locations.

## Page 20 - Storage classes

Route: `/master-data/storage-classes`

Purpose: Defines organization-wide storage compatibility classes such as temperature, hazard, or handling categories.

How to use:

1. Review the register for an existing equivalent class.
2. Enter a stable code and clear name.
3. Save the class.
4. Use lifecycle actions to retire a class only after dependent items and zones are handled.

Storage classes are organization-scoped so the same rule has the same meaning across warehouses.

## Page 21 - Storage layout floor editor

Route: `/master-data/storage-layouts/{buildingId}/floors/{floorNumber}`

Purpose: Designs one floor's zones, reserved blocks, stacks, and optional dimension overrides.

How to use:

1. Confirm the building and floor number.
2. Review the floor canvas and current zone allocation.
3. Add or edit storage zones and their class/capacity properties.
4. Add reserved blocks for unusable or protected areas.
5. Open **Dimensions** only when the floor must override the building footprint; otherwise it inherits.
6. Save and inspect validation feedback before continuing.

Avoid overlapping zones and blocks. Use business dimensions consistently; the application stores exact millimetres and derives displayed metres.

## Page 22 - Storage building editor

Route: `/master-data/storage-layouts/{buildingId}`

Purpose: Edits building identity, footprint, floor structure, and navigation into each floor.

How to use:

1. Review code, name, status, and dimensions.
2. Update permitted draft details.
3. Add or open floors and complete their zoning.
4. Review capacity summaries.
5. Continue to the review page when the design is complete.

Activated structures should be treated as operational master data. Use a deliberate revision process rather than casual dimension changes.

## Page 23 - Storage building review

Route: `/master-data/storage-layouts/{buildingId}/review`

Purpose: Validates the complete building design and activates a draft.

How to use:

1. Review building dimensions, floor count, usable area, and reserved area.
2. Resolve every validation warning in the building or floor editor.
3. Confirm that zones and reserved blocks reflect the physical building.
4. Activate only when the design is ready for operational use.

Activation is the controlled boundary between planning and live warehouse structure.

## Page 24 - New storage building

Route: `/master-data/storage-layouts/new`

Purpose: Creates a draft building for layout planning.

How to use:

1. Enter a unique building code and clear name.
2. Enter width, depth, height, and required floor information.
3. Save the draft.
4. Open the new building, configure floors and zones, then use Review to activate.

Use measured physical dimensions. Do not treat the planner as a rough drawing tool when it will drive location and capacity decisions.

## Page 25 - Storage layouts register

Route: `/master-data/storage-layouts`

Purpose: Lists warehouse buildings and opens the layout-planning workflow.

How to use:

1. Review each building's status and summary.
2. Open an existing building to maintain it.
3. Choose **New building** to start a draft.
4. Use the register to distinguish drafts from activated layouts.

## Page 26 - Suppliers

Route: `/master-data/suppliers`

Purpose: Lists, creates, activates, and deactivates suppliers used by purchasing.

How to use:

1. Check the register for an existing supplier.
2. Enter a unique supplier code and clear name.
3. Save and verify the active status.
4. Deactivate suppliers that must not be selected for new orders; reactivate only after review.

Existing orders and audit history remain even when a supplier is inactive.

## Page 27 - Production orders

Route: `/production/orders`

Purpose: Runs revision-pinned production from independent release through material issue, output reporting, finished-goods receipt, and final QC.

How to use:

1. Create a draft from an acknowledged factory packet and specify order number, output item, quantity, and due date.
2. A different person releases the order after checking the pinned revision, route, and BOM.
3. Issue exact material lots from available stock.
4. Report good, scrap, rework, and downtime by route sequence.
5. Receive eligible finished output into QC hold.
6. Record final release or rejection with evidence.
7. Review and acknowledge any newer-revision impact without silently repinning the order.

## Page 28 - Factory packets

Route: `/production/packets`

Purpose: Issues released engineering authority to the factory and records acknowledgement.

How to use:

1. Select a released master-card revision and create the factory packet.
2. Review packet number, revision, BOM, route, print, packing, and quality content.
3. Issue the packet.
4. A factory user acknowledges receipt and understanding.
5. Use only acknowledged packets when creating production orders.

## Page 29 - Purchase-order import

Route: `/purchasing/import`

Purpose: Parses a file first, presents accepted and rejected rows, then applies reviewed rows in bounded chunks.

How to use:

1. Enter the file reference and contents.
2. Press **Parse without writing**. This step does not create orders.
3. Review accepted rows, rejected rows, row numbers, and problem codes.
4. Correct the source when required and parse again.
5. Apply an accepted chunk only after the preview matches the intended orders.
6. Continue until all reviewed chunks are applied.

Re-running the same chunk uses idempotent import identity and creates nothing new.

## Page 30 - Purchase-order detail

Route: `/purchasing/orders/{purchaseOrderId}`

Purpose: Maintains one purchase order's lines, close-short decisions, and receipt opening.

How to use:

1. Review the order header and line statuses.
2. Add each line with a unique line number, item, ordered quantity, and unit.
3. Compare ordered, received, and remaining quantity.
4. Close a remaining quantity short only with the required reason and authority.
5. Open a receipt against the order when goods arrive.

The ordinary receiving path can select only items and open quantities on the order. Unexpected stock belongs in the exception workflow.

## Page 31 - Purchase orders

Route: `/purchasing/orders`

Purpose: Lists purchase orders and creates draft orders.

How to use:

1. Review number, supplier, status, and external reference.
2. Open an existing order to add lines or continue receiving.
3. To create an order, enter order number and supplier. Put optional external reference under **More options**.
4. Save, then open the detail page to add lines.

An order requires at least one usable line before it becomes meaningful to receiving.

## Page 32 - Putaway

Route: `/putaway`

Purpose: Shows open putaway tasks, explains ranked destinations, and records controlled completion.

How to use:

1. Select a task from the queue.
2. Review item, source, quantity, and ranked destination recommendations.
3. Read score components and any overflow warning rather than choosing by proximity alone.
4. Claim the task if required.
5. Scan or choose the destination and confirm physical placement.
6. Verify that the task closes and stock appears in the destination balance.

## Page 33 - Quality

Route: `/quality`

Purpose: Performs inspection disposition and independent approval for stock in QC hold.

How to use:

1. Select a pending inspection.
2. Review item, sample strategy, sample size, receipt source, and current hold quantity.
3. Record observed results and proposed disposition.
4. Submit the inspection.
5. A different authorized person approves or rejects the decision.
6. Confirm the resulting stock status: available, rejected, quarantine, or another controlled state.

## Page 34 - Receipt detail

Route: `/receiving/{receiptId}`

Purpose: Posts lines to one receipt, builds pallets, and generates versioned label evidence.

How to use:

1. Confirm the receipt number and linked order.
2. Select receiving location, resolve the item, choose the order line, and enter quantity/unit.
3. Enter lot for lot-tracked items. Use **More options** for expiry when applicable.
4. Post the line and review classification, stock status, and any QC hold result.
5. Build a pallet from posted receipt lines when needed.
6. Select a published template and generate label evidence for the pallet/LPN.

Label evidence records payload and template version; it does not prove physical printing.

## Page 35 - Receiving

Route: `/receiving`

Purpose: Lists receipts, opens new receipts, and raises controlled receiving exceptions.

How to use:

1. Open an existing receipt to continue posting lines.
2. To create one, enter receipt number and choose an open purchase order, or deliberately choose no order for the supported exception path.
3. When the delivery is damaged, incomplete, unexpected, or otherwise abnormal, choose exception kind and reason code.
4. Put optional supporting detail under **More options** and submit.

The person who raises an exception and the person who receives against it must differ where separation of duties applies.

## Page 36 - Operational reports and exports

Route: `/reports`

Purpose: Reviews bounded stock reports and exception queues, and creates larger CSV exports.

How to use:

1. Review the decision-needed exception center first.
2. Choose balance, SKU, lot, or movement report tabs for bounded on-screen analysis.
3. Note partial-result warnings; the visible table may intentionally stop at a limit.
4. To export, choose an export kind and request the job.
5. Press **Run next page** until the job completes.
6. Download the CSV from the current browser session.

Downloads are session files, not shareable signed links. If an artifact limit stops the job, narrow the export instead of treating it as a normal retry.

## Page 37 - Customer orders

Route: `/sales/orders`

Purpose: Creates customer orders, adds exact product specifications, releases orders, and monitors design fulfillment.

How to use:

1. Create an order with order number and customer ID. Optional customer PO is under **More options**.
2. Add every order line with line number, customer product code, quantity, style, internal dimensions, board grade, and print-colour count.
3. Review the order for completeness.
4. Release the order.
5. Follow the linked design-request status and handoff to engineering.

Release freezes the commercial input used by downstream design and fulfillment workflows.

## Page 38 - Setup

Route: `/setup`

Purpose: Explains environment readiness when sign-in, backend, organization, or warehouse context is incomplete.

How to use:

1. Read the exact missing prerequisite.
2. Configure or verify the identity provider and Convex URL as instructed.
3. Ensure the signed-in account has an active organization membership.
4. Ensure at least one permitted warehouse exists.
5. Return to the application and select the warehouse.

This page is diagnostic; it is not an organization-administration console.

## Page 39 - Warehouse transfers

Route: `/transfers`

Purpose: Controls the source and destination legs of stock transfer with owned discrepancy resolution.

How to use:

1. Request a transfer with destination, transfer number, source-document kind, purpose, and optional reference.
2. Add item and quantity lines.
3. A different person approves.
4. At source, select a line, scan the exact stock bucket, and post dispatch. Seal and carrier are optional details.
5. At destination, select destination location and record received plus discrepancy quantity.
6. Open **More options** for discrepancy kind and note when an exception exists.
7. Resolve open discrepancies as received at destination or returned to source.

## Page 40 - Transport control

Route: `/transport`

Purpose: Plans vehicle trips, assigns released shipments, and monitors proof-of-delivery review.

How to use:

1. Review available shipment manifests and current trips.
2. Create a trip with number, vehicle, driver, and optional phone.
3. Assign released shipments to the draft trip.
4. Release the trip to loading, which freezes expected package count.
5. Monitor loading/departure state.
6. Review captured POD in the independent review queue. Accept to complete delivery or reject with a reason.

# Part IV - Handheld pages

## Page 41 - My attendance

Route: `/handheld/attendance`

Purpose: Provides the employee self-service portion of attendance and leave in a touch-first layout.

How to use: confirm business date, choose the true clock action, and save. Use correction and leave forms when needed. Review request history before submitting a duplicate request. Supervisor decision tools remain on the desktop HR page.

## Page 42 - Count stock

Route: `/handheld/count`

Purpose: Claims released count work and records observed quantity without exposing more information than the plan allows.

How to use:

1. Choose an available task and claim it.
2. Go to the displayed physical location and verify item/lot identity.
3. Enter observed quantity and required evidence.
4. In a blind count, do not seek the system quantity outside the workflow.
5. Submit and confirm the task moves to reconciliation.

## Page 43 - Delivery and proof

Route: `/handheld/delivery`

Purpose: Captures proof of delivery, failed-delivery evidence, and returned stock.

How to use:

1. Select the shipment currently in transit.
2. For successful delivery, enter recipient name, optional note, and private evidence photo; upload and capture POD.
3. For failure, choose the failure reason and record it without pretending stock was delivered.
4. Receive returned packages into an approved QC or quarantine location using the warehouse return reason.
5. Wait for independent POD review before considering the delivery complete.

## Page 44 - Stock lookup

Route: `/handheld/inventory`

Purpose: Reads current warehouse balances on a handheld.

How to use: confirm the warehouse, scan or identify the item/bucket using available controls, review stock status and quantity, and use pagination when more results exist. This page is read-only; corrections belong in a controlled workflow.

## Page 45 - Load and gate vehicle

Route: `/handheld/load`

Purpose: Loads every expected package, seals the complete load, records independent gate release, and confirms departure.

How to use:

1. Select a released trip and start loading.
2. Scan each package. Wrong-trip and duplicate scans are refused.
3. Verify loaded equals expected.
4. Enter the seal number and seal the trip.
5. A different authorized person records the gate-pass number and releases the vehicle.
6. Confirm departure to start the in-transit timeline.

## Page 46 - Operator tasks

Route: `/handheld`

Purpose: Launches permission-appropriate handheld work using large icon-led targets.

How to use:

1. Confirm organization and warehouse.
2. Start with **My work** when continuing an assigned task.
3. Otherwise choose lookup, receive, quality, putaway, count, pick, load, delivery, transfer, attendance, or production.
4. An unavailable pallet entry means pallet building is inside the receiving flow, not a standalone task.

## Page 47 - Pick stock

Route: `/handheld/pick`

Purpose: Executes released pick tasks one location instruction at a time.

How to use:

1. Choose and start a task.
2. Go to the instructed location.
3. Scan location, item, and lot as required.
4. Enter picked quantity or record short/damaged quantity with a reason.
5. Complete every instruction.
6. Submit for independent check. Submission stages evidence but does not issue stock.

## Page 48 - Production operator

Route: `/handheld/production`

Purpose: Provides the floor operator's connected flow for issue, output, downtime, finished-goods receipt, and QC handoff.

How to use: select the released production order, scan the exact material lot for issue, report operation good/scrap/rework/downtime, receive eligible output into QC hold, and hand final disposition to an authorized checker. Follow the pinned route sequence.

## Page 49 - Put away stock

Route: `/handheld/putaway`

Purpose: Claims a putaway task and confirms physical placement using a recommended destination.

How to use: select the task, review recommendation and overflow warnings, claim it, move the handling unit, scan/choose the destination, and confirm. Recheck the location label before the final action.

## Page 50 - Perform QC

Route: `/handheld/quality`

Purpose: Captures the inspection decision in a touch-first queue.

How to use: select an inspection, review sampling requirement and held quantity, record observations and proposed disposition, submit, and leave independent approval to another authorized person when required.

## Page 51 - Receive goods

Route: `/handheld/receive`

Purpose: Opens an order receipt and posts one scanned line at a time.

How to use:

1. Choose an open purchase order.
2. Open or continue the receipt.
3. Choose the receiving location.
4. Scan the carton or type a SKU and press Resolve. Resolve never posts stock.
5. Confirm the matching order line, quantity, unit, lot, and optional expiry.
6. Post the line and review classification/QC status.
7. Build a pallet inside this flow when needed.

## Page 52 - Transfer stock

Route: `/handheld/transfers`

Purpose: Performs source dispatch, destination receipt, or discrepancy resolution with scan evidence.

How to use: choose the transfer and legal next action. At source, scan the exact stock bucket and dispatch. At destination, record location, received quantity, and discrepancy separately. Resolve owned discrepancies only after physical evidence establishes destination receipt or source return.

## Page 53 - My work

Route: `/handheld/work`

Purpose: Shows assigned tasks and the site queue, manages task leases, and preserves scans, exceptions, attachments, and activity across reassignment.

How to use:

1. Switch between **My work** and **Site queue**.
2. Claim an unheld task or take over an expired lease.
3. Open the task and follow its instruction.
4. Resolve a scanned label first, verify the item, then record evidence. Manual entry requires a reason.
5. Report exceptions with observation, evidence, and proposed recovery. A different person resolves them.
6. Upload private evidence only through the attachment control.
7. Review timeline and unresolved exceptions before closing.
8. Use **Hand back** when work must return to the queue; recorded evidence stays with the task.

# Part V - Roles, permissions, and handoffs

## Permission-aware behavior

Navigation visibility is not the authorization boundary. The server checks permissions again for every protected read and write. A user may see a control and still receive a denied result when a role, warehouse scope, step-up requirement, or separation-of-duties policy is not satisfied.

Common page families and expected roles:

- Owners and supervisors: dashboard, inbound board, reports, exception queues.
- Master-data administrators: items, suppliers, locations, storage classes, templates, storage layouts.
- Purchasing and receiving: purchase orders, import, receipts, handheld receive.
- Quality and putaway: inspection/disposition, approval, ranked destination, confirmation.
- Sales, engineering, factory, and production: the order-to-ship chain.
- Fulfillment and transport: reservation, picking, issue, vehicle manifest, delivery, POD review.
- HR self-service and supervisors: attendance, corrections, leave, team inbox.
- Integration and device administrators: adapter recovery and device registry.

## Maker-checker checkpoints

Use separate authorized identities for controlled approval where required, including:

- label-template publication;
- purchase-order over-tolerance or receiving-exception decisions;
- quality disposition approval;
- transfer approval;
- production release and final QC;
- independent pick check and gate release;
- POD review;
- attendance/leave decisions;
- operator exception resolution.

# Part VI - Troubleshooting checklist

## A page has no data

1. Confirm sign-in.
2. Confirm active organization membership.
3. Select a warehouse.
4. Confirm the user's role grants access to the page and the selected warehouse.
5. Check for a preview notice or backend-not-configured notice.
6. Confirm upstream work exists: released order, open line, pending inspection, released task, or issued shipment.

## A required option list is empty

Create or activate the upstream master data first. Typical dependencies are active items, suppliers, reason codes, receiving locations, published label templates, open orders, open order lines, pending inspections, or eligible putaway locations.

## A write was refused

Read the marked field and structured message. Common causes are duplicate business codes, invalid state transition, missing lot, unit mismatch, tolerance exceeded, insufficient stock, self-approval, expired lease, or stale workflow state.

## A request failed over the network

Do not alter the fields unless you intend a new request. Retry the unchanged action so the server can replay the original idempotent result. If the state remains uncertain, use the register or history to verify whether the write exists.

## A handheld scan does not match

Check that the label belongs to the active organization, the barcode is active, the task expects that item/lot/location, and the selected warehouse is correct. Manual entry is not a shortcut; use it only with the required reason.

# Appendix A - Route coverage checklist

The following source route pages are covered in this manual:

1. `/{locale}`
2. `/{locale}/sign-in`
3. `/{locale}/sign-in/[...sign-in]`
4. `/{locale}/[...rest]`
5. `/dashboard`
6. `/devices`
7. `/engineering/designs`
8. `/fulfillment`
9. `/hr`
10. `/inbound`
11. `/integrations`
12. `/inventory/balances`
13. `/inventory/counts`
14. `/inventory/history`
15. `/inventory/opening-stock`
16. `/master-data/items/{itemId}`
17. `/master-data/items`
18. `/master-data/label-templates`
19. `/master-data/locations`
20. `/master-data/storage-classes`
21. `/master-data/storage-layouts/{buildingId}/floors/{floorNumber}`
22. `/master-data/storage-layouts/{buildingId}`
23. `/master-data/storage-layouts/{buildingId}/review`
24. `/master-data/storage-layouts/new`
25. `/master-data/storage-layouts`
26. `/master-data/suppliers`
27. `/production/orders`
28. `/production/packets`
29. `/purchasing/import`
30. `/purchasing/orders/{purchaseOrderId}`
31. `/purchasing/orders`
32. `/putaway`
33. `/quality`
34. `/receiving/{receiptId}`
35. `/receiving`
36. `/reports`
37. `/sales/orders`
38. `/setup`
39. `/transfers`
40. `/transport`
41. `/handheld/attendance`
42. `/handheld/count`
43. `/handheld/delivery`
44. `/handheld/inventory`
45. `/handheld/load`
46. `/handheld`
47. `/handheld/pick`
48. `/handheld/production`
49. `/handheld/putaway`
50. `/handheld/quality`
51. `/handheld/receive`
52. `/handheld/transfers`
53. `/handheld/work`

# Appendix B - Related detailed references

- `docs/manuals/visual-operator-guide-th.md` - Thai illustrated guide for key inbound and inventory tasks.
- `docs/manuals/inbound-receiving-slice.md` - detailed purchase order, receiving, QC, pallet, label, and putaway behavior.
- `docs/manuals/inventory-ledger.md` - ledger, balance, transaction, and correction rules.
- `docs/manuals/master-data-catalogue.md` and `master-data-entities.md` - entity-level behavior.
- `docs/manuals/dashboard-and-reporting.md` - dashboard and export semantics.
- `docs/permissions.md` - permission catalogue and policy semantics.
- `docs/domain-glossary.md` - canonical domain terms.
