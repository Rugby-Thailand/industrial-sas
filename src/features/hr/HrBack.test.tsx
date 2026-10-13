import { fireEvent, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  access: {} as Record<string, unknown>,
}));

vi.mock("convex/react", () => ({
  // Every read is still loading: only the header is under test.
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
  useConvex: () => ({ query: vi.fn() }),
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    sessionId: "session",
    isSignedIn: true,
    getToken: vi.fn(),
  }),
  useReverification: (action: unknown) => action,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => window.location.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => state.access,
  useHrCan: (code: string) =>
    ((state.access.permissions as string[] | undefined) ?? []).includes(code),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: unknown }) => (
    <a href={href} {...props}>
      {children as never}
    </a>
  ),
  useRouter: () => ({
    push: vi.fn(),
    replace: state.replace,
    back: state.back,
  }),
  usePathname: () => window.location.pathname.replace(/^\/(en|th)/, ""),
}));

import { HrAnnouncementManageScreen } from "./AnnouncementManageScreen";
import {
  HrAnnouncementsScreen,
  HrAnnouncementDetailScreen,
} from "./AnnouncementsScreen";
import { HrPayslipsScreen } from "./EmployeePayslipsScreen";
import { HrEmployeesScreen } from "./EmployeesScreen";
import { HrHistoryScreen } from "./HistoryScreen";
import { HrHolidaysScreen } from "./HolidaysScreen";
import {
  HrLeaveReviewScreen,
  HrLeaveReviewDetailScreen,
} from "./LeaveReviewScreen";
import { HrLeaveDetailScreen } from "./LeaveDetailScreen";
import {
  HrFrozenPeriodsScreen,
  HrFrozenPeriodDetailScreen,
} from "./FrozenPeriodsScreen";
import { HrLeaveScreen } from "./LeaveScreen";
import { HrNotificationsScreen } from "./NotificationsScreen";
import { HrPayslipImportScreen } from "./PayslipImportScreen";
import { HrPeriodsScreen } from "./PeriodsScreen";
import { HrProfileScreen } from "./ProfileScreen";
import { HrRequestsScreen } from "./RequestsScreen";
import { HrReviewScreen } from "./ReviewScreen";
import { HrSettingsScreen } from "./SettingsScreen";
import { HrTodayScreen } from "./TodayScreen";

const SELF = "hr.self.access";
const ALL = [
  SELF,
  "hr.team.review",
  "hr.admin.manage",
  "hr.period.close",
  "hr.period.export",
];
const ready = (permissions: readonly string[]) => ({
  status: "READY",
  permissions,
  timezone: "Asia/Bangkok",
  timezoneSupported: true,
  today: "2026-10-12",
  identityKey: "org:user:employee",
  sites: [],
  sitesComplete: true,
});

/** Every HR feature page whose header used to suppress Back. */
const SCREENS: readonly (readonly [string, ComponentType])[] = [
  ["/hr/today", HrTodayScreen],
  ["/hr/time", HrHistoryScreen],
  ["/hr/requests", HrRequestsScreen],
  ["/hr/holidays", HrHolidaysScreen],
  ["/hr/leave", HrLeaveScreen],
  ["/hr/leave/review", HrLeaveReviewScreen],
  ["/hr/announcements", HrAnnouncementsScreen],
  ["/hr/announcements/manage", HrAnnouncementManageScreen],
  ["/hr/notifications", HrNotificationsScreen],
  ["/hr/payslips", HrPayslipsScreen],
  ["/hr/payslips/import", HrPayslipImportScreen],
  ["/hr/profile", HrProfileScreen],
  ["/hr/review", HrReviewScreen],
  ["/hr/employees", HrEmployeesScreen],
  ["/hr/periods", HrPeriodsScreen],
  ["/hr/settings", HrSettingsScreen],
  ["/hr/time/periods", HrFrozenPeriodsScreen],
  [
    "/hr/time/periods/version-1",
    () => <HrFrozenPeriodDetailScreen versionId="version-1" />,
  ],
  [
    "/hr/announcements/notice-1",
    () => <HrAnnouncementDetailScreen announcementId="notice-1" />,
  ],
  ["/hr/leave/request-1", () => <HrLeaveDetailScreen requestId="request-1" />],
  [
    "/hr/leave/review/request-1",
    () => <HrLeaveReviewDetailScreen requestId="request-1" />,
  ],
  ["/hr/payslips/statement-1", () => <HrPayslipsScreen rowId="statement-1" />],
];

function open(path: string, Screen: ComponentType, depth = 0) {
  window.history.replaceState(
    { __NA: true, appNavigationIndex: depth },
    "",
    `/en${path}`,
  );
  renderWithIntl(<Screen />, { locale: "en", workspace: false });
}
const backButton = () => screen.queryByRole("button", { name: "Back" });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  state.access = ready(ALL);
});

describe("HR page Back", () => {
  it.each(SCREENS)(
    "%s returns through app history when there is a previous page",
    (path, Screen) => {
      open(path, Screen, 2);
      fireEvent.click(backButton()!);
      expect(state.back).toHaveBeenCalledOnce();
      expect(state.replace).not.toHaveBeenCalled();
    },
  );

  it.each(
    SCREENS.filter(
      ([path]) =>
        ![
          "/hr/leave/review",
          "/hr/announcements/manage",
          "/hr/payslips/import",
          "/hr/time/periods",
          "/hr/time/periods/version-1",
          "/hr/announcements/notice-1",
          "/hr/leave/request-1",
          "/hr/leave/review/request-1",
          "/hr/payslips/statement-1",
        ].includes(path),
    ),
  )(
    "%s opened directly is a hub without a synthetic parent",
    (path, Screen) => {
      open(path, Screen);
      expect(backButton()).toBeNull();
      expect(state.replace).not.toHaveBeenCalled();
      expect(state.back).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["/hr/leave/review", HrLeaveReviewScreen, "/hr/leave"],
    [
      "/hr/announcements/manage",
      HrAnnouncementManageScreen,
      "/hr/announcements",
    ],
    ["/hr/payslips/import", HrPayslipImportScreen, "/hr/payslips"],
    ["/hr/time/periods", HrFrozenPeriodsScreen, "/hr/time"],
    [
      "/hr/time/periods/version-1",
      () => <HrFrozenPeriodDetailScreen versionId="version-1" />,
      "/hr/time/periods",
    ],
    [
      "/hr/announcements/notice-1",
      () => <HrAnnouncementDetailScreen announcementId="notice-1" />,
      "/hr/announcements",
    ],
    [
      "/hr/leave/request-1",
      () => <HrLeaveDetailScreen requestId="request-1" />,
      "/hr/leave",
    ],
    [
      "/hr/leave/review/request-1",
      () => <HrLeaveReviewDetailScreen requestId="request-1" />,
      "/hr/leave/review",
    ],
    [
      "/hr/payslips/statement-1",
      () => <HrPayslipsScreen rowId="statement-1" />,
      "/hr/payslips",
    ],
  ] as const)(
    "direct child %s uses its exact module parent",
    (path, Screen, parent) => {
      open(path, Screen);
      fireEvent.click(backButton()!);
      expect(state.replace).toHaveBeenCalledExactlyOnceWith(parent);
      expect(state.back).not.toHaveBeenCalled();
    },
  );

  it("disables Back on a directly opened page while HR access loads", () => {
    state.access = {
      status: "LOADING",
      permissions: [],
      timezoneSupported: true,
      sites: [],
    };
    open("/hr/today", HrTodayScreen);
    const button = backButton()!;
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(state.replace).not.toHaveBeenCalled();
    expect(state.back).not.toHaveBeenCalled();
  });

  it("keeps Back usable while access loads when there is app history", () => {
    state.access = {
      status: "LOADING",
      permissions: [],
      timezoneSupported: true,
      sites: [],
    };
    open("/hr/today", HrTodayScreen, 1);
    const button = backButton()!;
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(state.back).toHaveBeenCalledOnce();
  });

  it("hides Back on a directly opened page with no other HR destination", () => {
    state.access = { status: "NONE", permissions: [], sites: [] };
    open("/hr/today", HrTodayScreen);
    expect(backButton()).toBeNull();
  });
});
