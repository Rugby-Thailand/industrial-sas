import {
  activeNavigationHref,
  ROUTES,
  type NavigationItem,
} from "@/lib/navigation";

/**
 * The start route: `/[locale]` and the sign-in default open it, and members
 * without storage access are redirected from it to their own first page.
 */
export const START_HREF = ROUTES.storageLayouts;

export type PageRecovery =
  /** The nearest permitted menu page above the failed one: its place and way out. */
  | { readonly kind: "HUB"; readonly item: NavigationItem }
  /** The page the start route opens for this member, named because they can open it. */
  | { readonly kind: "START"; readonly item: NavigationItem }
  /** Access is not known yet: the start route, which redirects by permission. */
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
  if (!settled)
    return pathname === START_HREF
      ? undefined
      : { kind: "NEUTRAL", href: START_HREF };
  // Where the start route lands this member: Buildings & spots with storage
  // access, else their first HR page, else the AI usage report.
  const start =
    visible.find((item) => item.href === START_HREF) ?? visible.at(0);
  return start === undefined || start.href === pathname
    ? undefined
    : { kind: "START", item: start };
}
