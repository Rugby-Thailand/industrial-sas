# Finished-goods delivery evidence

The authenticated app is running at http://localhost:3100/th/finished-goods.

- [Finished walkthrough video](finished-goods-walkthrough.mp4) — 68 seconds, 1440 × 900, H.264. Edited browser viewport recording; pauses and refresh troubleshooting omitted. No audio.
- [Current UI flow and diagram](../../docs/plans/finished-goods-flow-2026-09-05/flow.md)
- [Original generated design screens](../../docs/plans/finished-goods-flow-2026-09-05/index.html)
- [Implementation decisions and limits](../../docs/plans/finished-goods-flow-2026-09-05/implementation-notes.md)
- [Test report](test-results.md)
- [Recording provenance and edits](recording/edit-notes.md)

## Completed screens

| Screen | Desktop | Mobile / tablet |
| --- | --- | --- |
| Product details | [Product](13-final-product-desktop.png) | [390 px form](07-product-mobile.png) |
| Measurement | [Measured pallet](14-final-measurement-desktop.png) | [390 px measurement](04-measurement-mobile.png) |
| Exact position | [FG-1 placement](15-final-exact-placement-desktop.png) | [Confirmation](09-confirm-placement-mobile.png) |
| Confirm / verify | [Reservation dialog](16-final-confirmation-desktop.png), [verified destination](17-final-verified-destination.png) | [No-fit recovery](08-no-fit-mobile.png) |
| Stored | [Complete FG-1 overview](23-final-stored-overview.png), [detail](18-final-stored-desktop.png) | [320 px](22-stored-small-mobile.png), [390 px](10-stored-mobile.png), [English tablet](11-stored-tablet-english.png) |
| Planner integration | [Floor](19-final-floor-desktop.png), [location card](20-final-location-card-desktop.png) | [Empty warehouse](12-empty-warehouse-tablet.png) |
| Guards | [Occupied geometry blocked](21-occupied-edit-blocked.png) | [Catalogue](06-catalogue-mobile.png) |

## Local QA records

- `FG-001 / P-000001`: stored in the demo building at X 0.2 m, Y 0.3 m, Z 0 m, orientation 0°.
- `FG-MOBILE-QA / P-000002`: measured, reservation cancellation tested, awaiting placement.
- `FG-002 / P-000003`: final walkthrough; stored in `BLDG-A → Floor 4 → FG-1 → POS-000003`, X 0.2 m, Y 0.3 m, Z 0 m, orientation 90°.

These records are in the isolated local backend. FG-1 is the location name. Product SKU, pallet code, and exact-position code are separate identifiers.

Physical camera scanning was not tested with real camera hardware. Decoder lifecycle and camera failures are covered by automated tests; the recorded end-to-end flow uses the explicit manual destination-code option.
