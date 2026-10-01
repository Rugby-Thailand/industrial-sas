# Storage Planner — selected layout B

B was selected on 2026-09-30. This standalone, throwaway prototype refines B using the feedback that the floor rail and floor card were too wide, and adds the mobile design. It uses sample data in memory; no database calls or persistent changes.

Run from the repository root:

```sh
python3 -m http.server 3188 --bind 127.0.0.1 --directory src/components/storageLayouts/_prototype
```

Open http://127.0.0.1:3188/?variant=B (B is also the default).

- **B desktop:** rail reduced from 190px to 128px, smaller card/thumbnail, large canvas, floating location inspector, list below.
- **B tablet:** horizontal floor selector and inspector below the map when the viewport is 581–850px wide.
- **B mobile:** map/list tabs, visible floor selector and floor-edit action, icon toolbar, selection summary, and a bottom sheet when a location is selected. Close the sheet to retain selection; edit opens the sample editor. The comparison bar sits after the page on mobile so it cannot cover the map.
- **A — Map + details** and **C — Location desk** remain available for comparison using the bar or Left/Right keys. Variant stays in the URL. Selection and sample edits carry between variants.

Click locations, search/filter the list, zoom/fit, change display options, edit a sample location, or preview building actions. Occupied locations cannot be archived. The 3D view is an illustrative tilt; the floor editor is a placeholder. Floor geometry, inventory, occupancy, and the single sample floor are illustrative, not production data. Reload resets sample edits and mobile view state.

The selected decision is **B with a compact floor rail**, plus **mobile map/list and bottom-sheet details**. Production implementation is planned in [storage-layout-b-desktop-mobile.md](../../../../docs/plans/storage-layout-b-desktop-mobile.md), including existing component seams, navigation guards, multi-floor behavior, permissions, and verification. The production app has not been changed by this prototype revision.

Design captures: [desktop](assets/b-desktop.png), [mobile map](assets/b-mobile-map.png), [mobile list](assets/b-mobile-list.png), [mobile detail](assets/b-mobile-detail.png).
