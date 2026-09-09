# Screenshot manual

Open `index.html` in a browser. Every screenshot appears inline, already expanded, with red numbered rectangles. Images are embedded in the HTML, so sharing that one file preserves all screenshots and offline access.

Regenerate after editing the manifest or screenshot files:

```sh
python3 docs/manuals/storage-planner/generate-manual.py
```

Or render another manifest without overwriting this manual:

```sh
python3 docs/manuals/storage-planner/generate-manual.py /absolute/path/manifest.json --output /absolute/path/index.html
```

`manifest.json` supports optional `title`, `subtitle`, `date`, and `lang` and requires `chapters`. Each chapter needs `id`, `title`, and `steps`; `intro` is optional. Each step needs `id`, `title`, `instruction`, `image`, `width`, and `height`; `result`, `note`, `alt`, and `marks` are optional. IDs must be unique across chapters and steps. Image paths are relative to the manifest. PNG, JPEG, WebP, and GIF are supported.

Marks contain `x`, `y`, `width`, `height`, and `label`, measured in original screenshot pixels. The renderer scales these as HTML/CSS overlays, leaving the source screenshot intact. Numbered labels repeat below each image as a readable legend. It rejects invalid dimensions and marks outside their screenshot.

Use descriptive mark labels such as “เพิ่มหน่วยจัดเก็บ”; empty or numeric-only labels do not create redundant legend entries. Portrait screenshots from mobile sources (original width at most 600 pixels) are centered and capped at 430 pixels on desktop, then shrink to fit mobile. Tall desktop full-page screenshots retain the full content width so their text remains readable. Print sizing uses the original aspect ratio so rectangles stay aligned with their screenshot.

Use browser Print to save a landscape PDF. The HTML remains the primary manual: images stay visible at full content width and scale on smaller screens without a lightbox or external libraries.

## Recommendation feature highlight

`recommendation-highlight.html` is the short, five-image guide focused on where to store a measured unit, exact coordinates, fit reasons, invalid placement, and reservation. Its images are embedded and visible inline. Regenerate with `python3 docs/manuals/storage-planner/build-recommendation-highlight.py`. Preview screenshots are in `previews/recommendation-highlight.jpg` and `previews/recommendation-correction.jpg`.

## 8 September simplified flow update

Run `python3 docs/manuals/storage-planner/refresh-simplified-flow.py` after the original manifest builders. This refreshes direct reservation, inline verification, correction and move-summary steps from verified screenshots, then embeds all images in both HTML manuals. Full action evidence: `../../../artifacts/ui-simplification-2026-09-08/index.html` (from repository root use `artifacts/ui-simplification-2026-09-08/index.html`).
