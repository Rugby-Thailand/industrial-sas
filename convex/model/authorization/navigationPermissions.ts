export const NAVIGATION_PERMISSION = Object.freeze({
  storageLayouts: "masterData.storageLayout.read",
  storageLayoutActivate: "masterData.storageLayout.activate",
  storageLayoutManage: "masterData.storageLayout.manage",
} as const);
export type NavigationPermissionCode =
  (typeof NAVIGATION_PERMISSION)[keyof typeof NAVIGATION_PERMISSION];
export const NAVIGATION_PERMISSION_CODES: readonly NavigationPermissionCode[] =
  Object.freeze(Object.values(NAVIGATION_PERMISSION));
