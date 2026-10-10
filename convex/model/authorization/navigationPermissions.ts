export const NAVIGATION_PERMISSION = Object.freeze({
  storageLayouts: "masterData.storageLayout.read",
  storageLayoutActivate: "masterData.storageLayout.activate",
  storageLayoutManage: "masterData.storageLayout.manage",
} as const);
export type NavigationPermissionCode =
  (typeof NAVIGATION_PERMISSION)[keyof typeof NAVIGATION_PERMISSION];
export const NAVIGATION_PERMISSION_CODES: readonly NavigationPermissionCode[] =
  Object.freeze(Object.values(NAVIGATION_PERMISSION));

/**
 * HR module permission codes. Organization-scoped grants; each HR handler
 * additionally checks site scope and the reporting relationship.
 */
export const HR_PERMISSION = Object.freeze({
  /** Reach the HR module and the actor's own linked attendance. */
  selfAccess: "hr.self.access",
  /** Review exceptions and corrections of assigned direct reports. */
  teamReview: "hr.team.review",
  /** Maintain employees, schedules, holidays and HR access; review in scope. */
  adminManage: "hr.admin.manage",
  /** Create, close and revise attendance periods. */
  periodClose: "hr.period.close",
  /** Download a closed attendance period version. */
  periodExport: "hr.period.export",
} as const);
export type HrPermissionCode =
  (typeof HR_PERMISSION)[keyof typeof HR_PERMISSION];
export const HR_PERMISSION_CODES: readonly HrPermissionCode[] = Object.freeze(
  Object.values(HR_PERMISSION),
);
