# Product flow polish and validation

- Added shared `useCanManage` and `ViewOnlyNotice` using the actual workspace manage permission. Read-only catalogue users can open products and pallets; creation links are absent. The direct new-product URL shows a view-only notice. Existing product fields are readable but disabled, and direct submit attempts cannot write.
- Existing-product preview/camera controls and back navigation remain usable in view-only mode. Unmeasured pallet cards route to detail for viewers and measurement for managers.
- Duplicate normalized SKU refusal exposes **Open existing product**, resolved from the warehouse-scoped catalogue. Editing fields clears the obsolete refusal/link. Entered draft values remain on the device.
- Returning from measurement validates the referenced pallet belongs to the displayed product and warehouse and is still awaiting measurement or placement. Invalid, reserved, or stored resume contexts show an unavailable record with no write form. A valid resume uses **Return to measurement**, updates the same product, and navigates to the same pallet without creating a duplicate.
- Existing product save identity always comes from the actual loaded product; a local draft cannot override it with an unrelated saved-product ID.
- New English products default to `pieces`; Thai products default to `ชิ้น`. Existing product units remain unchanged.
- `PalletScene showDimensions={false}` provides an illustration without invented numeric dimensions, origin, or numeric accessible labels. Invalid measurement drafts also omit the fallback cube's numeric labels. Camera rotation and 2D/3D remain available.
- Shared error copy explains access denial and occupied-product requirement changes, and no longer refers to nonexistent highlighted fields.

Validation: ProductScreens, PalletScene, and their English/Thai accessibility tests pass (38 tests). TypeScript and focused lint pass. Additional backend/product integration validation passes (41 tests). Root task handles live browser verification and final evidence recording.

## Placement status rendering

`PalletScene` accepts optional `status: "PROPOSED" | "RESERVED" | "STORED"` (default proposed). In location views, proposed placement uses a translucent green ghost; a reservation uses an amber dashed outline with awaiting-storage instructions; stored stock uses solid cartons, a green outline/check, and completed-storage copy. Stored pallets cannot be dragged, while camera controls remain available. Measurement and illustration scenes without a location keep their existing behavior. Regression validation: 62 scene/accessibility/product/pallet tests pass, with TypeScript and focused lint clean.
