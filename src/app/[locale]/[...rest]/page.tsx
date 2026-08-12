import { notFound } from "next/navigation";

/**
 * Every locale-prefixed URL that matches no route.
 *
 * Without this file, `/th/nonexistent` matches nothing under `src/app` at all,
 * so Next serves its own built-in 404 — rendered *outside* `[locale]/layout.tsx`
 * and therefore with no stylesheet, no `lang`, and no way back. On a dark
 * handheld panel that is a black screen: the audit recorded all six
 * locale/viewport variants as blank.
 *
 * A catch-all page that immediately calls `notFound()` moves the miss *inside*
 * the locale segment, which is what makes `not-found.tsx` render as the
 * localized screen it was always written to be. It is the least specific route
 * in the tree, so it runs only when nothing else matched.
 */
export default function LocaleCatchAllPage(): never {
  notFound();
}
