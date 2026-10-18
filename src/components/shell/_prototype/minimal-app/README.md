# Main-based minimal HTML proposal

Throwaway design preview of Storage Planner, based on `main` at `278292a`.
Kiro CLI with Claude Opus 5.5 reviewed the real components and recommended the
direction. Codex built and checked this static HTML proposal from that review.

Run from the repository root:

```sh
python3 src/components/shell/_prototype/minimal-app/preview.py
```

Open <http://localhost:3199/finished-goods/scan?variant=A&theme=dark&lang=th>.
The separate static server uses the real route shapes. No Next app routes are
modified. Floor selection and edit mode remain in the preview URL.

The four sidebar destinations match `src/lib/navigation.ts` on main:
finished goods, job scan, scanned records, and buildings/locations.
Follow their actions into product details, packing, batch details, pallet
details, measurement, storage, moving, stacking, building dimensions, floor
editing and building review. The shell and all these screens use open sections,
divided rows and fewer boxes. Authentication, public/legal pages and the developer
service-configuration checklist are outside this warehouse UI proposal.

The bottom controls compare three job-ticket layouts in the same app shell:

- `?variant=A`: inline tickets; recommended starting point.
- `?variant=B`: large source photo beside the fields.
- `?variant=C`: ticket list beside the selected editor.

Arrow keys switch layouts unless an input or dialog has focus. `State` exposes
the sample state and scan scenarios. `Source` lists the actual component paths
and the screenshot supplied by the user. Thai/English and light/dark are supported.

All changes stay in memory and reset on reload. Camera, AI, uploads, auth and
Convex calls are simulated. The ticket photo is copied unchanged from
`output/job-scan-test/ticket-1.jpg`; its nine visible values match that fixture.
Catalogue records are examples shaped by the actual domain. Floor geometry and
placements come from main’s isolated `storageFloorDemoData.ts` fixture, executed
unchanged when generating the source snapshot. The second floor repeats that demo.
Other workflow screens illustrate layout and selected
interactions, rather than implementing every production validation or mutation.
The filter dialog shows the real filter structure; only text search is active.

The scan retains location-first selection, mapped/unmapped text, multiple
AI/barcode/manual tickets, two required identities, seven optional fields,
reading/incomplete blockers, AI markers clearing on edit, image links, deletion,
success and records mapping. Main's `aiMock` is shown as an advisory; the newer
branch's sample blocking, retry states, void/correction features and extra menu
items are deliberately absent because they are not in this main baseline.

Validation: JavaScript syntax, scoped Prettier, browser viewport checks for 15
screens across three layouts, two themes, two languages and three widths
(540 combinations), and scan/record/storage navigation interaction checks.
No production source files or backend data were changed.
