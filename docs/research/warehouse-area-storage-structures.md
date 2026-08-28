# Warehouse areas with heterogeneous storage structures

Research brief, 2026-08-28. This note tests a revised storage-layout model in
which a **Storage Area has no storage mode** and may contain open-floor stacks,
racks, shelving, and raised platforms at the same time.

Evidence labels used below:

- **Sourced fact** means the statement is directly supported by the linked
  regulator, standard owner, or first-party product documentation.
- **Design inference/recommendation** means it is a proposed product decision
  derived from those facts and the repository's current domain model.

This is product and domain research, not structural, fire-protection, or legal
approval. OSHA and ICC citations below are United States examples. OSHA-approved
State Plans can add or change requirements, and ICC model codes become binding
only when adopted by the relevant jurisdiction. [OSHA: State Plan
FAQ](https://www.osha.gov/stateplans/faqs), [ICC: I-Code
adoption](https://www.iccsafe.org/products-and-services/i-codes/ibc/) The adopted
code edition, amendments, permit process, seismic criteria, fire-protection
design, and required professional approvals are jurisdiction- and site-dependent.
They must be configured or evidenced per warehouse rather than hard-coded as
globally applicable law.

For a Thailand deployment, the Department of Labour Protection and Welfare's
official FAQ treats work from 2 metres above ground or a building floor as work
at height when a fall is possible, and says the employer must establish safe
work rules/procedures covering hazard identification, planning, prevention and
control, then train or brief workers before work. The Department also publishes
the 2021 ministerial regulation governing hazards from falls, falling materials,
and collapse. [Thailand DLPW: work-at-height
FAQ](https://osh.labour.go.th/%E0%B8%84%E0%B8%B3%E0%B8%96%E0%B8%B2%E0%B8%A1%E0%B8%96%E0%B8%B2%E0%B8%A1%E0%B8%9A%E0%B9%88%E0%B8%AD%E0%B8%A2/),
[Thailand DLPW: 2021 work-at-height ministerial
regulation](https://osh.labour.go.th/%E0%B8%95%E0%B8%81%E0%B8%88%E0%B8%B2%E0%B8%81%E0%B8%97%E0%B8%B5%E0%B9%88%E0%B8%AA%E0%B8%B9%E0%B8%87-2564/)
This reinforces the product rule: record the warehouse's jurisdiction and
approved rule set; do not ship US OSHA/IBC thresholds as Thai compliance rules.

## Executive conclusion

**Recommendation:** make **Storage Area mode-less**. An area is only a bounded
planning and policy region. The user selects an area and then adds any compatible
combination of storage structures or arrangements inside it: open-floor position
sets, racks, shelving, and raised platforms. A platform creates an elevated
support surface; positions and, where an engineer-approved design permits it,
racks or shelving can be placed on that surface.

Inventory still belongs to exactly one **leaf Storage Position**. A structure is
not a stock address unless it has exactly one leaf and scanning it resolves that
leaf. Area and structure QR codes may navigate or start a selection flow, but
ledger balances must never remain on either parent.

This is a better fit than `Area.mode` because:

1. Safety and engineering requirements attach to the physical rack, shelf, or
   platform, not to an arbitrary large area surrounding it.
2. One real area can legitimately contain floor stacks beside a rack, or storage
   on and below a raised platform.
3. Official warehouse systems separate grouping from leaf-location behavior:
   Microsoft zones are process filters while location profiles govern policies
   and capacity; SAP calls the storage bin the smallest exact spatial unit.
4. The current backwards-compatible behavior remains possible: an area with no
   added structure owns one default open-floor leaf, so a simple site gains no
   setup work.

The current accepted model in [ADR-0017](../adr/0017-storage-areas-and-leaf-positions.md)
therefore needs a future superseding ADR. Its leaf-address, stable-identity,
scanning, ledger, and Quick Change invariants should remain; only the rule that
each area selects one mode should change.

## What primary sources establish

### Grouping is not the leaf stock address

- **Sourced fact:** SAP EWM defines a storage bin as the smallest spatial unit
  and the exact position where product can be stored. It can carry maximum
  weight, total capacity, fire-containment section, and a bin type; its address
  may encode aisle, stack, and level. [SAP: Storage Bin](https://help.sap.com/docs/SAP_SUPPLY_CHAIN_MANAGEMENT/dc8e3ce481cc493aad2145b99e6c53eb/55c8cb53ad377114e10000000a174cb4.html)
- **Sourced fact:** Microsoft Warehouse Management defines zones as filters for
  warehouse processes. Separately, a location profile groups locations that
  share storage policies and capacity behavior, and the location itself is the
  place inventory is put to or picked from. [Microsoft: Configure locations in
  a WMS-enabled warehouse](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/tasks/configure-locations-wms-enabled-warehouse)
- **Sourced fact:** Oracle's active location master describes a leaf using area,
  aisle, bay, level, optional position/bin, barcode, and physical dimensions.
  [Oracle: Active Locations](https://docs.oracle.com/en/cloud/saas/warehouse-management/26c/owmim/active-locations.html)

**Design inference/recommendation:** `Storage Area` should be a spatial/policy
group; physical behavior and capacity belong to its child structures and leaf
positions. Do not make the area's type determine every child.

### Stable sub-location identity

- **Sourced fact:** GS1 permits a physical sub-location to have its own GLN or,
  for internal/mutually agreed use, a GLN plus extension component. GS1 examples
  reach the granularity of a specific shelf area. [GS1 General Specifications,
  physical-location identification](https://ref.gs1.org/standards/genspecs/)
- **Sourced fact:** GS1's GLN allocation rules define a sub-location as a
  specific space within another physical location and allow it to be identified
  independently. [GS1 GLN Allocation Rules](https://www.gs1.org/standards/gs1-gln-allocation-rules-standard/current-standard)

**Design inference/recommendation:** retain the repository's stable internal
`locationId` and QR payload for every leaf. Geometry, rack-beam elevation, or
display breadcrumb may change without changing that identifier. Do not encode
X/Y/Z geometry into the QR value.

### General storage, clearance, and egress

- **Sourced fact:** OSHA requires safe clearance where mechanical equipment
  turns or passes, clear and marked permanent aisles, stable tiered storage, and
  posted clearance limits. [OSHA 29 CFR 1910.176](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.176)
- **Sourced fact:** OSHA requires exit routes to remain free of materials and
  equipment. Its federal minimum exit-access width is 28 inches, but occupant
  load and adopted codes can require more. [OSHA 29 CFR 1910.36](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.36),
  [OSHA 29 CFR 1910.37](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.37)
- **Sourced fact:** OSHA requires every walking-working surface to support its
  maximum intended load, have safe access/egress, and be inspected and repaired.
  Structural-integrity repairs require a qualified person. [OSHA 29 CFR
  1910.22](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.22)
- **Sourced fact:** where the OSHA sprinkler rule applies, stored material must
  remain at least 18 inches below sprinklers and must not interfere with their
  discharge pattern. OSHA notes that high-rack or special-hazard designs can
  require greater clearances. [OSHA 29 CFR 1910.159](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.159),
  [OSHA interpretation of sprinkler clearance](https://www.osha.gov/laws-regs/standardinterpretations/2008-09-29)
- **Sourced fact:** NFPA 13's storage design is configuration-sensitive; its
  dedicated chapters cover general storage, high-piled storage, and in-rack
  sprinklers. NFPA's approved-storage-plan material identifies storage
  dimensions/height, commodity classification, sprinkler/ceiling clearance,
  aisles, fire-department access, and in-rack sprinkler valves as relevant plan
  data. [NFPA 13 preview](https://link.nfpa.org/all-publications/13/2022),
  [NFPA 13 committee report on approved storage floor plans](https://docinfofiles.nfpa.org/files/AboutTheCodes/13/NITMAM_MC_Report_A2024.pdf)
- **Sourced fact:** the 2024 IFC treats commodity, storage height, pile/rack
  arrangement, aisles, flue spaces, and fire protection as inputs to high-piled
  combustible-storage design. Its high-piled threshold is generally above 12
  feet, or above 6 feet for specified high-hazard commodities when required by
  the fire official. These values are model-code examples, not global defaults.
  [ICC: 2024 IFC high-piled storage definition](https://codes.iccsafe.org/content/IFC2024P1/chapter-2-definitions),
  [ICC: 2024 IFC Chapter 32](https://codes.iccsafe.org/content/IFC2024V1.0/chapter-32-high-piled-combustible-storage)

**Design inference/recommendation:** aisle, exit, fire-access, sprinkler, and
other clearance geometry must be first-class exclusion volumes/surfaces. A
structure may not overlap them merely because its footprint fits within the
area.

### Rack and shelf design is configuration-specific

- **Sourced fact:** the 2024 IBC points steel storage-rack design, testing, and
  use to ANSI MH16.1; cantilever racks to ANSI MH16.3; boltless steel shelving to
  ANSI MH28.2; and stairs, ladders, and guards serving racks/work platforms to
  MHI ANSI/MH 32.1. Which IBC edition is enforceable depends on local adoption.
  [ICC: 2024 IBC Chapter 22](https://codes.iccsafe.org/content/IBC2024V1.0/chapter-22-steel)
- **Sourced fact:** RMI defines rack capacity as the maximum allowable product
  loading after design safety factors and defines a capacity plaque as the
  permanently displayed permissible loading. [RMI glossary](https://og.mhi.org/rmi/terms)
- **Sourced fact:** rack capacity depends on configuration. Manufacturer
  guidance says frame capacity depends on maximum vertical beam spacing; RMI
  guidance says a qualified rack engineer should review the original Load
  Application and Rack Configuration (LARC) drawing before reconfiguration.
  [Steel King: Rack Damage and Capacity](https://www.steelking.com/wp-content/uploads/2025/04/2305-WP-Rack-Safety_PalletRackSafety.pdf),
  [RMI: Before relocating or reconfiguring rack](https://www.rmiracksafety.org/2019/09/30/before-relocating-or-reconfiguring-rack-watch-rmis-new-safety-video/)

**Design inference/recommendation:** rack levels are not free-form stock Z
coordinates. They are stable level records on a particular rack, with elevation
and rated load derived from an approved rack configuration. Moving or adding a
beam level changes the rack configuration and must not be treated as a harmless
marker drag.

### A raised storage/work platform is not automatically a building floor

- **Sourced fact:** ANSI MH28.3 describes an industrial steel work platform as a
  prefabricated, normally free-standing non-building structure with an elevated
  surface in a restricted industrial environment. It excludes foundation/slab
  design and sends special designs to a qualified design professional. [MHI
  standards catalogue: ANSI MH28.3](https://og.mhi.org/downloads/learning/standards/standardsCatalog_March2022.pdf)
- **Sourced fact:** the 2024 IBC separately references ANSI MH28.3 for industrial
  steel work platforms. It also has separate design sections for racks,
  shelving, and platform access/guarding. [ICC: 2024 IBC Chapter
  22](https://codes.iccsafe.org/content/IBC2024V1.0/chapter-22-steel)
- **Sourced fact:** under 2021 IBC terminology, a mezzanine is part of the story
  below, has limits including clear height above and below, area, openness, and
  egress. An equipment platform is unoccupied and exclusively for mechanical or
  industrial-process equipment; it is not a generic storage deck. [ICC: 2021
  IBC Section 505](https://codes.iccsafe.org/content/IBC2021V2.0/chapter-5-general-building-heights-and-areas),
  [ICC definition: Equipment Platform](https://codes.iccsafe.org/content/IFC2024P1/chapter-2-definitions)
- **Sourced fact:** OSHA generally requires fall protection at an unprotected
  side or edge 4 feet or more above a lower level. Guard systems have prescribed
  criteria; toeboards/screens are required where falling materials threaten
  people below. [OSHA 29 CFR 1910.28](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.28),
  [OSHA 29 CFR 1910.29](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.29)
- **Sourced fact:** the 2021 IBC guard trigger for open-sided walking surfaces,
  including mezzanines and equipment platforms, is more than 30 inches above the
  lower surface. That differs from OSHA's general 4-foot employee fall-protection
  trigger, illustrating why the product must retain the applicable authority and
  approved rule set rather than one universal threshold. [ICC: 2021 IBC Section
  1015](https://codes.iccsafe.org/content/IBC2021P1/chapter-10-means-of-egress)
- **Sourced fact:** OSHA requires standard stairs for regular travel between
  working levels and defines stair angle, tread, width, landing, load, handrail,
  and headroom rules. [OSHA 29 CFR 1910.25](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.25)

**Design inference/recommendation:** the UI may call the product a **Raised
Storage Platform**, but activation must record its approved code classification:
`INDUSTRIAL_WORK_PLATFORM`, `MEZZANINE`, or another jurisdiction-specific class.
Never classify a storage deck as `EQUIPMENT_PLATFORM` merely to avoid mezzanine
rules. A full building floor remains a `Storage Floor`; a platform is a child
structure inside an area and does not silently increment the building's floor
count.

## Proposed domain vocabulary

| Term                       | Meaning                                                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Storage Area**           | A bounded X/Y planning and policy region on one Storage Floor. It has no storage mode and is never an ambiguous final stock address.                            |
| **Open-floor arrangement** | Positions or grid cells placed directly on a support surface without a physical fixture.                                                                        |
| **Storage Fixture**        | A physical `RACK`, `SHELVING`, or `PLATFORM`. It has independent asset identity, geometry, engineering data, inspection state, and lifecycle.                   |
| **Support Surface**        | A plane that can support positions or structures: the floor at Z=0, or a platform deck at its approved top-of-deck elevation.                                   |
| **Rack Bay**               | One stable horizontal rack segment. It owns levels; it is not itself a stock address.                                                                           |
| **Rack/Shelf Level**       | One stable load-bearing elevation within a bay/section. Z is derived from the support surface plus approved beam/shelf elevation.                               |
| **Storage Position**       | The smallest exact leaf address. Ledger balances, stock, placement, and QR identity resolve here.                                                               |
| **Clearance/Access Zone**  | Geometry reserved for aisles, exits, stairs, gates, guards, fire access, sprinkler/flue space, equipment turning, or inspection access. Never a stock position. |
| **Approved Configuration** | The site- and structure-specific drawing/certificate/permit basis that defines geometry, loads, access, and safety limits.                                      |

Recommended relationship:

```text
Storage building
  └─ Storage floor
       ├─ Reserved / clearance zones
       └─ Storage area (mode-less)
            ├─ Floor support surface (Z = 0)
            │    ├─ Open-floor arrangement → leaf positions
            │    ├─ Rack/shelving → bay → level → slot/bin leaf positions
            │    └─ Raised platform
            │         └─ Platform support surface (Z = approved deck elevation)
            │              ├─ floor/grid leaf positions
            │              └─ approved rack/shelving → leaf positions
            └─ Area scan → one leaf auto-selects; many leaves require exact choice
```

Limit fixture nesting initially to **floor → platform → rack/shelving/open
floor**. Reject platform-on-platform, cycles, and arbitrary recursive structures
until a real engineered use case requires them. A rack-supported platform should
be a specific composite structure with one approved configuration, not two
independently editable objects.

## Geometry and containment rules

### Code-owned hard invariants

1. Every structure footprint is contained by its parent support surface and the
   area boundary.
2. Every leaf position is contained by its owning open-floor arrangement,
   rack/shelf slot, or platform surface.
3. Solid structure envelopes may not intersect at overlapping Z ranges.
   Intentional vertical coexistence is represented through support-surface
   parenting, not ignored 2D overlap.
4. Reserved blocks, exit/access routes, required aisles, stairs/landings,
   fire-access zones, guard swing/gate operating zones, sprinkler exclusion
   volumes, and other approved clearances are hard no-overlap geometry.
5. Ordinary floor positions derive Z from their support surface. Rack/shelf leaf
   Z derives from its stable level. Operators never type arbitrary leaf Z.
6. A platform's `topOfDeckElevationMm` plus its structural depth must leave the
   approved clear height below; its deck-to-ceiling envelope must leave the
   approved clear height and sprinkler/storage clearance above.
7. A structure in `DRAFT`, `AWAITING_APPROVAL`, `OUT_OF_SERVICE`, or
   `INSPECTION_HOLD` cannot receive new stock.
8. Deleting an occupied leaf is refused. Geometry/configuration changes affecting
   occupied leaves name the LPNs, require a physical move plan, and cannot become
   active until the approved configuration is restored.

The planner should perform fast geometry checks, but it must not claim to certify
structural, seismic, egress, accessibility, or sprinkler compliance. Those
require the adopted code, hazard/commodity data, and qualified reviewers.

### Area and support-surface availability

Do not report one misleading "area remaining" number across all elevations.
Report separately:

- **Floor plane available:** area polygon minus the geometric union of reserved
  blocks, required clearances, structure footprints, and assigned open-floor
  position footprints.
- **Platform deck available:** each platform deck minus its stairs/gates,
  required edge/access clearances, child structure footprints, and assigned
  position footprints.
- **Rack/shelf availability:** empty compatible leaf count plus remaining rated
  weight/dimensions per level or slot.
- **Open-floor stack availability:** eligible footprint and remaining planned
  stack height per leaf, with sprinkler/ceiling and stability limits applied.

A raised platform can add usable storage surface above the floor, but the UI
must show it as a separate elevated surface and must not simply add its deck area
to ground-floor availability. Space below the deck is available only if the
approved design, headroom, access, fire protection, and column/brace geometry
permit that declared use.

## Required data when adding a rack or shelving structure

### Identity and geometry

- stable `fixtureId`, code, label, kind, manufacturer/system/model, and status;
- `areaId`, `supportSurfaceId`, X/Y origin, orientation, width, depth, and overall
  height;
- stable bay/section IDs and display codes;
- bay widths/depths, level IDs, beam/shelf elevations, slot/bin count and usable
  dimensions;
- anchor/footplate/column exclusion geometry where relevant;
- optional inspection and asset tag; structure QR may navigate, but leaf QR owns
  stock identity.

### Rated and approved configuration

- approved configuration/LARC drawing reference, revision, approval authority,
  approval date, and adopted standard/code reference;
- maximum unit-load weight, level/beam load, bay/frame load, and any eccentric or
  nonuniform load limits supplied by the engineer/manufacturer;
- allowed pallet/container types and maximum load width/depth/height, including
  required clearances;
- floor/platform support approval and, for a rack on a platform, the approved
  column point-load/load-case reference;
- sprinkler design basis, maximum storage height, required longitudinal/transverse
  flue spaces, in-rack sprinkler locations where applicable, and commodity/hazard
  restrictions;
- protected aisles, pick faces, impact guards, access/egress, and inspection
  clearance geometry;
- latest inspection state and damage/out-of-service hold.

### Level generation rule

Create level records first, then generate leaves from
`structure + bay + level + slot`. The leaf elevation is:

```text
leafZ = supportSurface.topZ + approvedLevel.beamOrShelfElevation
```

Beam spacing, slot clearance, rated load, and top-storage envelope are validated
against the approved configuration. Adding, removing, or moving a beam/level:

1. creates a proposed configuration revision;
2. shows affected leaves and LPNs;
3. blocks removal of occupied leaves;
4. places the structure on approval/inspection hold where engineering review is
   required;
5. preserves existing leaf IDs and QR values for retained logical slots; and
6. updates the capacity plaque/configuration reference before reactivation.

Do not automatically renumber retained level IDs after a deletion. Identity and
printed QR stay stable; the display label may be changed through an audited
mapping if the physical labels are changed too.

## Required data when adding a raised storage platform

### Geometry and intended use

- stable structure identity and area/parent floor support surface;
- footprint, X/Y origin, orientation, `topOfDeckElevationMm`, deck structural
  depth, overall envelope including guards, and column/brace geometry;
- intended use on top and below: storage, walking/working, conveyor/process, or
  explicitly prohibited;
- code classification: `UNKNOWN`, `INDUSTRIAL_WORK_PLATFORM`, `MEZZANINE`, or a
  site-defined approved class; do not offer generic `EQUIPMENT_PLATFORM` for a
  storage use;
- clear height above and below, ceiling/sprinkler elevations, and all required
  access/fire/inspection clearance zones.

### Structural and safety evidence

- rated uniform deck load and concentrated-load limits;
- approved column point loads/foundation or slab verification reference;
- permitted child loads/structures; a rack-on-platform requires an explicit
  approved rack load case rather than comparing only total kilograms;
- stair/ladder type, width, landings, headroom, access points, and egress role;
- guardrails, handrails, toeboards/screens, pallet/loading safety gates, openings,
  and falling-object protection;
- sprinkler protection above/below and any in-rack system interaction;
- occupancy/people limit, accessibility determination, number/travel distance of
  exits where required, permit/AHJ reference, design professional, revision,
  inspection state, and commissioning date.

### Platform activation flow

1. **Select Storage Area** and choose **Add structure → Raised platform**.
2. Draw its footprint and set the proposed deck elevation. The 3D preview shows
   top/bottom clear height, columns, stairs, guard/gate zones, and collision
   warnings.
3. Select intended use above and below. The system asks for the site code
   classification and applicable approval checklist; `UNKNOWN` remains draft.
4. Enter or import the engineered geometry, rated uniform/concentrated loads,
   access/guarding, fire/sprinkler, and approved-document references.
5. Run deterministic geometry and data-completeness checks. Safety-critical
   conflicts block submission; jurisdiction-dependent rules are shown as
   unresolved approval items rather than guessed.
6. A qualified approver records the accepted revision. Only then does the deck
   become an active support surface.
7. Add open-floor positions, shelving, or a separately approved rack on that
   surface. Generate exact leaf addresses and print leaf QR labels.
8. Later geometry or load changes create a new revision and hold affected
   structures/positions until reapproved. Occupied changes require an explicit
   relocation plan; occupied leaf deletion remains blocked.

## Putaway and "where will it fit?" flow

The structure model enables the operational flow the user described:

1. Scan or select the LPN/handling unit.
2. Load measured storage dimensions, weight, container/pallet type, stackability,
   storage class, and prohibited-location rules. If measurements are missing,
   capture them before recommendation.
3. Search active leaf positions across all structures in allowed areas.
4. Hard-filter candidates by exact access/tenant scope, leaf activity, structural
   rated load, footprint/dimensions (including allowed 90-degree rotation),
   structure/slot compatibility, prohibited class, clearance, and reserved
   geometry.
5. Calculate advisory utilization and rank valid leaves by fit waste, remaining
   height/volume/slot capacity, travel, consolidation, rotation/expiry, and local
   operating policy.
6. Show the operator exact candidates on the map with a readable breadcrumb and
   the predicted remaining capacity, for example:

   ```text
   Floor 1 › BULK-A › Rack A › Bay 03 › Level 02 › Slot 01
   Fits normally · rated load remaining 420 kg · 180 mm headroom after putaway
   ```

7. Require scanning or choosing the exact leaf. Scanning an area/structure with
   one eligible leaf may select it; multiple leaves must never be guessed.
8. Confirm the move and update ledger balance, leaf occupancy, and placement in
   one transaction. Recompute surface/slot availability from authoritative
   placements.

SAP documents automatic destination-bin determination and weight/volume capacity
checks, while Microsoft documents using handling-unit dimensions to select a
valid putaway location. These establish that dimension-aware leaf search is a
normal WMS capability, although neither product's algorithm should be copied as
this product's domain rule. [SAP: Storage Bin Determination for Putaway](https://help.sap.com/docs/SAP_SUPPLY_CHAIN_MANAGEMENT/ce32eae1b3db423fb4625f3d692cae6f/4acdcb53ad377114e10000000a174cb4.html),
[SAP: Capacity Check](https://help.sap.com/docs/PRODUCT_ID/3d97bec9bf1649099384bb8167df3cf2/8cc8cb53ad377114e10000000a174cb4.html),
[Microsoft: Inbound putaway by container type](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/inbound-putaway-by-container-type)

## Hard constraints versus advisory capacity

The current blanket phrase "capacity remains advisory" is too broad once the
model contains engineered structures. Distinguish **planning utilization** from
**rated safety capacity**.

| Rule                                                                                           | Product treatment                                  | Reason                                                                                                                |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Exact active leaf, tenant/warehouse access, prohibited storage class                           | **Hard**                                           | Inventory identity and authorization invariants.                                                                      |
| Position/slot physical dimensions and footprint fit                                            | **Hard** when measurements are known               | A handling unit cannot occupy geometry it does not fit. Missing measurements mean no automatic safe recommendation.   |
| Rated rack beam/level/bay/frame load                                                           | **Hard**                                           | It is a structural safety limit, not a utilization preference.                                                        |
| Rated platform uniform/concentrated/approved child load                                        | **Hard**                                           | OSHA requires the surface to support intended loads; rack post loads cannot be inferred safely from aggregate weight. |
| Exit, aisle, stair/landing, guard/gate, fire-access, sprinkler and approved-clearance geometry | **Hard** when the approved site rule is configured | Storage cannot obstruct an approved life-safety path or protection design. Values are jurisdiction/site dependent.    |
| Structure approval, inspection hold, or damaged/out-of-service state                           | **Hard**                                           | Draft or unsafe structures cannot receive stock.                                                                      |
| Planned stack height below certified/approved storage envelope                                 | **Advisory** unless site policy makes it a limit   | It is an operating target; stability, clearance, and approved maximums remain hard.                                   |
| Volume/cube utilization                                                                        | **Advisory**                                       | Equal volume does not prove packability. Use dimensions/positioning for hard fit.                                     |
| Recommended area, consolidation, travel distance, preferred class, fill percentage             | **Advisory ranking**                               | These optimize operations among otherwise valid leaves.                                                               |
| Area-level "remaining m²"                                                                      | **Advisory summary**                               | It is derived from modeled footprints and does not prove that an arbitrary LPN fits; show per support surface.        |

## Backwards-compatible evolution

1. Existing `SIMPLE` area → mode-less area plus its historical default
   `OPEN_FLOOR` leaf. Reuse the existing `locationId`, code, QR, history, and
   placements.
2. Existing `FLOOR_POSITIONS` area → mode-less area plus one open-floor structure
   containing the current leaves.
3. Existing `RACK` area → mode-less area plus one rack structure; retain leaf IDs
   and map existing bay/level/slot data into stable child records.
4. Existing `PLATFORM` area → mode-less area plus one platform structure and
   platform support surface; retain position IDs and derive their Z from the
   migrated deck elevation.
5. Keep the old area-mode field readable only during a bounded migration window.
   New writes create structures and never set area behavior globally.
6. The historical default leaf remains scannable. Once an area has multiple
   active leaves, an area scan opens exact-position selection and new stock
   cannot be posted ambiguously to the parent/default by accident.

## Proposed planner flow

```text
Create/select area
  → no storage-mode question
  → area initially works as one simple open-floor leaf
  → Add storage structure
       ├─ Open-floor positions/grid
       ├─ Rack or shelving
       └─ Raised platform
            → approve deck/support surface
            → add positions or approved rack/shelving on deck
  → activate exact leaves
  → measure LPN
  → recommend compatible leaves and predicted remaining capacity
  → operator scans exact leaf
```

The area editor should therefore answer two different questions explicitly:

- **What physical structures and clearances exist inside this area?** — planner
  geometry and approvals.
- **Which exact leaf can receive this measured handling unit, and what remains
  afterward?** — operational putaway recommendation.

Keeping these questions separate removes the confusing area-wide mode while
preserving exact stock identity and enabling mixed real-world layouts.
