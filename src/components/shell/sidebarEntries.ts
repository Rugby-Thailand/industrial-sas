import {
  Boxes,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardList,
  Clock,
  Megaphone,
  ReceiptText,
  Send,
  Settings,
  type LucideIcon,
} from "lucide-react";

import { ScanIcon } from "@/components/ui/ScanIcon";
import { ROUTES, type NavigationItem } from "@/lib/navigation";

// Sidebar presentation only: icons, submenu grouping and nested labels. The
// navigation registry, search and permission checks stay in `@/lib/navigation`.

/**
 * Icons of the destinations that sit directly in a section. Submenu members
 * render without an icon (their submenu carries one), so they need none. On
 * the icon rail an icon is all that tells two rows apart, so no two visible
 * rows share one.
 */
const NAVIGATION_ICONS: Readonly<Record<string, LucideIcon>> = Object.freeze({
  [ROUTES.finishedGoods]: Boxes,
  [ROUTES.jobScan]: ScanIcon,
  [ROUTES.jobScanRecords]: ClipboardList,
  [ROUTES.storageLayouts]: Building2,
  [ROUTES.hrRequests]: Send,
  [ROUTES.aiUsage]: ChartNoAxesCombined,
});

/** Inside a submenu the parent names the area, so some children read shorter. */
const NESTED_LABEL_KEYS: Readonly<Record<string, string>> = Object.freeze({
  [ROUTES.hrLeave]: "hrMyLeave",
  [ROUTES.hrAnnouncements]: "hrAnnouncementsFeed",
  [ROUTES.hrPayslips]: "hrMyPayslips",
});

export function navigationLabelKey(
  item: NavigationItem,
  nested: boolean,
): string {
  return (nested ? NESTED_LABEL_KEYS[item.href] : undefined) ?? item.labelKey;
}

const SIDEBAR_SUBMENUS: readonly {
  readonly labelKey: string;
  readonly Icon: LucideIcon;
  readonly hrefs: readonly string[];
}[] = [
  {
    labelKey: "hrAttendance",
    Icon: Clock,
    hrefs: [ROUTES.hrToday, ROUTES.hrTime, ROUTES.hrProfile],
  },
  {
    labelKey: "hrLeave",
    Icon: CalendarDays,
    hrefs: [ROUTES.hrLeave, ROUTES.hrLeaveReview, ROUTES.hrHolidays],
  },
  {
    labelKey: "hrAnnouncements",
    Icon: Megaphone,
    hrefs: [
      ROUTES.hrAnnouncements,
      ROUTES.hrAnnouncementsManage,
      ROUTES.hrNotifications,
    ],
  },
  {
    labelKey: "hrPayslips",
    Icon: ReceiptText,
    hrefs: [ROUTES.hrPayslips, ROUTES.hrPayslipImport],
  },
  {
    labelKey: "hrAdministration",
    Icon: Settings,
    hrefs: [
      ROUTES.hrReview,
      ROUTES.hrEmployees,
      ROUTES.hrPeriods,
      ROUTES.hrSettings,
    ],
  },
];

export type SidebarEntry =
  | {
      readonly kind: "link";
      readonly item: NavigationItem;
      readonly Icon: LucideIcon;
    }
  | {
      readonly kind: "submenu";
      readonly labelKey: string;
      readonly Icon: LucideIcon;
      readonly items: readonly NavigationItem[];
    };

/**
 * Arranges one section's already-permitted items for the sidebar, each with
 * its icon (a generic one when unmapped). A submenu
 * takes the place of its first permitted member and lists only permitted
 * members, in the submenu's own order; a group with none never appears.
 */
export function groupSidebarItems(
  items: readonly NavigationItem[],
): readonly SidebarEntry[] {
  const emitted = new Set<string>();
  return items.flatMap((item): SidebarEntry[] => {
    const group = SIDEBAR_SUBMENUS.find((entry) =>
      entry.hrefs.includes(item.href),
    );
    if (group === undefined) {
      return [
        { kind: "link", item, Icon: NAVIGATION_ICONS[item.href] ?? Boxes },
      ];
    }
    if (emitted.has(group.labelKey)) return [];
    emitted.add(group.labelKey);
    return [
      {
        kind: "submenu",
        labelKey: group.labelKey,
        Icon: group.Icon,
        items: group.hrefs.flatMap((href) =>
          items.filter((candidate) => candidate.href === href),
        ),
      },
    ];
  });
}
