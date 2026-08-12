import * as React from "react";

/**
 * The width at which the navigation rail becomes a sheet.
 *
 * `1024`, not the registry's `768`, so it lines up with the `lg:` breakpoint the
 * desktop shell already used for the same decision. Two numbers for one layout
 * change is how a nav ends up both collapsed and expanded at 800 pixels.
 *
 * This is a *layout* query and nothing else. The UX plan (§7) is explicit that
 * viewport width must never move an operator into a different workflow — the
 * handheld experience is a route an operator chooses, not something a narrow
 * window decides for them. The same links, the same active route, and the same
 * shell render on both sides of this line; only their container differs.
 */
const MOBILE_BREAKPOINT = 1024;

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/**
 * The server has no viewport, so it answers "not narrow" and the wide layout is
 * what renders in the HTML. That is the safe half of the guess: the wide rail is
 * `hidden lg:block`, so a handheld shows nothing where it would be rather than a
 * rail that flashes and disappears.
 */
const getServerSnapshot = () => false;

/**
 * Whether the viewport is below the rail breakpoint.
 *
 * `useSyncExternalStore` rather than `useState` plus an effect: the media query
 * *is* an external store, and reading it through this hook means React sees the
 * same answer during hydration that it will see immediately after, instead of
 * committing one render and then correcting it.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    getServerSnapshot,
  );
}
