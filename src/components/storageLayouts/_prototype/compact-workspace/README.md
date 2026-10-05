# Compact Storage Planner redesign — throwaway preview

Question: how can mobile controls, location rows and pagination occupy less space
while keeping floor navigation, search, map/list switching and location details easy to reach?

Three structurally different variants share one HTML preview (`?variant=A|B|C`).
The app header/navigation and dark/light planning palette reproduce the existing
page context. This preview follows the repository's nearby `_prototype` HTML
convention: the authenticated route cannot run locally without its backend.
The PD geometry is a read-only export of `pdApprovedPlan()` (198 positions).
Inventory status/counts and Floor 1 geometry are illustrative. Nothing is written.

Run from the repository root:

```sh
python3 -m http.server 3191 --bind 127.0.0.1 --directory src/components/storageLayouts/_prototype/compact-workspace
```

Open <http://127.0.0.1:3191/?variant=A&view=list>.

Compare the three mobile layouts side by side at
<http://127.0.0.1:3191/?compare=mobile>. Each embedded preview is interactive.
The comparison button toggles all three to the single-result feedback case.

- **A — Compact workspace (recommended):** one toolbar on desktop, two compact
  rows on mobile; floor and view controls share the first row. Flat location rows,
  inline detail expansion, and pagination directly after the data. A short
  result set never reserves a full-height list area. Desktop can choose Split.
  Add/edit/display actions stay reachable in the small overflow menu.
- **B — Map + finder:** the map owns the workspace. Search/results overlay it
  in a small left panel on desktop or a content-sized bottom dock on mobile.
  The finder can be hidden. Floor navigation remains inside the canvas.
- **C — Location browser:** a list-first grouped browser with horizontal group
  navigation. Desktop selection updates a small map in a context column; mobile
  selection expands the map below that row. There is no permanent mobile inspector.

Compare with the bottom arrows/select or Left/Right keys. The “ลองค้นหา 1 จุด”
button reproduces the single-result case in the feedback. Search has one clear
button; code/name duplicates are omitted. Search, status filters, sorting,
pagination, floor switching, selection, map zoom/fit and themes are interactive.
Buttons for mutations only show a preview notice. URL state is shareable.

The design is not approved yet. Keep this branch out of the production PR;
once chosen, rewrite the winner against real components and keep the existing
performance improvements and editor/navigation guards.

## Observed density

At 390 CSS pixels wide, A's toolbar is 92 px high and each row is 54 px high.
Searching for `PD-L1-8` makes the entire workspace 225 px high. Pagination follows
the data, and single-page results omit the page-size and navigation controls.
The row shows the code once; count/status occupy its right side and dimensions
its second line. The search field has one clear button.

Playwright inspection covered all three designs at 320, 390, 768 and 1440 px:
no page horizontal overflow and no pagination covered by the prototype bar.
Search, filter, sort, paging, floor selection, map/list, theme, overflow menu,
finder hide/show, group navigation and inline-map expansion were exercised.
Screenshots were visually inspected. These are prototype checks, not authenticated
app integration tests. Verdict: recommend A for the requested space reduction;
the user's design selection remains open.
