# Extraction dependency review

Read-only package review, 2026-09-06. No dependency or lockfile edits were made. This review checks references in the current extracted source, test configuration, styles, and development tooling; it is not an installation-size benchmark.

## Retain: directly used or required by current configuration

- Clerk packages: `@clerk/nextjs` supplies app authentication; `@clerk/backend/webhooks` verifies/normalizes signed identity events; `@clerk/shared/keys` validates the publishable-key configuration.
- `@zxing/browser` is the lazy-loaded destination scanner. `qrcode.react` supplies actual location/position QR rendering.
- Next.js, React, Convex, next-intl, Radix, lucide-react, and class/variant utilities are used by the app.
- `shadcn` is required by `src/app/globals.css` importing `shadcn/tailwind.css`; it supplies active data-state variants and animation styles. It is not merely an unused scaffolding CLI.
- Tailwind, PostCSS, and `tw-animate-css` are used by the styling pipeline. Prettier's Tailwind plugin is formatting tooling.
- `@edge-runtime/vm` is selected indirectly by the Vitest `edge-runtime` environment for Convex runtime tests. A missing literal import is not evidence it is unused.
- `@testing-library/dom` supports the React Testing Library peer dependency. `axe-core` supplies types used by the local `jest-axe` declarations. The remaining Testing Library, jest-axe, jsdom, convex-test, and fast-check packages support active tests.
- Vite, its React plugin, Vitest, TypeScript, and ESLint/configuration packages are active development dependencies.

## Cleanup candidates requiring a separate tooling decision

| Package or metadata          | Evidence                                                                                                                | Recommendation                                                                                                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@playwright/test`           | No checked-in Playwright test suite, config, or package script remains after extraction                                 | Keep during the current browser/recording work. Afterwards either add a reproducible checked-in browser suite or remove the direct dependency if no tooling uses it.                                                                    |
| `@axe-core/playwright`       | No checked-in import remains; current checked-in accessibility tests use jest-axe                                       | Same decision as browser-suite tooling. Do not remove during ongoing QA.                                                                                                                                                                |
| `svix` direct dev dependency | App webhook code uses Clerk's verification wrapper; an ignored local QA webhook-inspection script directly imports Svix | Retain while that local QA tool is in use. Later document/check in an appropriate non-secret diagnostic tool or remove only the direct dependency if the tool is retired. This does not remove Clerk's transitive webhook requirements. |
| Package description          | Still describes only building/floor/storage-spot planning                                                               | Optional metadata update can mention the finished-goods workflow; left unchanged under documentation-only ownership.                                                                                                                    |
| ESLint ignore comments       | Refer to removed `playwright.config.ts` and manual-generation commands                                                  | Harmless stale extraction commentary; cleanup can accompany a later tooling-only change.                                                                                                                                                |

No runtime dependency was identified as a safe immediate removal. Any later dependency edit should regenerate the lockfile and run installation, typecheck, lint, tests, and build before accepting the cleanup.
