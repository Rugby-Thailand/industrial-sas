# Finished-goods putaway recommendations with minimal setup

Research brief, 2026-08-28. This note answers two operational questions:

1. When a completed finished-good handling unit has reliable measurements, how
   should the system recommend where it goes?
2. When it has not been measured, how can the system still help without making
   a false claim that it fits?

The requested ranking signals are **available area**, **finished-good production
order number**, **customer order**, and **customer**. The proposal deliberately
does not require racks, platforms, grids, or exact child positions to be set up
before the warehouse can use putaway.

Evidence labels used below:

- **Sourced fact** is directly supported by an official SAP, Microsoft, Oracle,
  or GS1 publication.
- **Product recommendation** is an ISAS design decision inferred from those
  facts and from the requested finished-goods workflow. No cited vendor is
  claimed to use ISAS's exact score or customer-order priority.

## Executive answer

Use a two-tier location model:

- Every active **Storage Area** is immediately usable as one general/open-storage
  stock address. Its existing area ID and QR identify that address. No mode,
  fixture, or child-position setup is required.
- Optional child positions, racks, or platforms add precision where a site needs
  it. Their absence must not block finished-goods putaway.

This is consistent with SAP EWM's **General Storage** strategy, where a storage
section has a single storage bin and may contain mixed stock. SAP also models
bulk storage with one bin per physical row containing multiple handling units,
rather than requiring an address for every pallet footprint. [SAP: Strategy:
General Storage](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/9832125c23154a179bfa1784cdc9577a/eccccb53ad377114e10000000a174cb4.html),
[SAP: Strategy: Bulk Storage](https://help.sap.com/saphelp_ewm900/helpdata/en/88/4a8041a17e060de10000000a1550b0/content.htm?no_cache=true)

An Area may therefore remain the stock address indefinitely if area-level
traceability is sufficient for that warehouse. Adding detailed positions later
must not force an immediate migration of existing stock. Existing area stock is
shown as **general/open area stock**; new putaways can target either the area or
an optional exact child according to site policy.

The recommendation engine must report a **confidence level**, not just a ranked
location:

- **High confidence:** the particular handling unit has trusted dimensions and
  weight; candidate geometry/capacity and current occupancy are trusted.
- **Medium confidence:** dimensions come from the same verified item + package
  configuration, or the handling unit is measured but area occupancy is only an
  aggregate estimate.
- **Low confidence / visual confirmation required:** physical measurements are
  unknown; the recommendation is based on order/customer affinity and a broad
  open-storage availability signal.
- **No safe recommendation:** a known hard rule fails everywhere, or an
  engineering-sensitive destination cannot be validated. Keep the unit in the
  finished-goods staging/measurement flow and state each reason.

Unknown data is not the same as a failed check. The system must not turn missing
dimensions into zero dimensions, pretend the unit fits, or reject all general
storage solely because a measurement is absent.

### Keep the three business keys distinct

- **Finished-good production order** (`productionOrderId`) is the internal
  manufacturing execution order that produced the finished unit. It answers
  “which manufacturing run made this?” A production order defines what is made,
  where and when it is made, and the work required. [SAP: Production
  Orders](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/34de0103497c4b80a7c7fbf6952ff971/5f7cb6535fe6b74ce10000000a174cb4.html)
- **Customer sales order** (`customerOrderId`) is the customer's specific request
  for defined products/quantities and delivery timing. One sales order may have
  multiple items and may be fulfilled by multiple production orders. [SAP: Sales
  Order Definition](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/7b24a64d9d0941bda1afa753263d9e39/4d64b65334e6b54ce10000000a174cb4.html)
- **Customer** (`customerId`) is the enduring party/account. One customer can
  have many open and completed sales orders. Use the warehouse's operational
  ship-to or stock-owner identity when that differs from the sold-to account;
  SAP explicitly distinguishes sales-order partner functions such as sold-to
  and ship-to.

These keys are related but are not substitutes. Exact production-order affinity
is the strongest default grouping signal, exact open customer-order affinity is
next, and customer-only affinity is deliberately weaker.

## What the primary sources establish

### Low-setup and dynamic storage are normal WMS patterns

- **Sourced fact:** SAP lists manual entry, fixed bin, general storage, addition
  to existing stock, empty bin, near fixed bin, handling-unit-type pallet
  storage, and bulk storage as distinct putaway strategies. Rack modelling is
  not a prerequisite for all putaway. [SAP: Putaway
  Strategies](https://help.sap.com/docs/PRODUCT_ID/3d97bec9bf1649099384bb8167df3cf2/4cb4cf6b0c056642e10000000a15822b.html)
- **Sourced fact:** SAP General Storage defines one bin per storage section.
  Mixed stock can be placed in that single bin. [SAP: Strategy: General
  Storage](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/9832125c23154a179bfa1784cdc9577a/eccccb53ad377114e10000000a174cb4.html)
- **Sourced fact:** SAP's pallet-storage strategy can create sub-bins on first
  putaway and delete them after the main bin becomes empty. Stock exists on the
  dynamic sub-bins, while the main-bin subdivision can change over time. This
  establishes that detailed addressing can be created lazily rather than fully
  preconfigured. [SAP: Putaway Strategy in
  EWM](https://help.sap.com/docs/SUPPORT_CONTENT/sewm/3354621720.html)
- **Sourced fact:** Microsoft location-directive actions can select the first
  eligible location, consolidate with similar stock, or choose an empty location
  with no physical inventory or expected inbound work. Rules can include fixed
  and non-fixed locations, quantities, units of measure, and splitting. [Microsoft:
  Set up a location directive for purchase-order
  putaway](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/tasks/set-up-location-directive-purchase-order-put-away)
- **Sourced fact:** Oracle system-directed putaway pairs putaway types with
  location-size types, applies a location sequence, and checks configured unit,
  LPN-count, volume, and weight limits. Search modes include empty, most empty,
  and least empty. [Oracle: System Directed
  Putaway](https://docs.oracle.com/en/cloud/saas/warehouse-management/23a/owmol/system-directed-putaway.html)

**Product recommendation:** create an Area as a usable general-storage address
with no extra form. Treat optional detailed structures as an enhancement, not a
prerequisite.

### Consolidation is a preference after eligibility

- **Sourced fact:** SAP's “addition to existing stock” strategy first looks for a
  bin already containing the same product with sufficient free capacity, then
  looks for the next empty bin. SAP warns that this strategy can violate FIFO.
  [SAP: Addition to Existing
  Stock](https://help.sap.com/saphelp_ewm900/helpdata/en/53/6a8741bf56040de10000000a1550b0/content.htm?no_cache=true)
- **Sourced fact:** Microsoft can direct compatible variants of the same product
  master to the same bulk location and direct a different product elsewhere;
  whether mixing is allowed is explicit configuration. [Microsoft: Location
  product dimension
  mixing](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/location-product-dimension-mixing)
- **Sourced fact:** Microsoft exposes location status and volumetric utilization
  and lets a manager consolidate inventory to improve space usage. [Microsoft:
  Item consolidation and location
  utilization](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/item-consolidation-location-utilization)
- **Sourced fact:** Oracle's regular task templates can select and order work by
  customer number/name, order number, customer PO number, ship-to facility, and
  destination company/facility. This proves these business keys are valid
  warehouse-work grouping signals, but it does **not** prove that standard Oracle
  putaway ranks destinations by those fields. [Oracle: Task Template Type:
  Regular](https://docs.oracle.com/en/cloud/saas/warehouse-management/26a/owmol/ordering-criteria-fields-1.html)
- **Sourced fact:** GS1 defines an SSCC as the identifier for an individual
  logistics unit and a GSIN as a grouping of logistics units that need to be
  delivered together. The relation between an SSCC and its shipment grouping is
  recorded data, not part of the physical identifier itself. [GS1 Global
  Traceability Standard](https://www.gs1.org/standards/gs1-global-traceability-standard/current-standard)
- **Sourced fact:** the GS1 Logistic Label's customer segment commonly carries
  ship-to, purchase-order, and customer-specific routing information, while the
  SSCC remains the stable logistics-unit identifier. [GS1 Logistic Label
  Guideline](https://www.gs1.org/standards/gs1-logistic-label-guideline/1-3)

**Product recommendation:** use production order, customer order, and customer
as transparent ranking preferences. They must never override known safety,
quality, compatibility, or prohibition rules. Display the matched grouping keys
as reasons so the operator can understand the recommendation.

### Measurements enable stronger capacity and fit claims

- **Sourced fact:** Microsoft directed putaway uses item-unit height, width,
  length, cubage, and weight when calculating efficient suggestions. [Microsoft
  Business Central: Set up items and locations for directed putaway and
  pick](https://learn.microsoft.com/en-gb/dynamics365/business-central/warehouse-how-to-set-up-items-for-directed-put-away-and-pick)
- **Sourced fact:** Oracle can validate item or LPN dimensions against a location
  using orientation-flexible matching, height matching, or exact length/width/
  height matching. [Oracle: Validate Critical Dimensions for Putaway and
  Replenishment](https://docs.oracle.com/en/cloud/saas/warehouse-management/25d/owmol/validate-critical-dimensions-for-putaway-and-replenishment.html)
- **Sourced fact:** Oracle location capacities can be expressed as maximum units,
  LPNs, volume, or weight. When configured, a full location is skipped, and a
  locked-for-putaway location is not an eligible destination. [Oracle: Location
  Master](https://docs.oracle.com/en/cloud/saas/warehouse-management/25d/owmol/location-master.html)
- **Sourced fact:** SAP capacity checking can use weight, volume, quantity/
  handling units, or a capacity key, and remaining capacity is calculated from
  stock and handling units already present. [SAP: Capacity
  Check](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/9832125c23154a179bfa1784cdc9577a/8cc8cb53ad377114e10000000a174cb4.html)
- **Sourced fact:** GS1 publishes standard package-measurement rules so that
  length, width, height, and gross weight can be measured repeatably at a defined
  package level. GS1 also says measurements should be retaken after a product or
  package change that can affect dimensions or weight, with periodic audits for
  unrecorded changes. [GS1 Package and Product Measurement
  Standard](https://www.gs1.org/standards/gs1-package-and-product-measurement-standard/current-standard)
- **Sourced fact:** Microsoft can associate an inbound license plate with a
  container type whose physical dimensions replace item-master volumetrics for
  putaway. It also supports default container types at several scopes and can
  explicitly allow an unspecified container type. [Microsoft: Inbound putaway
  by container
  type](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/inbound-putaway-by-container-type)

**Product recommendation:** a measurement is reusable only when its package
identity matches: finished-good item/design, package or handling-unit type,
unit/pack quantity, and relevant revision. Record whether a value was directly
measured, imported from trusted master data, copied from a verified matching
package, estimated, or unknown.

## Minimal data model

The following is the minimum needed for the requested workflow. It does not
require a fixture planner.

### Storage Area

- Stable `areaId`, code, QR, warehouse, floor, and active/blocked state.
- Usable floor geometry or, for a lighter site, a manually declared usable area
  in square metres.
- Optional advisory limits: maximum LPN count, planned usable percentage, or
  maximum open-floor stack height.
- Known hard policies only: prohibited storage classes, life-safety exclusions,
  and engineered load limits where applicable.
- Current open-area occupancy and optional detailed child locations.

### Finished-good handling unit

- Stable LPN/SSCC identity.
- Finished-good item/design and package configuration.
- `productionOrderId` and visible production-order number.
- `customerOrderId` and visible customer-order number.
- `customerId` and visible customer name/code.
- Length, width, height, gross weight, measurement provenance, and timestamp;
  each physical field may be unknown.
- Current location and status.

The repository already has the required business chain for these grouping keys:
a production order references a customer-order line; that line references its
customer order; and the customer order references the customer. Recommendation
records should persist the IDs used for scoring, not only display strings.

### Recommendation result

Each candidate needs:

- Area or optional child-location identity and breadcrumb.
- `confidence`: `HIGH`, `MEDIUM`, or `LOW`.
- `fitStatus`: `VERIFIED_FIT`, `ESTIMATED_FIT`, or `FIT_UNKNOWN`.
- Available area/capacity **before and after**, with the calculation method and
  confidence.
- Matched grouping reasons: same production order, customer order, customer,
  item/design, or package configuration.
- Known rejection or warning reasons.
- Whether operator visual confirmation or measurement is required.

## Case 1: the finished good is measured

### Required flow

1. Scan the completed LPN. Resolve its production order, customer order,
   customer, item/design, quantity, and package configuration automatically.
2. Use directly measured LPN dimensions/weight. If they are absent, a trusted
   exact package-master match enters Case 2's medium-confidence branch instead.
3. Build candidates from active Storage Areas and any optional detailed
   locations. An Area itself is a valid general/open-storage candidate.
4. Apply known hard exclusions.
5. Rank the survivors with the requested co-location and availability signals.
6. Show the best recommendation plus two alternatives, the projected space
   after placement, confidence, and plain-language reasons.
7. The operator scans the Area or detailed-location QR and confirms. If the Area
   QR represents general storage, no extra child scan is required.

### Hard eligibility versus ranking

Hard-exclude a candidate only for a **known** violation:

- area/location inactive, blocked, or not a storage destination;
- stock on quality hold, quarantine, rejected, or otherwise non-putawayable;
- prohibited or known-incompatible storage class;
- measured handling unit cannot fit an explicitly bounded rack/slot even after
  allowed orientation changes;
- known gross weight exceeds an approved rack/platform/location rating;
- reserved/egress/fire-clearance geometry is intersected;
- a no-mixing rule is known to be violated.

Do not hard-exclude a large general/open Area merely because its aggregate
planned utilization threshold would be exceeded. Open-area capacity is an
advisory ranking signal unless the site has explicitly modelled a reliable hard
limit.

Rank eligible candidates in this default order:

1. **Same finished-good production order.** Prefer the Area containing the most
   active LPNs/footprint from this exact production order.
2. **Same customer order.** This keeps goods intended for one outbound order
   together even if multiple production orders or line items feed it.
3. **Same customer.** Useful when one customer has several active orders, but
   weaker than the exact order because it can create large mixed clusters.
4. **Same finished-good item/design/package.** Reduces scattering and provides a
   useful fallback when order data is missing.
5. **Best usable-space fit.** Prefer the smallest remaining usable region that
   can accommodate the unit, preserving larger clear regions for larger goods.
6. **Shorter travel and lower fragmentation.** Use as tie-breakers, not ahead of
   exact customer/order grouping.

These weights are product policy, not a vendor standard. Make them tenant
configurable later, but ship the order above as a readable default. The trace
should say, for example:

> Recommended BULK-A · high confidence · same production order PO-FG-1042 (6
> LPNs already here) · same customer order SO-26018 · estimated 18.4 m² remains
> after placement.

Apply affinity only to **currently relevant** stock. Closed or fully shipped
customer orders should not attract new units. For a partially shipped order,
rank using its remaining open quantity and next required ship date; avoid
burying an earlier-dispatch LPN under later-dispatch stock. Mixed SKUs from one
customer order may share an Area, but a configured no-mixing, quality, storage-
class, or stacking rule still wins. A customer-dedicated Area is a hard
ownership/eligibility rule when explicitly configured; “same customer nearby”
is otherwise only a soft preference.

For open-floor stacks, do not infer vertical capacity from footprint alone. A
unit may join a stack only when the relevant package/HU is known to be stackable
and the resulting count, height, weight, and access sequence remain acceptable.
If stackability is unknown, rank it as a new floor footprint rather than
silently placing it on top.

### What “available area” can honestly mean

There are three calculation strengths:

1. **Verified contiguous fit (high):** the Area has usable geometry and occupied
   handling units have reliable footprints and placements. Search an allowed
   orientation against the actual free polygon/grid. Report the contiguous free
   region and projected remainder.
2. **Aggregate footprint estimate (medium):** usable area and each LPN footprint
   are known, but exact X/Y placement is not. Estimate remaining area by
   subtracting occupied and incoming footprints from usable area, then apply the
   site's safety/utilization allowance. Label it an estimate because scattered
   free patches may not form one contiguous rectangle.
3. **Count/manual-capacity estimate (low):** only LPN count or operator-declared
   utilization is known. Rank by that signal but do not express a precise
   square-metre fit.

Never present `area square metres - sum of product square metres` as a verified
fit when placements are unknown. Fragmentation can leave enough total area but
no usable contiguous footprint.

## Case 2: the finished good is not measured

The system should still recommend a useful destination, but it must distinguish
“good grouping choice” from “verified physical fit.”

### Fallback ladder

1. **Reuse trusted package data.** Search for a verified measurement with the
   same item/design, package or HU type, unit/pack quantity, and relevant
   revision. Prefer a directly associated container type over inferred item
   dimensions. Show the source (“verified package master”, “container type”, or
   “measured LPN LPN-…”) and use medium confidence. Do not reuse dimensions
   merely because the customer or broad product family matches. Expire or lower
   confidence for stale evidence after a package/product revision or a site-
   defined review interval; GS1's remeasurement and audit guidance supports this
   caution.
2. **Use a coarse handling-unit class.** If the system knows `PALLET`, `BUNDLE`,
   `CARTON`, or a site-defined `S/M/L` footprint class, use areas accepting that
   class and count/space policies. Keep `fitStatus = ESTIMATED_FIT`.
3. **Recommend a broad open/general Area.** Use the same production-order,
   customer-order, customer, item, and visible-availability ranking. Show low
   confidence and “physical fit not verified.” Require a one-tap visual
   confirmation at the destination.
4. **Offer Measure now.** Measuring raises confidence and may reveal better
   destinations. It is the preferred option when no existing package evidence
   exists, not an unconditional gate for all warehouses.
5. **Use finished-goods staging/measurement only when necessary.** If no open
   Area accepts unknown-size goods, or a weight/load-sensitive destination is
   the only choice, retain the LPN in a clearly identified staging/clarification
   location rather than inventing a fit.

SAP permits bin determination behavior to be configured when slotting data is
absent, and official SAP best-practice material uses a clarification zone when
classification is missing or target-bin weight/volume limits are violated.
[SAP: Storage Bin Determination for
Putaway](https://help.sap.com/docs/SAP_SUPPLY_CHAIN_MANAGEMENT/dc8e3ce481cc493aad2145b99e6c53eb/4acdcb53ad377114e10000000a174cb4.html),
[SAP Best Practices: Storage-type search sequence and clarification
zone](https://help.sap.com/docs/s4hana-best-practices/setting-up-sap-ewm-integration-batch-management-2vn-3a10753530b2c3cc9428573a7e542240/specify-storage-type-search-sequence-for-putaway?locale=en-US&state=PRODUCTION&version=2608)

Oracle similarly falls back from an LPN's missing putaway type to the item
default and only applies max-unit/LPN/volume/weight checks that are configured.
This supports a layered fallback rather than making every physical attribute
mandatory. [Oracle: System Directed
Putaway](https://docs.oracle.com/en/cloud/saas/warehouse-management/23a/owmol/system-directed-putaway.html)

### Safety boundary for unknown data

- Missing dimensions do not make a general/open Area ineligible. They make its
  physical-fit claim unknown.
- Missing weight must not be treated as zero for an engineered rack, shelf, or
  raised platform. Recommend open-floor/general storage or require measurement/
  authorization before using the rated structure.
- A known prohibition remains a hard exclusion even at low confidence.
- A supervisor may override a low-confidence ranking preference with a reason;
  a normal override must not turn a known hard violation into an allowed move.

Example low-confidence result:

> Suggested BULK-A · visual confirmation required · same production order
> PO-FG-1042 and customer order SO-26018 · area appears available by LPN count ·
> package dimensions have not been recorded.

## Data-minimal operator experience

Do not ask the operator to choose storage modes or configure a rack/platform
during finished-goods receipt.

### If measured

The post-completion screen should show:

- LPN, finished-good item, production order, customer order, and customer;
- measured `L × W × H`, gross weight, and measurement provenance;
- one recommended Area with confidence, reason chips, and projected area after;
- two alternatives with concise trade-offs;
- `Scan destination` and `Choose another` actions.

### If unmeasured

Show only the minimum decision:

- `Use verified standard package` when an exact trusted match exists;
- `Measure now`;
- `Place in suggested open Area — confirm visually` when site policy permits;
- `Keep in FG staging` when no safe low-confidence recommendation exists.

On first successful low-confidence placement, allow the operator to capture one
small reusable fact such as footprint class or standard pallet type. Do not force
a complete engineering form.

## Area address versus optional child positions

The earlier rule “stock and ledger balances must always resolve to a separate
leaf Position” is stricter than the requested workflow and stricter than SAP
General Storage's one-bin-per-section model.

Recommended rule:

> A Storage Area is a valid stock address for general/open storage. Optional
> child locations increase precision. A balance must resolve to one valid stock
> address, which may be the Area itself or a child location.

When a warehouse later adds child positions:

- preserve the Area ID, QR, balances, and history;
- label existing Area-level stock as `General area stock`, not as an error;
- new putaway may continue targeting the Area unless the warehouse explicitly
  enables `exact child required` for that Area or structure;
- an operator can progressively move stock to child locations through normal,
  auditable movements;
- a rack slot is always its own address because the rack's structural identity
  and load/fit rules require it; this does not force open-floor stock into the
  same granularity.

This avoids migration work and preserves honest traceability: the system knows
the stock is somewhere in the Area and does not falsely claim a precise marker.

## Failure behavior

1. **No candidate exists:** keep the LPN at its current finished-goods staging
   address and show `No storage Area is active`.
2. **All candidates have known violations:** do not rank the least-bad one. Show
   the rejection reasons by Area and route to supervisor/measurement.
3. **Candidates exist but fit is unknown:** return low-confidence general-Area
   suggestions; do not call this a failure.
4. **Recommended Area changes before confirmation:** reserve advisory capacity
   while the task is active, recheck on destination scan, and rerank if the
   candidate is now blocked or occupied.
5. **Operator chooses another eligible Area:** record the recommended Area,
   chosen Area, confidence, and a short override reason. A co-location preference
   is overrideable.
6. **Known hard rule changes after recommendation:** confirmation must revalidate
   and refuse the move rather than relying on a stale score.

## Edge-case stress tests

The implementation should prove at least these cases:

1. A measured LPN rotates 90 degrees and fits; the recommendation explains the
   orientation used.
2. Total free square metres are sufficient but fragmented into regions that are
   all too small; no high-confidence contiguous-fit claim is returned.
3. The same production-order Area is nearly full; the engine selects the next
   Area and marks it as overflow for that order.
4. Same production order conflicts with a prohibited storage class; the
   prohibition wins.
5. Same customer order and same customer point to different Areas; exact
   customer order wins when both are otherwise eligible.
6. A customer has many unrelated open orders; same-customer affinity cannot
   overwhelm severe fragmentation or travel penalties indefinitely.
7. The first LPN of a new, unmeasured finished good has no package master; the
   system offers a low-confidence open-Area suggestion and Measure now.
8. A previous measurement has the same item but a different pack quantity,
   package type, or product revision; it is not silently reused.
9. Dimensions are known but weight is unknown; an open Area can be suggested,
   while a rated rack/platform is not presented as verified-safe.
10. An Area has no child positions; its Area QR completes putaway directly.
11. An Area later gains child positions while old stock remains at the Area
    address; history and QR remain valid and the UI distinguishes general stock
    from child-addressed stock.
12. Two operators receive the same recommendation concurrently; confirmation
    rechecks occupancy/advisory reservation and reranks one task if needed.
13. An LPN is on QC hold but belongs to the same order as stock in an eligible
    Area; the hold prevents putaway.
14. A measured unit fits by volume but not by actual dimensions; dimension fit
    wins over volume arithmetic.
15. No Area can accept the unit; it stays in FG staging with specific reasons
    rather than receiving a fabricated destination.
16. One customer order contains several finished-good SKUs from multiple
    production orders; exact production-order groups remain readable while
    customer-order affinity can still keep eligible groups nearby.
17. A customer order is partially shipped; only its remaining open requirement
    attracts new stock, and earlier-dispatch units are not buried behind later
    units.
18. A customer has a dedicated-stock Area; its stock cannot be recommended into
    another customer's dedicated Area even when that Area has more free space.
19. A package-master measurement is stale or belongs to a superseded revision;
    confidence is reduced or measurement is requested instead of claiming a
    verified fit.
20. Several LPNs share one open-floor stack; stackability, total planned height,
    weight, and access order are checked separately from floor footprint.

## Recommended first implementation slice

1. Make every Area a valid general-storage stock address without additional
   setup. Keep optional child locations.
2. Add production-order, customer-order, and customer affinity to candidate
   facts and the persisted recommendation trace.
3. Add dimension/weight provenance and recommendation confidence.
4. Implement the measured path using known hard filters and transparent ranking.
5. Implement the unmeasured fallback to verified package data, then low-confidence
   open-Area suggestion, then FG staging.
6. Show available area as `verified`, `estimated`, or `unknown`; never as an
   unlabeled precise number.
7. Defer detailed free-polygon packing, racks, and platforms. They improve later
   recommendations but are not required to deliver useful finished-goods
   putaway now.

## Primary sources

- [SAP: Putaway Strategies](https://help.sap.com/docs/PRODUCT_ID/3d97bec9bf1649099384bb8167df3cf2/4cb4cf6b0c056642e10000000a15822b.html)
- [SAP: Strategy: General Storage](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/9832125c23154a179bfa1784cdc9577a/eccccb53ad377114e10000000a174cb4.html)
- [SAP: Strategy: Addition to Existing Stock](https://help.sap.com/saphelp_ewm900/helpdata/en/53/6a8741bf56040de10000000a1550b0/content.htm?no_cache=true)
- [SAP: Strategy: Bulk Storage](https://help.sap.com/saphelp_ewm900/helpdata/en/88/4a8041a17e060de10000000a1550b0/content.htm?no_cache=true)
- [SAP: Storage Bin Determination for Putaway](https://help.sap.com/docs/SAP_SUPPLY_CHAIN_MANAGEMENT/dc8e3ce481cc493aad2145b99e6c53eb/4acdcb53ad377114e10000000a174cb4.html)
- [SAP: Capacity Check](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/9832125c23154a179bfa1784cdc9577a/8cc8cb53ad377114e10000000a174cb4.html)
- [Microsoft: Control warehouse work using location directives](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/control-warehouse-location-directives)
- [Microsoft: Purchase-order putaway location directive](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/tasks/set-up-location-directive-purchase-order-put-away)
- [Microsoft: Item consolidation and location utilization](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/item-consolidation-location-utilization)
- [Microsoft: Location product dimension mixing](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/location-product-dimension-mixing)
- [Microsoft Business Central: Item dimensions for directed putaway](https://learn.microsoft.com/en-gb/dynamics365/business-central/warehouse-how-to-set-up-items-for-directed-put-away-and-pick)
- [Oracle: System Directed Putaway](https://docs.oracle.com/en/cloud/saas/warehouse-management/23a/owmol/system-directed-putaway.html)
- [Oracle: Putaway Priorities](https://docs.oracle.com/en/cloud/saas/warehouse-management/25d/owmol/putaway-priorities.html)
- [Oracle: Critical-dimension validation](https://docs.oracle.com/en/cloud/saas/warehouse-management/25d/owmol/validate-critical-dimensions-for-putaway-and-replenishment.html)
- [Oracle: Location Master](https://docs.oracle.com/en/cloud/saas/warehouse-management/25d/owmol/location-master.html)
- [Oracle: Task-template criteria and ordering](https://docs.oracle.com/en/cloud/saas/warehouse-management/26a/owmol/ordering-criteria-fields-1.html)
- [GS1: Package and Product Measurement Standard](https://www.gs1.org/standards/gs1-package-and-product-measurement-standard/current-standard)
- [Microsoft: Inbound putaway by container type](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/inbound-putaway-by-container-type)
- [GS1: Global Traceability Standard](https://www.gs1.org/standards/gs1-global-traceability-standard/current-standard)
- [GS1: Logistic Label Guideline](https://www.gs1.org/standards/gs1-logistic-label-guideline/1-3)
