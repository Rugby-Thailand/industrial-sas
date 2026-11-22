import {
  activeNavigationHref,
  ROUTES,
  type NavigationItem,
} from "@/lib/navigation";

/**
 * Both the locale landing route and the installed app open Home.
 */
export const START_HREF = ROUTES.dashboard;

export type PageRecovery =
  /** The nearest permitted menu page above the failed one: its place and way out. */
  | { readonly kind: "HUB"; readonly item: NavigationItem }
  /** The page the start route opens for this member, named because they can open it. */
  | { readonly kind: "START"; readonly item: NavigationItem }
  /** Access is not known yet: the common Home route. */
  | { readonly kind: "NEUTRAL"; readonly href: string };

/**
 * Where a page that failed to load can safely send the member, chosen from
 * their own permitted menu (`visible`), so it never names a page that would
 * redirect them back into the failure. Never the failed page itself: a
 * failing start page offers retry only (the sidebar still lists the rest).
 */
export function pageRecovery(
  pathname: string,
  visible: readonly NavigationItem[],
  settled: boolean,
): PageRecovery | undefined {
  const others = visible.filter((item) => item.href !== pathname);
  const hubHref = activeNavigationHref(
    pathname,
    others.map((item) => item.href),
  );
  const hub = others.find((item) => item.href === hubHref);
  if (hub !== undefined) return { kind: "HUB", item: hub };
  if (pathname === START_HREF) return undefined;
  if (!settled) return { kind: "NEUTRAL", href: START_HREF };
  if (visible.length === 0) return undefined;
  return {
    kind: "START",
    item: { href: START_HREF, labelKey: "home", permissionCodes: [] },
  };
}
