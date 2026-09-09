# Locale navigation regression

The live review found that changing locale replaced only the pathname, losing the `resumePalletId` query parameter and therefore the current pallet workflow. Root updated `LocaleSwitcher` to retain the current browser query string and hash, and widened its compact rounded selector with a no-wrap label for the 768 px layout.

The new `src/components/shell/LocaleSwitcher.test.tsx` uses the real select control and localized labels. Four interaction regressions verify:

- Thai to English and English to Thai retain the pallet resume ID, encoded spaces, repeated query keys, and a measurement hash.
- A plain URL remains plain, without an empty `?` or `#` suffix.
- A resume ID added to browser history after render is read at the time of the language change, rather than lost through a stale snapshot.

The tests assert one localized router replacement with the complete URL. They do not assert Tailwind classes as a substitute for actual tablet layout review; root owns the browser verification.

Validation: **23 tests passed across 3 files** (`LocaleSwitcher`, `SelectControl`, message catalogues). Full `pnpm typecheck` and targeted zero-warning ESLint passed. This regression task changed tests and notes only; the production fix is root's preceding change.
