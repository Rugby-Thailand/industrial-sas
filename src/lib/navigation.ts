import {
  HR_PERMISSION,
  NAVIGATION_PERMISSION,
} from "../../convex/model/authorization/navigationPermissions";
import { isIsoDate } from "../../convex/model/hr/calendar";
import {
  SETTINGS_SECTIONS,
  type EmployeeFocus,
  type PageKey,
  type SettingsSection,
} from "../../convex/model/search/intent";

export const HR_CODES = Object.freeze({
  self: HR_PERMISSION.selfAccess,
  review: HR_PERMISSION.teamReview,
  admin: HR_PERMISSION.adminManage,
  close: HR_PERMISSION.periodClose,
  export: HR_PERMISSION.periodExport,
} as const);

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
  aiUsage: "/ai-usage",
  storageLayouts: "/master-data/storage-layouts",
  finishedGoods: "/finished-goods",
  jobScan: "/finished-goods/scan",
  jobScanRecords: "/finished-goods/scan/records",
  setup: "/setup",
  signIn: "/sign-in",
  hrToday: "/hr/today",
  hrTime: "/hr/time",
  hrProfile: "/hr/profile",
  hrReview: "/hr/review",
  hrEmployees: "/hr/employees",
  hrPeriods: "/hr/periods",
  hrSettings: "/hr/settings",
});

export const PLANNER_PATHS: readonly string[] = Object.freeze([
  ROUTES.storageLayouts,
  ROUTES.finishedGoods,
]);

/* Destination registry ----------------------------------------------------
 *
 * One source for the sidebar menu, global search and AI navigation. Static
 * destinations carry their route, labels (Navigation namespace), Thai and
 * English aliases and required permissions. Record destinations are typed
 * targets whose URLs are built here from validated parameters only, so no
 * search result or model answer can supply a URL of its own. Locale prefixes
 * are added by the next-intl router, never by these builders.
 */

export type StaticDestinationKey =
  | "admin.aiUsage"
  | PageKey
  | `hr.settings.${SettingsSection}`
  | "hr.task.clock"
  | "hr.task.correction"
  | "hr.task.reviewDay"
  | "hr.task.editSchedule"
  | "hr.task.exportPeriod";

export interface StaticDestination {
  readonly key: StaticDestinationKey;
  /** PAGE: menu-level page; SECTION: part of a page; TASK: a job to do there. */
  readonly kind: "PAGE" | "SECTION" | "TASK";
  readonly module: "planner" | "hr" | "admin";
  readonly href: string;
  readonly labelKey: string;
  /** Breadcrumb parent; the module section label precedes it. */
  readonly parent?: StaticDestinationKey;
  readonly aliases: readonly string[];
  readonly permissionCodes: readonly string[];
  readonly permissionMode?: "ALL" | "ANY";
  /** Shown in the sidebar, in this order within its module. */
  readonly menu?: boolean;
  /** A task that still needs a record or date before it can open one. */
  readonly needs?: "DATE" | "EMPLOYEE_DATE" | "EMPLOYEE" | "DATE_RANGE";
}

const STORAGE_READ = [NAVIGATION_PERMISSION.storageLayouts];
const STORAGE_MANAGE = [NAVIGATION_PERMISSION.storageLayoutManage];

export const STATIC_DESTINATIONS: readonly StaticDestination[] = Object.freeze([
  {
    key: "planner.finishedGoods",
    kind: "PAGE",
    module: "planner",
    href: ROUTES.finishedGoods,
    labelKey: "finishedGoods",
    aliases: [
      "สินค้าสำเร็จรูป",
      "สินค้า",
      "พาเลท",
      "ล็อต",
      "finished goods",
      "products",
      "pallets",
      "batches",
      "fg",
    ],
    permissionCodes: STORAGE_READ,
    menu: true,
  },
  {
    key: "planner.newProduct",
    kind: "TASK",
    module: "planner",
    href: `${ROUTES.finishedGoods}/new`,
    labelKey: "newProduct",
    parent: "planner.finishedGoods",
    aliases: [
      "เพิ่มสินค้า",
      "สร้างสินค้า",
      "สินค้าใหม่",
      "new product",
      "add product",
      "create finished good",
    ],
    permissionCodes: STORAGE_MANAGE,
  },
  {
    key: "planner.jobScan",
    kind: "PAGE",
    module: "planner",
    href: ROUTES.jobScan,
    labelKey: "jobScan",
    aliases: [
      "สแกน",
      "สแกนใบงาน",
      "ใบสั่งงาน",
      "ถ่ายรูปใบงาน",
      "scan",
      "job ticket",
      "ocr",
    ],
    permissionCodes: STORAGE_READ,
    menu: true,
  },
  {
    key: "planner.jobScanRecords",
    kind: "PAGE",
    module: "planner",
    href: ROUTES.jobScanRecords,
    labelKey: "jobScanRecords",
    aliases: [
      "รายการสแกน",
      "ประวัติสแกน",
      "บันทึกสแกน",
      "scan records",
      "scanned tickets",
      "scan history",
    ],
    permissionCodes: STORAGE_READ,
    menu: true,
  },
  {
    key: "planner.storageLayouts",
    kind: "PAGE",
    module: "planner",
    href: ROUTES.storageLayouts,
    labelKey: "storageLayouts",
    aliases: [
      "อาคาร",
      "ชั้น",
      "ตำแหน่งจัดเก็บ",
      "ผังคลัง",
      "คลังสินค้า",
      "building",
      "floor",
      "storage",
      "layout",
      "warehouse map",
    ],
    permissionCodes: STORAGE_READ,
    menu: true,
  },
  {
    key: "planner.newBuilding",
    kind: "TASK",
    module: "planner",
    href: `${ROUTES.storageLayouts}/new`,
    labelKey: "newBuilding",
    parent: "planner.storageLayouts",
    aliases: [
      "เพิ่มอาคาร",
      "สร้างอาคาร",
      "อาคารใหม่",
      "new building",
      "add building",
    ],
    permissionCodes: STORAGE_MANAGE,
  },
  {
    key: "planner.setup",
    kind: "PAGE",
    module: "planner",
    href: ROUTES.setup,
    labelKey: "setupChecklist",
    aliases: [
      "ตั้งค่าระบบ",
      "การตั้งค่าเริ่มต้น",
      "setup",
      "configuration",
      "checklist",
    ],
    permissionCodes: STORAGE_READ,
  },
  {
    key: "hr.today",
    kind: "PAGE",
    module: "hr",
    href: ROUTES.hrToday,
    labelKey: "hrToday",
    aliases: ["วันนี้", "ลงเวลาวันนี้", "today", "attendance today"],
    permissionCodes: [HR_CODES.self],
    menu: true,
  },
  {
    key: "hr.task.clock",
    kind: "TASK",
    module: "hr",
    href: ROUTES.hrToday,
    labelKey: "taskClock",
    parent: "hr.today",
    aliases: [
      "ลงเวลา",
      "เข้างาน",
      "ออกงาน",
      "ตอกบัตร",
      "สแกนนิ้ว",
      "clock in",
      "clock out",
      "punch",
      "check in",
      "check out",
    ],
    permissionCodes: [HR_CODES.self],
  },
  {
    key: "hr.time",
    kind: "PAGE",
    module: "hr",
    href: ROUTES.hrTime,
    labelKey: "hrTime",
    aliases: [
      "ประวัติเวลา",
      "เวลาทำงาน",
      "คำขอของฉัน",
      "time history",
      "my requests",
      "attendance history",
      "timesheet",
    ],
    permissionCodes: [HR_CODES.self],
    menu: true,
  },
  {
    key: "hr.task.correction",
    kind: "TASK",
    module: "hr",
    href: ROUTES.hrTime,
    labelKey: "taskCorrection",
    parent: "hr.time",
    aliases: [
      "แก้เวลา",
      "ขอแก้เวลา",
      "ลืมลงเวลา",
      "ลืมตอกบัตร",
      "ลืมเข้างาน",
      "ลืมออกงาน",
      "คำขอแก้เวลา",
      "correction",
      "fix time",
      "forgot to clock",
      "missed punch",
      "time correction",
    ],
    permissionCodes: [HR_CODES.self],
    needs: "DATE",
  },
  {
    key: "hr.profile",
    kind: "PAGE",
    module: "hr",
    href: ROUTES.hrProfile,
    labelKey: "hrProfile",
    aliases: [
      "โปรไฟล์",
      "ข้อมูลของฉัน",
      "ตารางงานของฉัน",
      "profile",
      "my schedule",
      "my shift",
    ],
    permissionCodes: [HR_CODES.self],
    menu: true,
  },
  {
    key: "hr.review",
    kind: "PAGE",
    module: "hr",
    href: ROUTES.hrReview,
    labelKey: "hrReview",
    aliases: [
      "ตรวจ",
      "ตรวจคำขอ",
      "อนุมัติเวลา",
      "รับรองเวลา",
      "ข้อยกเว้น",
      "review",
      "approve time",
      "exceptions",
      "queue",
      "certify",
    ],
    permissionCodes: [HR_CODES.review],
    menu: true,
  },
  {
    key: "hr.task.reviewDay",
    kind: "TASK",
    module: "hr",
    href: ROUTES.hrReview,
    labelKey: "taskReviewDay",
    parent: "hr.review",
    aliases: [
      "ตรวจวัน",
      "ตรวจคำขอแก้เวลา",
      "รับรองวัน",
      "review day",
      "review request",
    ],
    permissionCodes: [HR_CODES.review],
    needs: "EMPLOYEE_DATE",
  },
  {
    key: "hr.employees",
    kind: "PAGE",
    module: "hr",
    href: ROUTES.hrEmployees,
    labelKey: "hrEmployees",
    aliases: [
      "พนักงาน",
      "รายชื่อพนักงาน",
      "ทะเบียนพนักงาน",
      "employees",
      "staff",
      "people",
      "roster",
    ],
    permissionCodes: [HR_CODES.admin],
    menu: true,
  },
  {
    key: "hr.newEmployee",
    kind: "TASK",
    module: "hr",
    href: `${ROUTES.hrEmployees}?mode=new`,
    labelKey: "newEmployee",
    parent: "hr.employees",
    aliases: [
      "เพิ่มพนักงาน",
      "พนักงานใหม่",
      "add employee",
      "new employee",
      "new hire",
    ],
    permissionCodes: [HR_CODES.admin],
  },
  {
    key: "hr.task.editSchedule",
    kind: "TASK",
    module: "hr",
    href: ROUTES.hrEmployees,
    labelKey: "taskEditSchedule",
    parent: "hr.employees",
    aliases: [
      "แก้ตารางงาน",
      "ตารางงาน",
      "กะงาน",
      "เวลาเข้างาน",
      "edit schedule",
      "work schedule",
      "shift",
    ],
    permissionCodes: [HR_CODES.admin],
    needs: "EMPLOYEE",
  },
  {
    key: "hr.periods",
    kind: "PAGE",
    module: "hr",
    href: ROUTES.hrPeriods,
    labelKey: "hrPeriods",
    aliases: [
      "งวด",
      "ปิดงวด",
      "งวดเวลา",
      "periods",
      "close period",
      "pay period",
    ],
    permissionCodes: [HR_CODES.close],
    menu: true,
  },
  {
    key: "hr.task.exportPeriod",
    kind: "TASK",
    module: "hr",
    href: ROUTES.hrPeriods,
    labelKey: "taskExportPeriod",
    parent: "hr.periods",
    aliases: [
      "ส่งออก",
      "ส่งออกงวด",
      "ดาวน์โหลด",
      "csv",
      "export",
      "export period",
      "download",
    ],
    permissionCodes: [HR_CODES.close],
    needs: "DATE_RANGE",
  },
  {
    key: "hr.settings",
    kind: "PAGE",
    module: "hr",
    href: ROUTES.hrSettings,
    labelKey: "hrSettings",
    aliases: ["ตั้งค่า hr", "ตั้งค่าบุคคล", "hr settings", "settings"],
    permissionCodes: [HR_CODES.admin],
    menu: true,
  },
  {
    key: "hr.settings.holidays",
    kind: "SECTION",
    module: "hr",
    href: `${ROUTES.hrSettings}?section=holidays`,
    labelKey: "settingsHolidays",
    parent: "hr.settings",
    aliases: [
      "วันหยุด",
      "ตั้งวันหยุด",
      "วันหยุดนักขัตฤกษ์",
      "holidays",
      "holiday",
      "public holiday",
    ],
    permissionCodes: [HR_CODES.admin],
  },
  {
    key: "hr.settings.access",
    kind: "SECTION",
    module: "hr",
    href: `${ROUTES.hrSettings}?section=access`,
    labelKey: "settingsAccess",
    parent: "hr.settings",
    aliases: [
      "สิทธิ์",
      "สิทธิ์ hr",
      "หัวหน้างาน",
      "ให้สิทธิ์",
      "access",
      "permissions",
      "supervisor role",
    ],
    permissionCodes: [HR_CODES.admin],
  },
  {
    key: "hr.settings.policy",
    kind: "SECTION",
    module: "hr",
    href: `${ROUTES.hrSettings}?section=policy`,
    labelKey: "settingsPolicy",
    parent: "hr.settings",
    aliases: [
      "นโยบาย",
      "กฎการลงเวลา",
      "คอลัมน์ csv",
      "policy",
      "rules",
      "csv columns",
    ],
    permissionCodes: [HR_CODES.admin],
  },
  {
    key: "admin.aiUsage",
    kind: "PAGE",
    module: "admin",
    href: ROUTES.aiUsage,
    labelKey: "aiUsage",
    aliases: ["AI usage", "AI cost", "ค่า AI", "ต้นทุน AI", "การใช้งาน AI"],
    permissionCodes: [NAVIGATION_PERMISSION.aiUsage],
    menu: true,
  },
] satisfies readonly StaticDestination[]);

const DESTINATION_BY_KEY: ReadonlyMap<StaticDestinationKey, StaticDestination> =
  new Map(STATIC_DESTINATIONS.map((entry) => [entry.key, entry]));

export function staticDestination(
  key: StaticDestinationKey,
): StaticDestination {
  return DESTINATION_BY_KEY.get(key)!;
}

/** Navigation label keys from the module down to the destination itself. */
export function destinationTrail(key: StaticDestinationKey): readonly string[] {
  const trail: string[] = [];
  for (
    let entry: StaticDestination | undefined = staticDestination(key);
    entry !== undefined;
    entry =
      entry.parent === undefined
        ? undefined
        : DESTINATION_BY_KEY.get(entry.parent)
  )
    trail.unshift(entry.labelKey);
  const section = (
    {
      hr: "sectionHr",
      planner: "sectionPlanner",
      admin: "sectionAdmin",
    } as const
  )[staticDestination(key).module];
  return [section, ...trail];
}

const menuItems = (module: StaticDestination["module"]): NavigationItem[] =>
  STATIC_DESTINATIONS.filter(
    (entry) => entry.module === module && entry.menu === true,
  ).map((entry) => ({
    href: entry.href,
    labelKey: entry.labelKey,
    permissionCodes: entry.permissionCodes,
    ...(entry.permissionMode === undefined
      ? {}
      : { permissionMode: entry.permissionMode }),
  }));

export const DESKTOP_NAVIGATION: readonly NavigationSection[] = Object.freeze([
  { labelKey: "sectionPlanner", items: menuItems("planner") },
  { labelKey: "sectionHr", items: menuItems("hr") },
  { labelKey: "sectionAdmin", items: menuItems("admin") },
]);

/* Typed record destinations ---------------------------------------------- */

export type DayFocus = "correction";
export type ReviewFocus = "decision";
export type PeriodFocus = "export";
export type ReviewTab = "OPEN" | "CERTIFIED";

export type DestinationTarget =
  | { readonly key: StaticDestinationKey }
  | {
      readonly key: "hr.selfDay";
      readonly date: string;
      readonly focus?: DayFocus;
    }
  | {
      readonly key: "hr.reviewDay";
      readonly employeeId: string;
      readonly date: string;
      readonly focus?: ReviewFocus;
    }
  | {
      readonly key: "hr.employeeEdit";
      readonly employeeId: string;
      readonly focus?: EmployeeFocus;
    }
  | {
      readonly key: "hr.period";
      readonly periodId: string;
      readonly version?: number;
      readonly focus?: PeriodFocus;
    };

/** Stable DOM ids of deep-link focus targets; each page renders its own. */
export const FOCUS_TARGET_IDS = Object.freeze({
  correction: "hr-focus-correction",
  decision: "hr-focus-decision",
  schedule: "hr-focus-schedule",
  details: "hr-focus-details",
  export: "hr-focus-export",
  holidays: "hr-settings-holidays",
  access: "hr-settings-access",
  policy: "hr-settings-policy",
} as const);
export type FocusKey = keyof typeof FOCUS_TARGET_IDS;

/**
 * A record identifier safe to place in a URL. The server still resolves it
 * through the tenant boundary; this only refuses shapes no ID can have.
 */
export const isRecordId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_;-]{1,64}$/.test(value);

const isVersion = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 1 &&
  value <= 100_000;

/** The permission a typed destination's page requires. */
export function targetPermissions(
  target: DestinationTarget,
): readonly string[] {
  switch (target.key) {
    case "hr.selfDay":
      return [HR_CODES.self];
    case "hr.reviewDay":
      return [HR_CODES.review];
    case "hr.employeeEdit":
      return [HR_CODES.admin];
    case "hr.period":
      return target.focus === "export"
        ? [HR_CODES.close, HR_CODES.export]
        : [HR_CODES.close];
    default:
      return staticDestination(target.key).permissionCodes;
  }
}

/** The locale-free URL of a destination, or null when a parameter is invalid. */
export function destinationHref(target: DestinationTarget): string | null {
  const query = (entries: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(entries))
      if (value !== undefined) params.set(name, value);
    const text = params.toString();
    return text === "" ? "" : `?${text}`;
  };
  switch (target.key) {
    case "hr.selfDay":
      return isIsoDate(target.date)
        ? `${hrDayPath(target.date)}${query({ focus: target.focus })}`
        : null;
    case "hr.reviewDay":
      return isRecordId(target.employeeId) && isIsoDate(target.date)
        ? hrReviewPath({
            employeeId: target.employeeId,
            date: target.date,
            ...(target.focus === undefined ? {} : { focus: target.focus }),
          })
        : null;
    case "hr.employeeEdit":
      return isRecordId(target.employeeId)
        ? `${ROUTES.hrEmployees}${query({
            employee: target.employeeId,
            mode: "edit",
            focus: target.focus,
          })}`
        : null;
    case "hr.period":
      if (
        !isRecordId(target.periodId) ||
        (target.version !== undefined && !isVersion(target.version))
      )
        return null;
      return `${hrPeriodPath(target.periodId)}${query({
        version:
          target.version === undefined ? undefined : String(target.version),
        focus: target.focus,
      })}`;
    default:
      return DESTINATION_BY_KEY.get(target.key)?.href ?? null;
  }
}

/** The Review URL for a selection, tab and focus (all optional). */
export function hrReviewPath(
  state: {
    readonly employeeId?: string;
    readonly date?: string;
    readonly tab?: ReviewTab;
    readonly focus?: ReviewFocus;
  } = {},
): string {
  const params = new URLSearchParams();
  if (state.employeeId !== undefined && state.date !== undefined) {
    params.set("employee", state.employeeId);
    params.set("date", state.date);
  }
  if (state.tab === "CERTIFIED") params.set("tab", "certified");
  if (state.focus !== undefined) params.set("focus", state.focus);
  const text = params.toString();
  return text === "" ? ROUTES.hrReview : `${ROUTES.hrReview}?${text}`;
}

interface ParamReader {
  get(name: string): string | null;
}

export interface ReviewUrlState {
  readonly selection?: { readonly employeeId: string; readonly date: string };
  readonly tab?: ReviewTab;
  readonly focus?: ReviewFocus;
  /** A selection was present but malformed; the page says so. */
  readonly invalid: boolean;
}

export function readReviewUrl(params: ParamReader): ReviewUrlState {
  const employeeId = params.get("employee");
  const date = params.get("date");
  const tab = params.get("tab");
  const present = employeeId !== null || date !== null;
  const valid = isRecordId(employeeId) && isIsoDate(date);
  return {
    ...(valid ? { selection: { employeeId, date: date as string } } : {}),
    ...(tab === "certified"
      ? { tab: "CERTIFIED" as const }
      : tab === "open"
        ? { tab: "OPEN" as const }
        : {}),
    ...(valid && params.get("focus") === "decision"
      ? { focus: "decision" as const }
      : {}),
    invalid: present && !valid,
  };
}

export type EmployeesUrlState =
  | { readonly mode: "LIST"; readonly invalid: boolean }
  | { readonly mode: "NEW" }
  | {
      readonly mode: "EDIT";
      readonly employeeId: string;
      readonly focus?: EmployeeFocus;
    };

export function readEmployeesUrl(params: ParamReader): EmployeesUrlState {
  const mode = params.get("mode");
  if (mode === "new") return { mode: "NEW" };
  const employeeId = params.get("employee");
  if (mode === "edit" && isRecordId(employeeId)) {
    const focus = params.get("focus");
    return {
      mode: "EDIT",
      employeeId,
      ...(focus === "schedule" || focus === "details" ? { focus } : {}),
    };
  }
  return { mode: "LIST", invalid: mode !== null || employeeId !== null };
}

export interface PeriodUrlState {
  readonly version?: number;
  readonly focus?: PeriodFocus;
  readonly invalidVersion: boolean;
}

export function readPeriodUrl(params: ParamReader): PeriodUrlState {
  const raw = params.get("version");
  const version = raw !== null && /^\d{1,6}$/.test(raw) ? Number(raw) : null;
  return {
    ...(version !== null && isVersion(version) ? { version } : {}),
    ...(params.get("focus") === "export" ? { focus: "export" as const } : {}),
    invalidVersion: raw !== null && (version === null || !isVersion(version)),
  };
}

export function readSettingsSection(
  params: ParamReader,
): SettingsSection | null {
  const section = params.get("section");
  return (SETTINGS_SECTIONS as readonly string[]).includes(section ?? "")
    ? (section as SettingsSection)
    : null;
}

export const readDayFocus = (params: ParamReader): DayFocus | null =>
  params.get("focus") === "correction" ? "correction" : null;

export const hrDayPath = (businessDate: string) =>
  `${ROUTES.hrTime}/${encodeURIComponent(businessDate)}`;
export const hrPeriodPath = (periodId: string) =>
  `${ROUTES.hrPeriods}/${encodeURIComponent(periodId)}`;

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

/** The most specific navigation href containing the path, so parents stay inactive on child pages. */
export function activeNavigationHref(
  pathname: string,
  hrefs: readonly string[],
): string | undefined {
  return hrefs
    .filter((href) => isActivePath(pathname, href))
    .sort((a, b) => b.length - a.length)[0];
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
