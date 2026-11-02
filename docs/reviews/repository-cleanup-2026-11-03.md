# Repository cleanup audit

Audited against `e37b6009` on 2026-11-03. The cleanup removes redundant
artifacts and retired standalone demos, preserving production application
code, routes, navigation contracts, maintained tools, and selected review evidence.

## Removed

- The 27,002,229-byte minimal-UI HTML gallery embedded 156 images with 152
  unique SHA-256 hashes. Every hash matched a separate tracked image. The
  Markdown walkthrough and capture manifest remain the evidence entry points;
  its three gallery links and the gallery's formatting exception were updated.
- The old shell, storage-layout, add-location, and barcode demos were isolated
  HTML/JavaScript programs. Their READMEs describe standalone or throwaway
  previews; production uses React implementations. No production imports,
  package scripts, CI entry points, or navigation inventory entries consume
  these directories. The add-location demo's Impeccable surface record was
  removed with its target. The unidentified-pallet prototype remains.
- Four minimal-UI screenshots were byte-identical to retained captures. Both
  the walkthrough and the capture manifest now reference the retained bytes,
  preserving each action's original label and metadata:

  | Removed capture                         | Identical retained capture       |
  | --------------------------------------- | -------------------------------- |
  | `70-draft-continued-desktop.png`        | `06-product-entered-desktop.png` |
  | `70-draft-continued-mobile.png`         | `06-product-entered-mobile.png`  |
  | `74-record-delete-cancelled-mobile.png` | `52-records-assigned-mobile.png` |
  | `79-map-fit-desktop.png`                | `77-map-3d-desktop.png`          |

The 27 deleted artifact files total 28,781,659 bytes before small documentation
edits. This reduces the checked-out tree, not existing Git history.

## Preserved and adjusted

- The four selected storage-layout B captures were moved byte-for-byte to
  `docs/plans/assets/storage-layout-b/`. The plan links to them and to the
  historical prototype at the audited commit.
- Barcode preview documentation now links to its historical source and labels
  the demo as retired. Historical review tables and source-hash snapshots
  retain their original paths and hashes: they describe the old revision,
  rather than asserting that those files still exist in the current checkout.
- `archivedPreviewSecurity.test.tsx` became
  `barcodeBenchmarkSecurity.test.tsx`. Only shell/barcode-demo cases and the
  deleted demo worker were removed. Both retained benchmark workers still
  receive foreign-origin rejection **and** same-origin initialization coverage;
  the URL-validation and server-error tests remain.

## Candidates retained after audit

- The unidentified-pallet prototype describes an agreed workflow that has no
  matching production implementation in the audited source. It is design input,
  not established obsolete code.
- The LINE/HR onboarding preview has direct security and workflow tests.
  The design sheet is an approved reference used by implementation plans and
  is included in TypeScript checks. Its documented package build command is
  stale, but that does not establish that the reference should be deleted.
- Public F1/F2 reference pages have dedicated response-header configuration
  and smoke coverage. Removing that served surface needs a separate retirement
  decision; this cleanup changes no public URLs.
- Benchmark inputs under `docs/reviews/assets/`, test fixtures, the HR manual
  and its Python builders, Impeccable tooling and licenses, and operational
  scripts remain maintained dependencies or evidence. Other similar captures
  were not deleted merely for age or appearance.
- Work in progress in the original checkout was excluded by branching from
  current remote `main` in a separate worktree.

New disposable review output belongs under ignored `output/`; selected evidence
and maintained sources still belong in version control.
