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
import { HrAnnouncementsScreen } from "./AnnouncementsScreen";
import { HrPayslipsScreen } from "./EmployeePayslipsScreen";
import { HrEmployeesScreen } from "./EmployeesScreen";
import { HrHistoryScreen } from "./HistoryScreen";
import { HrHolidaysScreen } from "./HolidaysScreen";
import { HrLeaveReviewScreen } from "./LeaveReviewScreen";
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

  it.each(SCREENS)(
    "%s opened directly goes to another visible HR page, never the planner root",
    (path, Screen) => {
      open(path, Screen);
      fireEvent.click(backButton()!);
      expect(state.back).not.toHaveBeenCalled();
      expect(state.replace).toHaveBeenCalledOnce();
      const [target] = state.replace.mock.calls[0] as [string];
      expect(target).toMatch(/^\/hr\//);
      expect(target).not.toBe(path);
    },
  );

  it("sends an HR-only member who opened Today directly to their next HR page", () => {
    state.access = ready([SELF]);
    open("/hr/today", HrTodayScreen);
    fireEvent.click(backButton()!);
    expect(state.replace).toHaveBeenCalledExactlyOnceWith("/hr/time");
  });

  it("returns a directly opened child page to its visible HR parent", () => {
    open("/hr/leave/review", HrLeaveReviewScreen);
    fireEvent.click(backButton()!);
    expect(state.replace).toHaveBeenCalledExactlyOnceWith("/hr/leave");
    vi.clearAllMocks();
    open("/hr/payslips/statement-1", () => <HrPayslipsScreen rowId="row-1" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Back" }).at(-1)!);
    expect(state.replace).toHaveBeenCalledExactlyOnceWith("/hr/payslips");
  });

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
