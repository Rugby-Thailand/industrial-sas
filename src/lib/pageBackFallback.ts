import { LOCALES } from "@/i18n/routing";
import { readEmployeesUrl, readReviewUrl, ROUTES } from "./navigation";

const internalOrigin = "https://page-back.invalid";

function internalUrl(href: string): URL | null {
  if (
    !href.startsWith("/") ||
    href.startsWith("//") ||
    /[\\\s\u0000-\u001f\u007f]/.test(href)
  )
    return null;
  try {
    const url = new URL(href, internalOrigin);
    if (url.origin !== internalOrigin || url.pathname.includes("//"))
      return null;
    if (/[\\\u0000-\u001f\u007f]/.test(decodeURIComponent(url.pathname)))
      return null;
    // A locale is routing context, not a different parent module.
    const locale = LOCALES.find(
      (value) =>
        url.pathname === `/${value}` || url.pathname.startsWith(`/${value}/`),
    );
    if (locale) url.pathname = url.pathname.slice(locale.length + 1) || "/";
    return url;
  } catch {
    return null;
  }
}

function moduleFor(pathname: string): string | null {
  return (
    [ROUTES.storageLayouts, ROUTES.finishedGoods, "/hr"].find(
      (root) => pathname === root || pathname.startsWith(`${root}/`),
    ) ?? null
  );
}

function relativeHref(url: URL): string {
  return url.pathname + url.search + url.hash;
}

function selectedListParent(url: URL): string | null {
  let owned: readonly string[];
  if (
    url.pathname === ROUTES.hrEmployees &&
    readEmployeesUrl(url.searchParams).mode !== "LIST"
  )
    owned = ["employee", "mode", "focus"];
  else if (
    url.pathname === ROUTES.hrReview &&
    readReviewUrl(url.searchParams).selection
  )
    owned = ["employee", "date", "focus"];
  else return null;
  const parent = new URL(url);
  for (const key of owned) parent.searchParams.delete(key);
  return relativeHref(parent);
}

/** Audited module parents; hubs have no synthetic previous page. */
export function moduleBackFallback(currentHref: string): string | null {
  const current = internalUrl(currentHref);
  if (!current) return null;
  const selectedParent = selectedListParent(current);
  if (selectedParent) return selectedParent;
  const path = current.pathname;
  for (const [child, parent] of [
    [ROUTES.hrAnnouncementsManage, ROUTES.hrAnnouncements],
    [ROUTES.hrLeaveReview, ROUTES.hrLeave],
    [ROUTES.hrPayslipImport, ROUTES.hrPayslips],
    [ROUTES.hrFrozenPeriods, ROUTES.hrTime],
  ])
    if (path === child) return parent!;
  for (const parent of [
    ROUTES.hrAnnouncements,
    ROUTES.hrLeaveReview,
    ROUTES.hrLeave,
    ROUTES.hrPayslips,
    ROUTES.hrFrozenPeriods,
  ])
    if (path.startsWith(`${parent}/`)) return parent;
  if (path === ROUTES.hrCustomize) return ROUTES.hrToday;
  if (/^\/hr\/requests\/[^/]+$/.test(path)) return ROUTES.hrRequests;
  if (/^\/hr\/periods\/[^/]+$/.test(path)) return ROUTES.hrPeriods;
  if (/^\/hr\/time\/[^/]+$/.test(path)) return ROUTES.hrTime;
  if (path.startsWith(`${ROUTES.storageLayouts}/`)) {
    const suffix = path.slice(ROUTES.storageLayouts.length + 1).split("/");
    if (suffix.length === 1) return ROUTES.storageLayouts;
    if (suffix[1] === "review" || suffix[1] === "floors")
      return `${ROUTES.storageLayouts}/${suffix[0]}`;
  }
  if (path.startsWith(`${ROUTES.finishedGoods}/`)) {
    const suffix = path.slice(ROUTES.finishedGoods.length + 1).split("/");
    if (
      (suffix[0] === "pallets" || suffix[0] === "products") &&
      suffix.length > 2
    )
      return `${ROUTES.finishedGoods}/${suffix[0]}/${suffix[1]}`;
    return ROUTES.finishedGoods;
  }
  return null;
}

/** Validate a supplied parent without accepting external, cross-module or self destinations. */
export function resolvePageBackFallback(
  currentHref: string,
  requested: string | null | undefined,
): string | null {
  if (requested == null) return null;
  const current = internalUrl(currentHref);
  const parent = internalUrl(requested);
  if (
    !current ||
    !parent ||
    !moduleFor(current.pathname) ||
    moduleFor(current.pathname) !== moduleFor(parent.pathname)
  )
    return null;
  if (current.pathname === parent.pathname) {
    // Only validated editor/record intent can have a parent on this same route.
    const localParent = selectedListParent(current);
    if (!localParent) return null;
    const local = new URL(localParent, internalOrigin);
    local.searchParams.sort();
    const comparable = new URL(parent);
    comparable.searchParams.sort();
    if (relativeHref(local) !== relativeHref(comparable)) return null;
  }
  return relativeHref(parent);
}
