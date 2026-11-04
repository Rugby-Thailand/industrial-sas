import {
  activeNavigationHref,
  DESKTOP_NAVIGATION,
  ROUTES,
  type NavigationItem,
} from "@/lib/navigation";

const MENU: readonly NavigationItem[] = DESKTOP_NAVIGATION.flatMap(
  (section) => section.items,
);

/** The signed-in start page: `/[locale]` and the sign-in default open it. */
export const START_DESTINATION = MENU.find(
  (item) => item.href === ROUTES.storageLayouts,
);

/**
 * Where a page that failed to load can safely send the user: the nearest menu
 * destination above it (its module hub), else the start page. Never the
 * failed page itself, so a failing hub or start page offers retry only.
 */
export function recoveryDestination(
  pathname: string,
): NavigationItem | undefined {
  const above = MENU.filter((item) => item.href !== pathname);
  const href = activeNavigationHref(
    pathname,
    above.map((item) => item.href),
  );
  const parent = above.find((item) => item.href === href);
  if (parent !== undefined) return parent;
  return START_DESTINATION?.href === pathname ? undefined : START_DESTINATION;
}
