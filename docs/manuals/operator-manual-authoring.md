# Authoring the operator manual

The Thai visual guide, the red boxes on its screenshots, and the static HTML
manual under `docs/manual-html/` are three views of **one** file:
[`scripts/manual/tasks.mjs`](../../scripts/manual/tasks.mjs). Edit the catalogue,
run one command, review the diff. Nothing in the generated output is edited by
hand — the next build overwrites it.

Everything here runs offline. No Clerk instance, no Convex deployment, no server,
no network: the inputs are the catalogue, the committed PNGs, and
`src/lib/navigation.ts`.

## Commands

| Command                | What it does                                                                    |
| ---------------------- | ------------------------------------------------------------------------------- |
| `pnpm manual:build`    | `manual:assets` then `manual:generate` — the whole manual from committed inputs |
| `pnpm manual:assets`   | Re-renders `*-annotated.svg` overlays beside the screenshots                    |
| `pnpm manual:generate` | Renders `docs/manual-html/` (index, one page per task, CSS, JS, images)         |
| `pnpm manual:check`    | Validates the catalogue and proves the generated output is not stale            |
| `pnpm manual:capture`  | Optionally measures stable UI targets from a running, authenticated app         |

`pnpm manual:check` expects the output to exist, so the pair is
`pnpm manual:build && pnpm manual:check`. Open the result by double-clicking
`docs/manual-html/index.html`; it works over `file://` with no server.

To pull in a fresh screenshot set, pass the capture directory:

```sh
node scripts/generate-operator-manual-assets.mjs ../industrial-sas-visual-audit/after-final
```

Each screenshot is read as `<image>--th--desktop-1280.png` and written as
`<image>.png`. A missing file is named, and nothing is written.

## The schema

One entry per workflow, in the order the manual lists them. The contract and its
validator are in [`scripts/manual/schema.mjs`](../../scripts/manual/schema.mjs);
the JSDoc types there are what a TypeScript test sees when it imports the
catalogue.

| Field           | Meaning                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `id`            | Stable lowercase-hyphen slug. It is the page filename and the anchor operators bookmark, so it never changes once shipped. |
| `category`      | Id from `MANUAL_CATEGORIES`. Drives the index filter.                                                                      |
| `audience`      | Id from `MANUAL_AUDIENCES` — who performs the task, not what they are permitted.                                           |
| `route`         | Locale-free application path. `{param}` segments are allowed for detail screens.                                           |
| `title`         | `{ th, en }`                                                                                                               |
| `summary`       | `{ th, en }` — one sentence, shown on the index card.                                                                      |
| `prerequisites` | Ordered `{ th, en }` list of what must be true before starting.                                                            |
| `steps`         | Ordered `{ th, en }` list. Step numbers are the 1-based position.                                                          |
| `success`       | Ordered `{ th, en }` list of how an operator knows it worked.                                                              |
| `image`         | Basename of a PNG in `docs/manuals/assets/operator-guide-th/`.                                                             |
| `annotations`   | Ordered list of red marks, each tied to a step number.                                                                     |

Rules the validator enforces, so an author gets a line number instead of a
mis-drawn manual:

- Task ids are unique and slug-shaped; so are category and audience ids.
- Every localized field has both locales, non-empty. A `th` value with no Thai
  characters and an `en` value with Thai characters are both errors — that is what
  a forgotten translation actually looks like.
- Every `route`, with its `{param}` segments removed, is a value of `ROUTES` in
  `src/lib/navigation.ts`. A renamed route fails the check.
- Every `image` exists as a PNG, every PNG is used, and no two tasks share an
  image basename because their standalone overlays would overwrite one another.
- Each annotation points at a real step, no step is annotated twice, and
  annotations are listed in ascending step order.
- Every annotation — including its number badge, which overhangs the shape —
  fits inside the measured pixel size of the screenshot.

Screenshot width and height are **not** authored. They are measured from the PNG
(`scripts/manual/images.mjs`). The generator this replaced declared them by hand
and seven of thirteen were wrong, which silently letterboxed those screenshots
and moved every red box off its target.

## Annotations

```js
// A framed control or card.
{ kind: "rect", step: 2, x: 278, y: 1110, width: 980, height: 380 }

// A single value inside a dense row, where a rectangle would enclose four
// other things and point at none of them.
{ kind: "underline", step: 3, x: 320, y: 742, width: 210 }
```

Coordinates are unscaled screenshot pixels with the origin at the top-left. The
style is fixed: `#ff3b30`, 7-pixel rectangle stroke, 8-pixel underline, and a
white-ringed number badge at the shape's origin.

**The badge shows the step number**, not the annotation's position in the list. So
a step-3 mark reads "3", and the Thai text for that step says "ที่กรอบ 3". Writing
a step that mentions a box number the picture does not show is the one error the
validator cannot catch — read the regenerated SVG before committing.

Most migrated annotations are rectangles; `underline` is supported and tested,
and is the right choice for a status word or one table cell.

## Adding a task

1. Capture the screen at 1280 wide, Thai locale, and commit it as
   `docs/manuals/assets/operator-guide-th/<image>.png`.
2. Append an entry to `MANUAL_TASKS`. Add a new category to `MANUAL_CATEGORIES`
   first if none fits.
3. Add a section to [`visual-operator-guide-th.md`](./visual-operator-guide-th.md)
   that links `./assets/operator-guide-th/<image>-annotated.svg`. `manual:check`
   fails if a task's overlay is not referenced there, so the document operators
   were trained on cannot fall behind the catalogue.
4. `pnpm manual:build && pnpm manual:check`, then look at the overlay and the
   generated page.

The catalogue is exactly the thirteen workflows the guide documented by hand.
Do not add a task for a screen that does not exist yet: an entry here is a claim
that an operator can be walked through it today.

## Adding a step or moving a box

- **A step**: insert it into `steps` at the right position, then fix every
  `annotation.step` that shifted. The validator catches an annotation pointing
  past the end of the list, and catches two annotations on one step; it cannot
  catch a box that now numbers the wrong instruction, so check the diff.
- **A box**: change the coordinates and run `pnpm manual:assets`. Only text files
  change — the PNG is referenced by the overlay, never rewritten.

## Stable selectors: `data-manual-id`

Coordinates are the weak point of this system: they are measured by eye and no
test can tell that a box has drifted onto the wrong button. The fix is for the
controls a manual points at to identify themselves.

**Convention for new controls.** Put `data-manual-id` on the element that bounds
what the step is about — the form, the card, the row action — using
`<area>-<subject>-<control>` in lowercase kebab case:

```tsx
<section data-manual-id="receipt-lines-form">…</section>
<button data-manual-id="receipt-pallet-save">…</button>
<tr data-manual-id="quality-inspection-row">…</tr>
```

Rules: unique per rendered screen; stable across copy changes (it is not a label);
never used for styling; never used as a test selector where a role or accessible
name would do — a manual target and a test target have different lifetimes.

With those attributes in place,
[`scripts/capture-manual-targets.mjs`](../../scripts/capture-manual-targets.mjs)
measures the boxes instead of a human:

```sh
MANUAL_CAPTURE_BASE_URL=http://localhost:3000 pnpm manual:capture
```

It visits each task's route, records every `[data-manual-id]` bounding box to a
JSON file, and an author copies the numbers into the catalogue. It needs a
running, signed-in application, which is why it is optional and is **not** part of
`manual:build`. No control carries the attribute yet, so a run today reports zero
targets per route and exits non-zero — that is the scaffolding telling the truth,
not a failure of the manual build.

For protected routes, first save Playwright authentication state in a setup flow,
then pass it without committing that credential-bearing file:

```sh
MANUAL_CAPTURE_BASE_URL=http://localhost:3000 \
MANUAL_CAPTURE_STORAGE_STATE=playwright/.auth/manual.json \
pnpm manual:capture
```

The equivalent CLI flag is `--storage-state=playwright/.auth/manual.json`.

## CI integration

The manual guard is credential-free and needs no browser, so it belongs with the
other static checks:

```yaml
- run: pnpm manual:build
- run: pnpm manual:check
- run: git diff --exit-code docs/manuals/assets/operator-guide-th
```

`pnpm guards` already runs `manual:build && manual:check` locally. The third line
is the one worth adding to a workflow: it fails when a committed overlay is not
what the catalogue renders, which is the same reasoning as the existing
`Production build` job asserting a clean tree after `pnpm build`.

`docs/manual-html/` is generated output and is excluded from Prettier and ESLint.
Whether to commit it is a policy choice: committing it makes the manual readable
straight from a clone, and `manual:check` proves the committed copy is current.

## Tests

`tests/integration/operator-manual.integration.test.ts` covers the validator's
refusals (duplicate ids, out-of-bounds and mis-numbered annotations, missing
localization, unknown route), the SVG and HTML renderers, escaping, and
determinism. It runs in the `integration` tier:

```sh
pnpm test:integration -- operator-manual
```
