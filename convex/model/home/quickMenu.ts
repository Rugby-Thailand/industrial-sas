/**
 * Home quick-menu catalog shared by `workspace/quickMenus` and the browser.
 *
 * One source for which shortcut keys exist, which permissions make each
 * available, the default order, the save bounds and the public payload
 * shapes. Pure: no Convex runtime, no database, no clock.
 */
import {
  HR_PERMISSION,
  NAVIGATION_PERMISSION,
} from "../authorization/navigationPermissions";

/** The default entry permission for a module’s destinations. */
export const MODULE_ENTRY_PERMISSION = Object.freeze({
  planner: "masterData.warehouse.read",
  hr: HR_PERMISSION.selfAccess,
  admin: NAVIGATION_PERMISSION.aiUsage,
} as const);
export type QuickMenuModule = keyof typeof MODULE_ENTRY_PERMISSION;

/** Home is reachable through a module entry grant or access to customer records. */
export const HOME_ELIGIBILITY_PERMISSIONS: readonly string[] = Object.freeze([
  MODULE_ENTRY_PERMISSION.planner,
  MODULE_ENTRY_PERMISSION.hr,
  MODULE_ENTRY_PERMISSION.admin,
  NAVIGATION_PERMISSION.customers,
]);

/** Unread notification events, matching `hrNotifications.event`. */
export const HR_NOTIFICATION_EVENTS = [
  "ANNOUNCEMENT_PUBLISHED",
  "LEAVE_DECIDED",
  "CORRECTION_DECIDED",
  "PAYSLIP_PUBLISHED",
] as const;
export type HrNotificationEvent = (typeof HR_NOTIFICATION_EVENTS)[number];

/** A tile's badge: one event's unread count, or the sum of all of them. */
export type QuickMenuBadge = HrNotificationEvent | "AGGREGATE";

/**
 * Every sidebar menu destination, in sidebar order. Keys equal the
 * `StaticDestinationKey` of `src/lib/navigation.ts`.
 */
export const QUICK_MENU_KEYS = [
  "planner.finishedGoods",
  "planner.jobScan",
  "planner.jobScanRecords",
  "planner.storageLayouts",
  "planner.customers",
  "hr.today",
  "hr.time",
  "hr.requests",
  "hr.holidays",
  "hr.leave",
  "hr.leaveReview",
  "hr.announcements",
  "hr.announcementsManage",
  "hr.notifications",
  "hr.payslips",
  "hr.payslipImport",
  "hr.profile",
  "hr.review",
  "hr.employees",
  "hr.periods",
  "hr.settings",
  "admin.aiUsage",
] as const;
export type QuickMenuKey = (typeof QUICK_MENU_KEYS)[number];

export interface QuickMenuEntry {
  readonly key: QuickMenuKey;
  readonly module: QuickMenuModule;
  /** The destination's own permission, beside the module entry permission. */
  readonly permissionCode: string;
  readonly badge?: QuickMenuBadge;
}

const STORAGE_READ = NAVIGATION_PERMISSION.storageLayouts;
const planner = (
  key: QuickMenuKey,
  permissionCode: string = STORAGE_READ,
): QuickMenuEntry => ({
  key,
  module: "planner",
  permissionCode,
});
const hr = (
  key: QuickMenuKey,
  permissionCode: string = HR_PERMISSION.selfAccess,
  badge?: QuickMenuBadge,
): QuickMenuEntry => ({
  key,
  module: "hr",
  permissionCode,
  ...(badge === undefined ? {} : { badge }),
});

export const QUICK_MENU_CATALOG: readonly QuickMenuEntry[] = Object.freeze(
  (
    [
      planner("planner.finishedGoods"),
      planner("planner.jobScan"),
      planner("planner.jobScanRecords"),
      planner("planner.storageLayouts"),
      planner("planner.customers", NAVIGATION_PERMISSION.customers),
      hr("hr.today"),
      hr("hr.time"),
      hr("hr.requests", undefined, "CORRECTION_DECIDED"),
      hr("hr.holidays"),
      hr("hr.leave", undefined, "LEAVE_DECIDED"),
      hr("hr.leaveReview", HR_PERMISSION.teamReview),
      hr("hr.announcements", undefined, "ANNOUNCEMENT_PUBLISHED"),
      hr("hr.announcementsManage", HR_PERMISSION.adminManage),
      hr("hr.notifications", undefined, "AGGREGATE"),
      hr("hr.payslips", undefined, "PAYSLIP_PUBLISHED"),
      hr("hr.payslipImport", HR_PERMISSION.adminManage),
      hr("hr.profile"),
      hr("hr.review", HR_PERMISSION.teamReview),
      hr("hr.employees", HR_PERMISSION.adminManage),
      hr("hr.periods", HR_PERMISSION.periodClose),
      hr("hr.settings", HR_PERMISSION.adminManage),
      {
        key: "admin.aiUsage",
        module: "admin",
        permissionCode: NAVIGATION_PERMISSION.aiUsage,
      },
    ] satisfies QuickMenuEntry[]
  ).map((entry) => Object.freeze(entry)),
);

export const QUICK_MENU_BY_KEY: ReadonlyMap<QuickMenuKey, QuickMenuEntry> =
  new Map(QUICK_MENU_CATALOG.map((entry) => [entry.key, entry]));

/** All permissions a tile needs, deduplicated. */
export function quickMenuPermissions(entry: QuickMenuEntry): readonly string[] {
  const entryCode = MODULE_ENTRY_PERMISSION[entry.module];
  return entry.key === "planner.customers" || entryCode === entry.permissionCode
    ? [entry.permissionCode]
    : [entryCode, entry.permissionCode];
}

/** Every code the availability check needs, deduplicated, stable order. */
export const QUICK_MENU_PERMISSION_CODES: readonly string[] = Object.freeze([
  ...new Set(QUICK_MENU_CATALOG.flatMap(quickMenuPermissions)),
]);

/** Default pin order; the first `DEFAULT_PINNED_COUNT` available keys pin. */
export const DEFAULT_QUICK_MENU_ORDER: readonly QuickMenuKey[] = Object.freeze([
  "planner.finishedGoods",
  "planner.jobScan",
  "hr.announcements",
  "hr.leave",
  "hr.payslips",
  "hr.notifications",
  ...QUICK_MENU_KEYS.filter(
    (key) =>
      ![
        "planner.finishedGoods",
        "planner.jobScan",
        "hr.announcements",
        "hr.leave",
        "hr.payslips",
        "hr.notifications",
      ].includes(key),
  ),
]);
export const DEFAULT_PINNED_COUNT = 6;

/** Save bounds, checked before any hashing or database read. */
export const MAX_QUICK_MENU_PINS = QUICK_MENU_KEYS.length;
export const MAX_QUICK_MENU_VERSION = 100_000;
export const MAX_QUICK_MENU_REQUEST_ID_LENGTH = 128;
export const QUICK_MENU_REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;

/** Unread counts are read with `.take(UNREAD_BADGE_CAP)` per event. */
export const UNREAD_BADGE_CAP = 100;

/**
 * `readRetryAttempt` is an optional integer 0..MAX_READ_RETRY_ATTEMPT that a
 * client bumps to restart a live read; it changes nothing else.
 */
export const MAX_READ_RETRY_ATTEMPT = 1_000;
export const isReadRetryAttempt = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= MAX_READ_RETRY_ATTEMPT;

/** Bounds for an echoed Clerk ID (checked before comparison). */
export const MAX_CLERK_ID_LENGTH = 128;

/**
 * Pre-audit precondition failures, thrown as `ConvexError` data
 * `{ code, requestId, field? }` before authorization runs: no audit row,
 * no database write.
 * - TENANT_SCOPE_MISMATCH: `expectedClerkScope` differs from the session's
 *   active Clerk organization or user.
 * - ACTOR_SCOPE_MISMATCH: `expectedActorUserId` differs from the session's
 *   resolved user.
 * - INVALID_INPUT: a precondition argument is out of bounds (`field`).
 */
export const PRECONDITION_FAILURE_CODES = [
  "TENANT_SCOPE_MISMATCH",
  "ACTOR_SCOPE_MISMATCH",
  "INVALID_INPUT",
] as const;
export type PreconditionFailureCode =
  (typeof PRECONDITION_FAILURE_CODES)[number];

export const isQuickMenuKey = (value: unknown): value is QuickMenuKey =>
  typeof value === "string" && QUICK_MENU_BY_KEY.has(value as QuickMenuKey);

/** Keys whose every permission is granted, in catalog order. */
export function availableQuickMenuKeys(
  granted: Iterable<string>,
): QuickMenuKey[] {
  const held = new Set(granted);
  return QUICK_MENU_CATALOG.filter((entry) =>
    quickMenuPermissions(entry).every((code) => held.has(code)),
  ).map((entry) => entry.key);
}

export function defaultPinnedKeys(
  available: readonly QuickMenuKey[],
): QuickMenuKey[] {
  const allowed = new Set(available);
  return DEFAULT_QUICK_MENU_ORDER.filter((key) => allowed.has(key)).slice(
    0,
    DEFAULT_PINNED_COUNT,
  );
}

export type PinnedKeysProblem = "TOO_MANY" | "UNKNOWN_KEY" | "DUPLICATE_KEY";

/** Static shape check; availability is checked against live grants later. */
export function pinnedKeysProblem(
  keys: readonly string[],
): PinnedKeysProblem | null {
  if (keys.length > MAX_QUICK_MENU_PINS) return "TOO_MANY";
  if (!keys.every(isQuickMenuKey)) return "UNKNOWN_KEY";
  if (new Set(keys).size !== keys.length) return "DUPLICATE_KEY";
  return null;
}

/** 0 → no pill; 1..99 → exact; ≥ 100 (a capped read) → "99+". */
export function unreadBadgeText(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count >= UNREAD_BADGE_CAP ? "99+" : String(Math.floor(count));
}

/* Public payloads ---------------------------------------------------------
 * Each is the `value` of the tenant outcome `{ ok: true, requestId, value }`.
 */

export interface QuickMenuClerkScope {
  readonly clerkOrgId: string;
  readonly clerkUserId: string;
}

/** Optional read args shared by `current` and `unreadSummary`. */
export interface ScopedReadArgs {
  /** When given, the read throws TENANT_SCOPE_MISMATCH on another session. */
  readonly expectedClerkScope?: QuickMenuClerkScope;
  /** Integer 0..MAX_READ_RETRY_ATTEMPT; otherwise INVALID_INPUT. */
  readonly readRetryAttempt?: number;
}

/** `workspace/quickMenus:current` args. */
export type QuickMenuCurrentArgs = ScopedReadArgs;

/** `workspace/quickMenus:current` value. */
export interface QuickMenuCurrent {
  readonly clerkScope: QuickMenuClerkScope;
  readonly actorUserId: string;
  /** Catalog order, filtered by live grants. */
  readonly availableKeys: readonly QuickMenuKey[];
  /** Saved order filtered by availability, or the default when never saved. */
  readonly pinnedKeys: readonly QuickMenuKey[];
  /** False only when no preference row exists (a saved `[]` is customized). */
  readonly customized: boolean;
  /** 0 when never saved; pass as `expectedVersion`. */
  readonly version: number;
  readonly maxVersion: number;
}

/** `workspace/quickMenus:save` args. */
export interface QuickMenuSaveArgs {
  readonly requestId: string;
  readonly expectedClerkScope: QuickMenuClerkScope;
  readonly expectedActorUserId: string;
  readonly expectedVersion: number;
  readonly pinnedKeys: readonly string[];
}

export type QuickMenuSaveRefusalCode =
  | "REQUEST_ID_INVALID"
  | "PINNED_KEYS_INVALID"
  | "VERSION_INVALID"
  | "VERSION_LIMIT"
  | "VERSION_STALE"
  | "PIN_NOT_AVAILABLE"
  | "REQUEST_ARGUMENT_CONFLICT"
  | "REPLAY_UNVERIFIABLE";

export type QuickMenuSaveResult =
  | {
      readonly ok: true;
      /** True when this answers an earlier identical request (no writes). */
      readonly replayed: boolean;
      readonly documentId: string;
      readonly version: number;
      readonly pinnedKeys: readonly QuickMenuKey[];
    }
  | {
      readonly ok: false;
      readonly code: QuickMenuSaveRefusalCode;
      /** PINNED_KEYS_INVALID detail, or the unavailable key. */
      readonly reason?: string;
      /** VERSION_STALE: the stored version to rebase on. */
      readonly currentVersion?: number;
    };

/** `workspace/quickMenus:receiptStatus` args: the save's own inputs. */
export interface QuickMenuReceiptArgs {
  readonly requestId: string;
  /** Required preconditions, as for `save`. */
  readonly expectedClerkScope: QuickMenuClerkScope;
  readonly expectedActorUserId: string;
  readonly expectedVersion: number;
  readonly pinnedKeys: readonly string[];
}

export type QuickMenuReceiptStatus =
  /** The save committed; it may since have been superseded. */
  | {
      readonly status: "CONFIRMED";
      readonly documentId: string;
      readonly version: number;
    }
  /** No receipt for this actor and request: unconfirmed, may be retried. */
  | { readonly status: "NOT_FOUND" }
  /** A receipt exists for this request ID with different inputs. */
  | { readonly status: "CONFLICT" }
  /** The arguments fail static bounds; nothing was looked up. */
  | { readonly status: "INVALID_INPUT" };

/** `hr/notifications:unreadSummary` args. */
export type HrUnreadSummaryArgs = ScopedReadArgs;

/** `hr/notifications:unreadSummary` value. */
export type HrUnreadCounts = Readonly<Record<HrNotificationEvent, number>>;
export interface HrUnreadSummary {
  /** The session these counts belong to; drop them on any other session. */
  readonly clerkScope: QuickMenuClerkScope;
  readonly linked: boolean;
  /** Each 0..UNREAD_BADGE_CAP; a value equal to the cap means "at least". */
  readonly counts: HrUnreadCounts;
  /** Sum of `counts` (0..4 × cap); ≥ cap renders "99+". */
  readonly total: number;
}

export const ZERO_UNREAD_COUNTS: HrUnreadCounts = Object.freeze({
  ANNOUNCEMENT_PUBLISHED: 0,
  LEAVE_DECIDED: 0,
  CORRECTION_DECIDED: 0,
  PAYSLIP_PUBLISHED: 0,
});

/** The count a tile shows, or undefined for an unbadged tile. */
export function badgeCount(
  badge: QuickMenuBadge | undefined,
  summary: Pick<HrUnreadSummary, "counts" | "total">,
): number | undefined {
  if (badge === undefined) return undefined;
  return badge === "AGGREGATE" ? summary.total : summary.counts[badge];
}
