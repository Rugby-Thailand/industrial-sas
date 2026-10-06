# Compact Storage Planner A audit

Review base: `15eabc80785afec0b13ffbaae1c0275e924418e1` (`main`). Initial review:
`3eac531bde063381bfe2e3a0c0f2511a3f2baa7b`. Fixes reviewed again at `471e62d`.
The Standards and Spec reviews ran independently using the `code-review` skill.
Spec: [approved compact A](../plans/storage-compact-workspace.md).

## Standards

**One P1 finding, resolved.** Show on map used a Button without an explicit type
inside the real floor-edit form. Its HTML default could submit pending geometry.
It now uses `type="button"`. A regression mounts the workspace inside a form and
asserts that switching views and reopening details never submit it.

The independent recheck found no remaining actionable documented-standard
violations or heuristic smells. The compact control sizes are the scoped override
explicitly approved in A; ordinary forms/editors keep their existing sizing.

## Spec

**Two findings, resolved.** Reopen details also lacked `type="button"` and could
submit the edit form (P1). The same regression covers its explicit button type.

Panning then switching Map → Split changed the physical center of the camera
(P2): an 800% zoom test moved depth center from 47.01% to 19.75%. Focus was stored
in coordinates already fitted to the previous viewport. It is now stored before
fitting, then converted at render/commit. Chromium confirmed pan → Split → Map →
Table → Map preserves the center within 0.00001 of the floor dimensions.

Inline details render only in Table; Split retains its existing inspector/sheet.
The independent recheck found no residual missing requirements, incorrect
behavior or scope creep in the UI changes.

## Dependency audit

The required production audit found existing transitive vulnerabilities. Limited
patch overrides update `proxy-addr` to 2.0.8 and `source-map-js` to 1.2.2, matching
[the proxy-addr advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) and
[the source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
The frozen-lockfile installation succeeds; `pnpm audit:prod` reports no known
vulnerabilities. No direct framework/library versions were changed.

## Verification

The real-component Playwright harness passed desktop/mobile workflows and 16
locale/theme/width combinations (320, 390, 768, 1440px). Checked main content had
no horizontal overflow, runtime errors or axe violations. At 390px the toolbar
is 92px, rows are 54px, and one collapsed result occupies a 230px workspace.
Pagination immediately follows the data. A 50-move pan produces one React update.

The production build passes. GitHub CI passes validation, all 1,064 tests across
126 files in both test shards, and build; Vercel preview passes. Reproduction commands and isolated-fixture limits
are recorded in [the harness README](../../scripts/storage-workspace-preview/README.md).
One local unsharded full-suite run hit the existing 5-second timeout in a
workspace integration test (1,063 passed). Its isolated file recheck passed all
59 tests without changing the timeout or test code; both CI shards passed.
Videos are actual component interactions with demo data, not authenticated
backend/write tests. MP4 files are available in this T3 thread; the configured
media host could not authenticate, so no public video URL is claimed.

Standards: 1 resolved, 0 open. Spec: 2 resolved, 0 open. The most severe findings
in each axis were accidental form submission, now covered by regression tests.
