import { NAVIGATION_PERMISSION } from "../../convex/model/authorization/navigationPermissions";

export interface NavigationItem {
  readonly href: string;

  readonly labelKey: string;

  readonly permissionCodes: readonly string[];
  readonly permissionMode?: "ALL" | "ANY";
}

export interface NavigationSection {
  readonly labelKey: string;
  readonly items: readonly NavigationItem[];
}

export const ROUTES = Object.freeze({
  storageLayouts: "/master-data/storage-layouts",
  finishedGoods: "/finished-goods",
  setup: "/setup",
  signIn: "/sign-in",
});

export const DESKTOP_NAVIGATION: readonly NavigationSection[] = Object.freeze([
  {
    labelKey: "sectionPlanner",
    items: [
      {
        href: ROUTES.finishedGoods,
        labelKey: "finishedGoods",
        permissionCodes: [NAVIGATION_PERMISSION.storageLayouts],
      },
      {
        href: ROUTES.storageLayouts,
        labelKey: "storageLayouts",
        permissionCodes: [NAVIGATION_PERMISSION.storageLayouts],
      },
    ],
  },
]);

export const storageBuildingPath = (buildingId: string): string =>
  `${ROUTES.storageLayouts}/${encodeURIComponent(buildingId)}`;

export const storageFloorPath = (
  buildingId: string,
  floorNumber: number,
): string =>
  `${storageBuildingPath(buildingId)}?floor=${floorNumber}&editing=1`;

export const storageReviewPath = (buildingId: string): string =>
  `${storageBuildingPath(buildingId)}/review`;

export function isActivePath(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(`${href}/`);
}

export function hasNavigationPermission(
  required: readonly string[] | undefined,
  granted: readonly string[],
  mode: "ALL" | "ANY" = "ALL",
): boolean {
  return matchesPermissionSet(required, new Set(granted), mode);
}

function matchesPermissionSet(
  required: readonly string[] | undefined,
  granted: ReadonlySet<string>,
  mode: "ALL" | "ANY",
): boolean {
  if (required === undefined || required.length === 0) return true;
  return mode === "ANY"
    ? required.some((permission) => granted.has(permission))
    : required.every((permission) => granted.has(permission));
}

export function visibleDesktopNavigation(
  granted: readonly string[],
): readonly NavigationSection[] {
  const permissionSet = new Set(granted);
  return DESKTOP_NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter((item) =>
      matchesPermissionSet(
        item.permissionCodes,
        permissionSet,
        item.permissionMode ?? "ALL",
      ),
    ),
  })).filter((section) => section.items.length > 0);
}

export const FG_PATH = ROUTES.finishedGoods;
export const productPath = (id: string) =>
  `${FG_PATH}/products/${encodeURIComponent(id)}`;
export const unitCorrectionPath = (productId: string, unitId: string) =>
  `${productPath(productId)}?editUnit=${encodeURIComponent(unitId)}`;
export const batchPath = (id: string) =>
  `${FG_PATH}/batches/${encodeURIComponent(id)}`;
export const palletPath = (id: string) =>
  `${FG_PATH}/pallets/${encodeURIComponent(id)}`;
export const measurePath = (id: string) => `${palletPath(id)}/measure`;
export const storagePath = (id: string) => `${palletPath(id)}/storage`;
