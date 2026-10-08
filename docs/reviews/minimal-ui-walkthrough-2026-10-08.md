# Real UI walkthrough — minimal redesign

78 actions and states, each captured at desktop **1440 × 1000** and mobile **390 × 844** CSS viewports: **156 screenshots**. These are screenshots of the running application.

Use the [interactive gallery](minimal-ui-gallery-2026-10-08.html) locally to search and compare; expand the actions below in GitHub. [Implementation and UX expectations](../plans/minimal-ui-2026-10-08.md) · [Audit and validation](minimal-ui-audit-2026-10-08.md).

Writes used local `QA-` records. Physical movement was simulated through explicit confirmations. The first packing batch supplied the units for storage/move/stack; the refreshed packing walkthrough created a second QA batch. The two walkthrough scan tickets were deleted after their assignment/deletion checks. No production deployment was used.

Most screenshots were captured through T3 preview during the test/fix loop. The final catalogue, map table, Thai and dark-mode pairs use Chrome, as requested after preview failures. Screenshots record each workflow state at the time of its action; later saves naturally change totals and statuses. Earlier dev captures may include Next’s development indicator.

Camera hardware and an actual phone software keyboard were not exercised; the mobile evidence uses a browser viewport.

## Catalogue and products

<details>
<summary>01-catalogue: Catalogue: desktop table, mobile list, compact totals and collapsed navigation.</summary>

| Desktop                                                                          | Mobile                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| ![Desktop — 01-catalogue](assets/minimal-ui-2026-10-08/01-catalogue-desktop.jpg) | ![Mobile — 01-catalogue](assets/minimal-ui-2026-10-08/01-catalogue-mobile.jpg) |

</details>

<details>
<summary>02-filters: Open filters: select Draft, with sorting and counting-unit controls available.</summary>

| Desktop                                                                      | Mobile                                                                     |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| ![Desktop — 02-filters](assets/minimal-ui-2026-10-08/02-filters-desktop.png) | ![Mobile — 02-filters](assets/minimal-ui-2026-10-08/02-filters-mobile.png) |

</details>

<details>
<summary>03-filter-applied: Apply filters: the selected status stays visible in removable chips and the result set updates.</summary>

| Desktop                                                                                    | Mobile                                                                                   |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| ![Desktop — 03-filter-applied](assets/minimal-ui-2026-10-08/03-filter-applied-desktop.png) | ![Mobile — 03-filter-applied](assets/minimal-ui-2026-10-08/03-filter-applied-mobile.png) |

</details>

<details>
<summary>04-product-new: Create product: required fields and a primary preparation action, optional references closed.</summary>

| Desktop                                                                              | Mobile                                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| ![Desktop — 04-product-new](assets/minimal-ui-2026-10-08/04-product-new-desktop.png) | ![Mobile — 04-product-new](assets/minimal-ui-2026-10-08/04-product-new-mobile.png) |

</details>

<details>
<summary>05-product-validation: Attempt Next with empty required details: validation stays in context.</summary>

| Desktop                                                                                            | Mobile                                                                                           |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ![Desktop — 05-product-validation](assets/minimal-ui-2026-10-08/05-product-validation-desktop.png) | ![Mobile — 05-product-validation](assets/minimal-ui-2026-10-08/05-product-validation-mobile.png) |

</details>

<details>
<summary>06-product-entered: Enter the local QA product details before moving to packing.</summary>

| Desktop                                                                                      | Mobile                                                                                     |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| ![Desktop — 06-product-entered](assets/minimal-ui-2026-10-08/06-product-entered-desktop.png) | ![Mobile — 06-product-entered](assets/minimal-ui-2026-10-08/06-product-entered-mobile.png) |

</details>

<details>
<summary>69-draft-discard-prompt: Canceling an edited product asks whether to continue editing or discard the draft.</summary>

| Desktop                                                                                                | Mobile                                                                                               |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| ![Desktop — 69-draft-discard-prompt](assets/minimal-ui-2026-10-08/69-draft-discard-prompt-desktop.png) | ![Mobile — 69-draft-discard-prompt](assets/minimal-ui-2026-10-08/69-draft-discard-prompt-mobile.png) |

</details>

<details>
<summary>70-draft-continued: Continue editing preserves the entered QA product values.</summary>

| Desktop                                                                                      | Mobile                                                                                     |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| ![Desktop — 70-draft-continued](assets/minimal-ui-2026-10-08/70-draft-continued-desktop.png) | ![Mobile — 70-draft-continued](assets/minimal-ui-2026-10-08/70-draft-continued-mobile.png) |

</details>

## Packing

<details>
<summary>07-packing-new: Saved product leads to a separate packing batch; quantities and unit counts remain explicit.</summary>

| Desktop                                                                              | Mobile                                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| ![Desktop — 07-packing-new](assets/minimal-ui-2026-10-08/07-packing-new-desktop.png) | ![Mobile — 07-packing-new](assets/minimal-ui-2026-10-08/07-packing-new-mobile.png) |

</details>

<details>
<summary>08-packing-split: Split 24 PCS into two units; the preview and remaining quantity expose incomplete dimensions.</summary>

| Desktop                                                                                  | Mobile                                                                                 |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ![Desktop — 08-packing-split](assets/minimal-ui-2026-10-08/08-packing-split-desktop.png) | ![Mobile — 08-packing-split](assets/minimal-ui-2026-10-08/08-packing-split-mobile.png) |

</details>

<details>
<summary>09-packing-dimensions: Copy entered dimensions to unit 2: copied measurements still need a separate physical check.</summary>

| Desktop                                                                                            | Mobile                                                                                           |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ![Desktop — 09-packing-dimensions](assets/minimal-ui-2026-10-08/09-packing-dimensions-desktop.png) | ![Mobile — 09-packing-dimensions](assets/minimal-ui-2026-10-08/09-packing-dimensions-mobile.png) |

</details>

<details>
<summary>10-packing-draft-saved: Save a complete preparation draft: quantities and checked measurements survive saving.</summary>

| Desktop                                                                                              | Mobile                                                                                             |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| ![Desktop — 10-packing-draft-saved](assets/minimal-ui-2026-10-08/10-packing-draft-saved-desktop.png) | ![Mobile — 10-packing-draft-saved](assets/minimal-ui-2026-10-08/10-packing-draft-saved-mobile.png) |

</details>

<details>
<summary>11-packing-review: Review the batch total and both units’ dimensions in the confirmation dialog.</summary>

| Desktop                                                                                    | Mobile                                                                                   |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| ![Desktop — 11-packing-review](assets/minimal-ui-2026-10-08/11-packing-review-desktop.png) | ![Mobile — 11-packing-review](assets/minimal-ui-2026-10-08/11-packing-review-mobile.png) |

</details>

<details>
<summary>12-units-created: Confirm creation: the two QA units exist, with measured sizes and links to storage.</summary>

| Desktop                                                                                  | Mobile                                                                                 |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ![Desktop — 12-units-created](assets/minimal-ui-2026-10-08/12-units-created-desktop.png) | ![Mobile — 12-units-created](assets/minimal-ui-2026-10-08/12-units-created-mobile.png) |

</details>

## Buildings and maps

<details>
<summary>13-building-new: New building: concise floor setup and required dimensions, with technical help on demand.</summary>

| Desktop                                                                                | Mobile                                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| ![Desktop — 13-building-new](assets/minimal-ui-2026-10-08/13-building-new-desktop.png) | ![Mobile — 13-building-new](assets/minimal-ui-2026-10-08/13-building-new-mobile.png) |

</details>

<details>
<summary>14-building-entered: Enter a dedicated QA building with a 10 × 10 m floor and explicit 5 m height.</summary>

| Desktop                                                                                        | Mobile                                                                                       |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| ![Desktop — 14-building-entered](assets/minimal-ui-2026-10-08/14-building-entered-desktop.png) | ![Mobile — 14-building-entered](assets/minimal-ui-2026-10-08/14-building-entered-mobile.png) |

</details>

<details>
<summary>15-building-created: Create the QA building as a draft; activation requires a reviewable layout.</summary>

| Desktop                                                                                        | Mobile                                                                                       |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| ![Desktop — 15-building-created](assets/minimal-ui-2026-10-08/15-building-created-desktop.png) | ![Mobile — 15-building-created](assets/minimal-ui-2026-10-08/15-building-created-mobile.png) |

</details>

<details>
<summary>16-zone-editor: Add a second location: the accessible preview supports keyboard positioning.</summary>

| Desktop                                                                              | Mobile                                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| ![Desktop — 16-zone-editor](assets/minimal-ui-2026-10-08/16-zone-editor-desktop.png) | ![Mobile — 16-zone-editor](assets/minimal-ui-2026-10-08/16-zone-editor-mobile.png) |

</details>

<details>
<summary>17-zone-entered: Enter QA storage B at X 6 m / Y 1 m; its 3 × 3 m outline fits beside the existing location.</summary>

| Desktop                                                                                | Mobile                                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| ![Desktop — 17-zone-entered](assets/minimal-ui-2026-10-08/17-zone-entered-desktop.png) | ![Mobile — 17-zone-entered](assets/minimal-ui-2026-10-08/17-zone-entered-mobile.png) |

</details>

<details>
<summary>18-zone-created: Save the second location: the authoritative floor map updates to two storage locations.</summary>

| Desktop                                                                                | Mobile                                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| ![Desktop — 18-zone-created](assets/minimal-ui-2026-10-08/18-zone-created-desktop.png) | ![Mobile — 18-zone-created](assets/minimal-ui-2026-10-08/18-zone-created-mobile.png) |

</details>

<details>
<summary>19-building-active: Activate the complete QA layout; the saved status is Active.</summary>

| Desktop                                                                                      | Mobile                                                                                     |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| ![Desktop — 19-building-active](assets/minimal-ui-2026-10-08/19-building-active-desktop.png) | ![Mobile — 19-building-active](assets/minimal-ui-2026-10-08/19-building-active-mobile.png) |

</details>

<details>
<summary>20-map-selected: Select and open location details: the desktop inspector and mobile sheet show the same saved location.</summary>

| Desktop                                                                                | Mobile                                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| ![Desktop — 20-map-selected](assets/minimal-ui-2026-10-08/20-map-selected-desktop.png) | ![Mobile — 20-map-selected](assets/minimal-ui-2026-10-08/20-map-selected-mobile.png) |

</details>

<details>
<summary>77-map-3d: Switch to 3D while retaining the stored units and their saved locations.</summary>

| Desktop                                                                    | Mobile                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| ![Desktop — 77-map-3d](assets/minimal-ui-2026-10-08/77-map-3d-desktop.png) | ![Mobile — 77-map-3d](assets/minimal-ui-2026-10-08/77-map-3d-mobile.png) |

</details>

<details>
<summary>78-map-zoom: Zoom the map while keeping floor context and camera controls available.</summary>

| Desktop                                                                        | Mobile                                                                       |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| ![Desktop — 78-map-zoom](assets/minimal-ui-2026-10-08/78-map-zoom-desktop.png) | ![Mobile — 78-map-zoom](assets/minimal-ui-2026-10-08/78-map-zoom-mobile.png) |

</details>

<details>
<summary>79-map-fit: Fit resets the camera to the floor proportions.</summary>

| Desktop                                                                      | Mobile                                                                     |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| ![Desktop — 79-map-fit](assets/minimal-ui-2026-10-08/79-map-fit-desktop.png) | ![Mobile — 79-map-fit](assets/minimal-ui-2026-10-08/79-map-fit-mobile.png) |

</details>

<details>
<summary>80-map-table: Table details preserve the selected location and use a complete heading hierarchy.</summary>

| Desktop                                                                          | Mobile                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| ![Desktop — 80-map-table](assets/minimal-ui-2026-10-08/80-map-table-desktop.jpg) | ![Mobile — 80-map-table](assets/minimal-ui-2026-10-08/80-map-table-mobile.jpg) |

</details>

## Storage and move

<details>
<summary>21-storage-recommendations: Find storage for QA unit 1: destination eligibility and next actions are explicit.</summary>

| Desktop                                                                                                      | Mobile                                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| ![Desktop — 21-storage-recommendations](assets/minimal-ui-2026-10-08/21-storage-recommendations-desktop.png) | ![Mobile — 21-storage-recommendations](assets/minimal-ui-2026-10-08/21-storage-recommendations-mobile.png) |

</details>

<details>
<summary>22-destination-selected: Choose the QA location: preview shows the target code, exact coordinates and suitability warnings.</summary>

| Desktop                                                                                                | Mobile                                                                                               |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| ![Desktop — 22-destination-selected](assets/minimal-ui-2026-10-08/22-destination-selected-desktop.png) | ![Mobile — 22-destination-selected](assets/minimal-ui-2026-10-08/22-destination-selected-mobile.png) |

</details>

<details>
<summary>23-destination-reserved: Reserve the position: the unit is Reserved, and storage confirmation remains blocked until verification.</summary>

| Desktop                                                                                                | Mobile                                                                                               |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| ![Desktop — 23-destination-reserved](assets/minimal-ui-2026-10-08/23-destination-reserved-desktop.png) | ![Mobile — 23-destination-reserved](assets/minimal-ui-2026-10-08/23-destination-reserved-mobile.png) |

</details>

<details>
<summary>24-wrong-destination: Submit a wrong destination code: the inline error keeps storage confirmation blocked.</summary>

| Desktop                                                                                          | Mobile                                                                                         |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| ![Desktop — 24-wrong-destination](assets/minimal-ui-2026-10-08/24-wrong-destination-desktop.png) | ![Mobile — 24-wrong-destination](assets/minimal-ui-2026-10-08/24-wrong-destination-mobile.png) |

</details>

<details>
<summary>26-stored: Confirm simulated physical storage for the QA unit: the saved state is Stored.</summary>

| Desktop                                                                    | Mobile                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| ![Desktop — 26-stored](assets/minimal-ui-2026-10-08/26-stored-desktop.png) | ![Mobile — 26-stored](assets/minimal-ui-2026-10-08/26-stored-mobile.png) |

</details>

<details>
<summary>27-move-select: Move starts with the stored source and a separate target selection.</summary>

| Desktop                                                                              | Mobile                                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| ![Desktop — 27-move-select](assets/minimal-ui-2026-10-08/27-move-select-desktop.png) | ![Mobile — 27-move-select](assets/minimal-ui-2026-10-08/27-move-select-mobile.png) |

</details>

<details>
<summary>28-move-target: Choose QA storage B; the exact target and occupied source remain visible.</summary>

| Desktop                                                                              | Mobile                                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| ![Desktop — 28-move-target](assets/minimal-ui-2026-10-08/28-move-target-desktop.png) | ![Mobile — 28-move-target](assets/minimal-ui-2026-10-08/28-move-target-mobile.png) |

</details>

<details>
<summary>29-move-reserved: Prepare the move; both positions remain held until pickup and placement are confirmed.</summary>

| Desktop                                                                                  | Mobile                                                                                 |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ![Desktop — 29-move-reserved](assets/minimal-ui-2026-10-08/29-move-reserved-desktop.png) | ![Mobile — 29-move-reserved](assets/minimal-ui-2026-10-08/29-move-reserved-mobile.png) |

</details>

<details>
<summary>30-move-source-verified: The source code identifies the pallet; physical pickup remains a separate confirmation.</summary>

| Desktop                                                                                                | Mobile                                                                                               |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| ![Desktop — 30-move-source-verified](assets/minimal-ui-2026-10-08/30-move-source-verified-desktop.png) | ![Mobile — 30-move-source-verified](assets/minimal-ui-2026-10-08/30-move-source-verified-mobile.png) |

</details>

<details>
<summary>31-move-in-transit: After pickup the unit is Moving; destination confirmation will release the source.</summary>

| Desktop                                                                                      | Mobile                                                                                     |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| ![Desktop — 31-move-in-transit](assets/minimal-ui-2026-10-08/31-move-in-transit-desktop.png) | ![Mobile — 31-move-in-transit](assets/minimal-ui-2026-10-08/31-move-in-transit-mobile.png) |

</details>

<details>
<summary>32-move-destination-verified: Verify the destination label before confirming physical placement.</summary>

| Desktop                                                                                                          | Mobile                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| ![Desktop — 32-move-destination-verified](assets/minimal-ui-2026-10-08/32-move-destination-verified-desktop.png) | ![Mobile — 32-move-destination-verified](assets/minimal-ui-2026-10-08/32-move-destination-verified-mobile.png) |

</details>

<details>
<summary>33-move-complete: Confirm the move: the unit is Stored in QA storage B and its source is released.</summary>

| Desktop                                                                                  | Mobile                                                                                 |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ![Desktop — 33-move-complete](assets/minimal-ui-2026-10-08/33-move-complete-desktop.png) | ![Mobile — 33-move-complete](assets/minimal-ui-2026-10-08/33-move-complete-mobile.png) |

</details>

<details>
<summary>34-measurement-guidance: A unit created from packing directs measurement changes to its preparation batch.</summary>

| Desktop                                                                                                | Mobile                                                                                               |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| ![Desktop — 34-measurement-guidance](assets/minimal-ui-2026-10-08/34-measurement-guidance-desktop.png) | ![Mobile — 34-measurement-guidance](assets/minimal-ui-2026-10-08/34-measurement-guidance-mobile.png) |

</details>

## Stacking

<details>
<summary>25-destination-verified: Verified support and upper-unit identity still require a separate physical placement check.</summary>

| Desktop                                                                                                | Mobile                                                                                               |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| ![Desktop — 25-destination-verified](assets/minimal-ui-2026-10-08/25-destination-verified-desktop.png) | ![Mobile — 25-destination-verified](assets/minimal-ui-2026-10-08/25-destination-verified-mobile.png) |

</details>

<details>
<summary>35-stack-start: Stacking begins from the stored supporting pallet; load checks are explicitly not enabled.</summary>

| Desktop                                                                              | Mobile                                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| ![Desktop — 35-stack-start](assets/minimal-ui-2026-10-08/35-stack-start-desktop.png) | ![Mobile — 35-stack-start](assets/minimal-ui-2026-10-08/35-stack-start-mobile.png) |

</details>

<details>
<summary>36-stack-selected: Select the upper QA unit and review fit, clearance and missing support approval.</summary>

| Desktop                                                                                    | Mobile                                                                                   |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| ![Desktop — 36-stack-selected](assets/minimal-ui-2026-10-08/36-stack-selected-desktop.png) | ![Mobile — 36-stack-selected](assets/minimal-ui-2026-10-08/36-stack-selected-mobile.png) |

</details>

<details>
<summary>37-stack-limit-edited: Editing the support limit keeps reservation blocked until the limit is saved.</summary>

| Desktop                                                                                            | Mobile                                                                                           |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ![Desktop — 37-stack-limit-edited](assets/minimal-ui-2026-10-08/37-stack-limit-edited-desktop.png) | ![Mobile — 37-stack-limit-edited](assets/minimal-ui-2026-10-08/37-stack-limit-edited-mobile.png) |

</details>

<details>
<summary>38-stack-support-saved: Save the two-level support limit before reserving the upper unit.</summary>

| Desktop                                                                                              | Mobile                                                                                             |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| ![Desktop — 38-stack-support-saved](assets/minimal-ui-2026-10-08/38-stack-support-saved-desktop.png) | ![Mobile — 38-stack-support-saved](assets/minimal-ui-2026-10-08/38-stack-support-saved-mobile.png) |

</details>

<details>
<summary>39-stack-reserved: Reserve the upper unit at Z 1 m; supporting and upper pallet identities must be checked.</summary>

| Desktop                                                                                    | Mobile                                                                                   |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| ![Desktop — 39-stack-reserved](assets/minimal-ui-2026-10-08/39-stack-reserved-desktop.png) | ![Mobile — 39-stack-reserved](assets/minimal-ui-2026-10-08/39-stack-reserved-mobile.png) |

</details>

<details>
<summary>40-stack-physical-checked: Confirm physical placement after both pallet identities match.</summary>

| Desktop                                                                                                    | Mobile                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| ![Desktop — 40-stack-physical-checked](assets/minimal-ui-2026-10-08/40-stack-physical-checked-desktop.png) | ![Mobile — 40-stack-physical-checked](assets/minimal-ui-2026-10-08/40-stack-physical-checked-mobile.png) |

</details>

<details>
<summary>41-stack-stored: The upper unit is Stored and remains linked to its supporting pallet.</summary>

| Desktop                                                                                | Mobile                                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| ![Desktop — 41-stack-stored](assets/minimal-ui-2026-10-08/41-stack-stored-desktop.png) | ![Mobile — 41-stack-stored](assets/minimal-ui-2026-10-08/41-stack-stored-mobile.png) |

</details>

## Scan tickets and records

<details>
<summary>42-scan-start: Job scanning begins with an explicit location choice.</summary>

| Desktop                                                                            | Mobile                                                                           |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ![Desktop — 42-scan-start](assets/minimal-ui-2026-10-08/42-scan-start-desktop.png) | ![Mobile — 42-scan-start](assets/minimal-ui-2026-10-08/42-scan-start-mobile.png) |

</details>

<details>
<summary>43-scan-location: The selected location wraps on mobile and keeps Change available; recording is separate from inventory storage.</summary>

| Desktop                                                                                  | Mobile                                                                                 |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ![Desktop — 43-scan-location](assets/minimal-ui-2026-10-08/43-scan-location-desktop.png) | ![Mobile — 43-scan-location](assets/minimal-ui-2026-10-08/43-scan-location-mobile.png) |

</details>

<details>
<summary>44-scan-invalid-quantity: Malformed quantity 1,2 stays editable and blocks saving with an explanation.</summary>

| Desktop                                                                                                  | Mobile                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| ![Desktop — 44-scan-invalid-quantity](assets/minimal-ui-2026-10-08/44-scan-invalid-quantity-desktop.png) | ![Mobile — 44-scan-invalid-quantity](assets/minimal-ui-2026-10-08/44-scan-invalid-quantity-mobile.png) |

</details>

<details>
<summary>45-scan-manual-entered: Correct the manual ticket quantity to 12 before saving.</summary>

| Desktop                                                                                              | Mobile                                                                                             |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| ![Desktop — 45-scan-manual-entered](assets/minimal-ui-2026-10-08/45-scan-manual-entered-desktop.png) | ![Mobile — 45-scan-manual-entered](assets/minimal-ui-2026-10-08/45-scan-manual-entered-mobile.png) |

</details>

<details>
<summary>46-scan-duplicate-blocked: Repeated job number and barcode require review of separate physical units.</summary>

| Desktop                                                                                                    | Mobile                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| ![Desktop — 46-scan-duplicate-blocked](assets/minimal-ui-2026-10-08/46-scan-duplicate-blocked-desktop.png) | ![Mobile — 46-scan-duplicate-blocked](assets/minimal-ui-2026-10-08/46-scan-duplicate-blocked-mobile.png) |

</details>

<details>
<summary>47-scan-duplicate-reviewed: Explicit duplicate review enables saving the two QA tickets.</summary>

| Desktop                                                                                                      | Mobile                                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| ![Desktop — 47-scan-duplicate-reviewed](assets/minimal-ui-2026-10-08/47-scan-duplicate-reviewed-desktop.png) | ![Mobile — 47-scan-duplicate-reviewed](assets/minimal-ui-2026-10-08/47-scan-duplicate-reviewed-mobile.png) |

</details>

<details>
<summary>48-scan-saved: Saving confirms two ticket records without claiming their pallets are Stored.</summary>

| Desktop                                                                            | Mobile                                                                           |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ![Desktop — 48-scan-saved](assets/minimal-ui-2026-10-08/48-scan-saved-desktop.png) | ![Mobile — 48-scan-saved](assets/minimal-ui-2026-10-08/48-scan-saved-mobile.png) |

</details>

<details>
<summary>49-records-search: Filter records with locations and search the two saved QA tickets.</summary>

| Desktop                                                                                    | Mobile                                                                                   |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| ![Desktop — 49-records-search](assets/minimal-ui-2026-10-08/49-records-search-desktop.png) | ![Mobile — 49-records-search](assets/minimal-ui-2026-10-08/49-records-search-mobile.png) |

</details>

<details>
<summary>50-records-selected: Select two QA records; assignment remains separate from inventory storage.</summary>

| Desktop                                                                                        | Mobile                                                                                       |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| ![Desktop — 50-records-selected](assets/minimal-ui-2026-10-08/50-records-selected-desktop.png) | ![Mobile — 50-records-selected](assets/minimal-ui-2026-10-08/50-records-selected-mobile.png) |

</details>

<details>
<summary>51-records-assignment-choice: Choose QA storage A for the selected records before assignment.</summary>

| Desktop                                                                                                          | Mobile                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| ![Desktop — 51-records-assignment-choice](assets/minimal-ui-2026-10-08/51-records-assignment-choice-desktop.png) | ![Mobile — 51-records-assignment-choice](assets/minimal-ui-2026-10-08/51-records-assignment-choice-mobile.png) |

</details>

<details>
<summary>52-records-assigned: Both ticket records show QA storage A; the stored pallets remain in QA storage B.</summary>

| Desktop                                                                                        | Mobile                                                                                       |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| ![Desktop — 52-records-assigned](assets/minimal-ui-2026-10-08/52-records-assigned-desktop.png) | ![Mobile — 52-records-assigned](assets/minimal-ui-2026-10-08/52-records-assigned-mobile.png) |

</details>

<details>
<summary>72-record-actions: Open a QA record’s actions menu; Change location remains separate from deletion.</summary>

| Desktop                                                                                    | Mobile                                                                                   |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| ![Desktop — 72-record-actions](assets/minimal-ui-2026-10-08/72-record-actions-desktop.png) | ![Mobile — 72-record-actions](assets/minimal-ui-2026-10-08/72-record-actions-mobile.png) |

</details>

<details>
<summary>73-record-delete-prompt: Deleting one QA record requires confirmation; Cancel preserves it.</summary>

| Desktop                                                                                                | Mobile                                                                                               |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| ![Desktop — 73-record-delete-prompt](assets/minimal-ui-2026-10-08/73-record-delete-prompt-desktop.png) | ![Mobile — 73-record-delete-prompt](assets/minimal-ui-2026-10-08/73-record-delete-prompt-mobile.png) |

</details>

<details>
<summary>74-record-delete-cancelled: Cancel deletion: both QA tickets remain visible.</summary>

| Desktop                                                                                                      | Mobile                                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| ![Desktop — 74-record-delete-cancelled](assets/minimal-ui-2026-10-08/74-record-delete-cancelled-desktop.png) | ![Mobile — 74-record-delete-cancelled](assets/minimal-ui-2026-10-08/74-record-delete-cancelled-mobile.png) |

</details>

<details>
<summary>75-record-bulk-delete-prompt: Bulk deletion shows the selected count and still requires confirmation.</summary>

| Desktop                                                                                                          | Mobile                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| ![Desktop — 75-record-bulk-delete-prompt](assets/minimal-ui-2026-10-08/75-record-bulk-delete-prompt-desktop.png) | ![Mobile — 75-record-bulk-delete-prompt](assets/minimal-ui-2026-10-08/75-record-bulk-delete-prompt-mobile.png) |

</details>

<details>
<summary>76-record-delete-complete: Confirm deletion of only the two walkthrough QA tickets; the filtered result is empty.</summary>

| Desktop                                                                                                    | Mobile                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| ![Desktop — 76-record-delete-complete](assets/minimal-ui-2026-10-08/76-record-delete-complete-desktop.png) | ![Mobile — 76-record-delete-complete](assets/minimal-ui-2026-10-08/76-record-delete-complete-mobile.png) |

</details>

## Navigation, access and public pages

<details>
<summary>60-setup: Configured dependencies produce a matching Setup configured heading.</summary>

| Desktop                                                                  | Mobile                                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| ![Desktop — 60-setup](assets/minimal-ui-2026-10-08/60-setup-desktop.png) | ![Mobile — 60-setup](assets/minimal-ui-2026-10-08/60-setup-mobile.png) |

</details>

<details>
<summary>61-about: Public About content remains readable outside the planner shell.</summary>

| Desktop                                                                  | Mobile                                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| ![Desktop — 61-about](assets/minimal-ui-2026-10-08/61-about-desktop.png) | ![Mobile — 61-about](assets/minimal-ui-2026-10-08/61-about-mobile.png) |

</details>

<details>
<summary>62-privacy: Public privacy content retains its information in the compact layout.</summary>

| Desktop                                                                      | Mobile                                                                     |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| ![Desktop — 62-privacy](assets/minimal-ui-2026-10-08/62-privacy-desktop.png) | ![Mobile — 62-privacy](assets/minimal-ui-2026-10-08/62-privacy-mobile.png) |

</details>

<details>
<summary>63-terms: Public terms retain their information outside the planner shell.</summary>

| Desktop                                                                  | Mobile                                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| ![Desktop — 63-terms](assets/minimal-ui-2026-10-08/63-terms-desktop.png) | ![Mobile — 63-terms](assets/minimal-ui-2026-10-08/63-terms-mobile.png) |

</details>

<details>
<summary>64-navigation-expanded: Expand the desktop sidebar and open the mobile navigation drawer.</summary>

| Desktop                                                                                              | Mobile                                                                                             |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| ![Desktop — 64-navigation-expanded](assets/minimal-ui-2026-10-08/64-navigation-expanded-desktop.png) | ![Mobile — 64-navigation-expanded](assets/minimal-ui-2026-10-08/64-navigation-expanded-mobile.png) |

</details>

<details>
<summary>65-navigation-followed: Choosing Scanned records closes the mobile drawer and opens the destination.</summary>

| Desktop                                                                                              | Mobile                                                                                             |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| ![Desktop — 65-navigation-followed](assets/minimal-ui-2026-10-08/65-navigation-followed-desktop.png) | ![Mobile — 65-navigation-followed](assets/minimal-ui-2026-10-08/65-navigation-followed-mobile.png) |

</details>

<details>
<summary>66-sign-in: Signed-out access opens the real Clerk form with the requested return route and query.</summary>

| Desktop                                                                      | Mobile                                                                     |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| ![Desktop — 66-sign-in](assets/minimal-ui-2026-10-08/66-sign-in-desktop.png) | ![Mobile — 66-sign-in](assets/minimal-ui-2026-10-08/66-sign-in-mobile.png) |

</details>

<details>
<summary>67-sign-in-validation: An invalid email remains on the real sign-in form for correction.</summary>

| Desktop                                                                                            | Mobile                                                                                           |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ![Desktop — 67-sign-in-validation](assets/minimal-ui-2026-10-08/67-sign-in-validation-desktop.png) | ![Mobile — 67-sign-in-validation](assets/minimal-ui-2026-10-08/67-sign-in-validation-mobile.png) |

</details>

<details>
<summary>68-sign-in-return: Real Clerk ticket sign-in returns to the planner route and preserves tab=pallets.</summary>

| Desktop                                                                                    | Mobile                                                                                   |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| ![Desktop — 68-sign-in-return](assets/minimal-ui-2026-10-08/68-sign-in-return-desktop.png) | ![Mobile — 68-sign-in-return](assets/minimal-ui-2026-10-08/68-sign-in-return-mobile.png) |

</details>

## Thai and dark mode

<details>
<summary>81-thai-catalogue: Thai catalogue labels and identifiers fit desktop and mobile layouts.</summary>

| Desktop                                                                                    | Mobile                                                                                   |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| ![Desktop — 81-thai-catalogue](assets/minimal-ui-2026-10-08/81-thai-catalogue-desktop.jpg) | ![Mobile — 81-thai-catalogue](assets/minimal-ui-2026-10-08/81-thai-catalogue-mobile.jpg) |

</details>

<details>
<summary>82-dark-catalogue: Existing dark mode remains readable in desktop and mobile layouts.</summary>

| Desktop                                                                                    | Mobile                                                                                   |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| ![Desktop — 82-dark-catalogue](assets/minimal-ui-2026-10-08/82-dark-catalogue-desktop.jpg) | ![Mobile — 82-dark-catalogue](assets/minimal-ui-2026-10-08/82-dark-catalogue-mobile.jpg) |

</details>

## Follow-up ordinary floor-storage verification

This repeated walkthrough uses P-000005 from the third local QA batch to show successful destination verification separately from physical confirmation. It supplements the earlier wrong-code/storage walkthrough.

<details>
<summary>83-floor-destination-selected: Follow-up QA pallet P-000005: choose an ordinary floor position in QA storage A.</summary>

| Desktop                                                                                                            | Mobile                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| ![Desktop — 83-floor-destination-selected](assets/minimal-ui-2026-10-08/83-floor-destination-selected-desktop.jpg) | ![Mobile — 83-floor-destination-selected](assets/minimal-ui-2026-10-08/83-floor-destination-selected-mobile.jpg) |

</details>

<details>
<summary>84-floor-reserved: Reserve P-000005 separately; it remains Reserved and awaits storage confirmation.</summary>

| Desktop                                                                                    | Mobile                                                                                   |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| ![Desktop — 84-floor-reserved](assets/minimal-ui-2026-10-08/84-floor-reserved-desktop.jpg) | ![Mobile — 84-floor-reserved](assets/minimal-ui-2026-10-08/84-floor-reserved-mobile.jpg) |

</details>

<details>
<summary>85-floor-destination-verified: Verify the correct destination for P-000005. Destination verified and Confirm stored are visible; verification does not confirm placement.</summary>

| Desktop                                                                                                            | Mobile                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| ![Desktop — 85-floor-destination-verified](assets/minimal-ui-2026-10-08/85-floor-destination-verified-desktop.jpg) | ![Mobile — 85-floor-destination-verified](assets/minimal-ui-2026-10-08/85-floor-destination-verified-mobile.jpg) |

</details>

<details>
<summary>86-floor-stored: Confirm simulated physical placement separately: P-000005 is Stored successfully.</summary>

| Desktop                                                                                | Mobile                                                                               |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| ![Desktop — 86-floor-stored](assets/minimal-ui-2026-10-08/86-floor-stored-desktop.jpg) | ![Mobile — 86-floor-stored](assets/minimal-ui-2026-10-08/86-floor-stored-mobile.jpg) |

</details>
