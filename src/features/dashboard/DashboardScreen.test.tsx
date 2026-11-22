import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  configuredEnvironment,
  renderWithIntl,
} from "@tests/fixtures/intl-render";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import { trackAppHistory } from "@/lib/browser/appHistory";
import {
  MAX_QUICK_MENU_VERSION,
  ZERO_UNREAD_COUNTS,
} from "../../../convex/model/home/quickMenu";
import { DashboardScreen } from "./DashboardScreen";
import { readQuickMenuCommand, storeQuickMenuCommand } from "./quickMenuStore";

const mocks = vi.hoisted(() => ({
  activeOrg: "org-a",
  current: undefined as unknown,
  unread: undefined as unknown,
  calls: [] as { name: string; args: unknown }[],
  openMenus: vi.fn(),
  save: vi.fn(),
  verify: vi.fn(),
  auth: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, userId: "user-a", orgId: mocks.activeOrg }),
}));

vi.mock("convex/react", () => {
  const client = {
    query: mocks.verify,
    connectionState: () => ({ isWebSocketConnected: true }),
    subscribeToConnectionState: () => () => undefined,
  };
  return {
    useConvexAuth: () => {
      mocks.auth();
      return { isAuthenticated: true, isLoading: false };
    },
    useConvex: () => client,
    useMutation: () => mocks.save,
    useQuery_experimental: ({
      query,
      args,
    }: {
      query: Parameters<typeof getFunctionName>[0];
      args: unknown;
    }) => {
      if (args === "skip") return { status: "pending" };
      const name = getFunctionName(query);
      mocks.calls.push({ name, args });
      return name === "workspace/quickMenus:current"
        ? mocks.current
        : mocks.unread;
    },
  };
});

vi.mock("@/components/shell/useOpenAllMenus", () => ({
  useOpenAllMenus: () => mocks.openMenus,
}));

vi.mock("@/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => <a {...props} />,
  useRouter: () => ({
    back: () => window.history.back(),
    replace: mocks.replace,
  }),
}));

const HOME = "/en/dashboard?return=%20&tag=one&tag=two#home";
const ORIGIN = "/en/hr/today?date=2026-11-22#clock";
const clerkScope = { clerkOrgId: "org-a", clerkUserId: "user-a" };
const actorUserId = "actor-a";
const snapshot = {
  clerkScope,
  actorUserId,
  version: 2,
  maxVersion: MAX_QUICK_MENU_VERSION,
  customized: true,
  availableKeys: [
    "planner.finishedGoods",
    "hr.announcements",
    "hr.notifications",
  ],
  pinnedKeys: ["planner.finishedGoods", "hr.announcements", "hr.notifications"],
};
const current = (value = snapshot) => ({
  status: "success",
  data: { ok: true, value },
});
const unread = (count: number, total = count, scope = clerkScope) => ({
  status: "success",
  data: {
    ok: true,
    value: {
      clerkScope: scope,
      linked: true,
      counts: { ...ZERO_UNREAD_COUNTS, ANNOUNCEMENT_PUBLISHED: count },
      total,
    },
  },
});
const command = {
  requestId: "existing-command",
  expectedClerkScope: clerkScope,
  expectedActorUserId: actorUserId,
  expectedVersion: 2,
  pinnedKeys: ["hr.announcements"],
} as const;
const location = () =>
  window.location.pathname + window.location.search + window.location.hash;
const ui = () => (
  <NavigationGuardProvider>
    <DashboardScreen />
  </NavigationGuardProvider>
);
const renderHome = () =>
  renderWithIntl(ui(), {
    locale: "en",
    environment: configuredEnvironment,
    workspace: false,
    preserveProviders: true,
  });

let stop: (() => void) | undefined;
function startAtHome(origin?: string) {
  window.history.replaceState({ appNavigationIndex: 0 }, "", origin ?? HOME);
  stop = trackAppHistory();
  if (origin) window.history.pushState({}, "", HOME);
}
function openEditor() {
  fireEvent.click(screen.getByRole("button", { name: "Customize" }));
  return screen.findByRole("dialog", { name: "Customize quick menu" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activeOrg = "org-a";
  mocks.current = current();
  mocks.unread = unread(1, 100);
  mocks.calls = [];
  mocks.save.mockReset();
  mocks.verify.mockReset();
  localStorage.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  stop?.();
  stop = undefined;
  vi.unstubAllGlobals();
});

describe("Dashboard quick menus", () => {
  it("shows setup without starting Convex when the environment is unconfigured", () => {
    startAtHome();
    renderWithIntl(<DashboardScreen />, { locale: "en" });
    expect(screen.getByRole("heading", { name: "Home" })).toBeVisible();
    expect(screen.getByText("Home needs a connected workspace.")).toBeVisible();
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
  });

  it("shows only permitted tiles with reactive accessible unread badges", () => {
    startAtHome();
    mocks.current = current({
      ...snapshot,
      pinnedKeys: [...snapshot.pinnedKeys, "hr.payslips"],
    });
    const view = renderHome();
    expect(
      screen.getByRole("link", {
        name: "Announcements, 1 unread notification",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: "Notifications, More than 99 unread notifications",
      }),
    ).toHaveTextContent("99+");
    expect(
      screen.queryByRole("link", { name: /payslips/i }),
    ).not.toBeInTheDocument();
    mocks.unread = unread(0);
    view.rerender(ui());
    expect(
      screen.getByRole("link", { name: "Announcements" }),
    ).toHaveTextContent(/^Announcements$/);
    fireEvent.click(screen.getByRole("button", { name: "All menus" }));
    expect(mocks.openMenus).toHaveBeenCalledOnce();
  });

  it("retries failed unread counts and distinguishes loading from a successful zero", () => {
    startAtHome();
    mocks.unread = { status: "pending" };
    const view = renderHome();
    expect(screen.getByText("Loading unread counts…")).toBeVisible();
    expect(screen.getByRole("link", { name: "Announcements" })).toBeVisible();
    mocks.unread = { status: "error", error: new Error("Summary unavailable") };
    view.rerender(ui());
    expect(screen.getByText("Unread counts couldn’t load.")).toBeVisible();
    const failedArgs = mocks.calls.at(-1)?.args;
    fireEvent.click(
      screen.getByRole("button", { name: "Retry unread counts" }),
    );
    expect(mocks.calls.at(-1)?.args).not.toEqual(failedArgs);
    mocks.unread = unread(0);
    view.rerender(ui());
    expect(
      screen.getByRole("link", { name: "Announcements" }),
    ).toHaveTextContent(/^Announcements$/);
    expect(
      screen.queryByText("Loading unread counts…"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Unread counts couldn’t load."),
    ).not.toBeInTheDocument();
  });

  it("explicit Cancel consumes Customize before Back restores the exact origin", async () => {
    startAtHome(ORIGIN);
    renderHome();
    const editor = await openEditor();
    fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(location()).toBe(HOME));
    expect(
      screen.queryByRole("dialog", { name: "Customize quick menu" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(location()).toBe(ORIGIN));
  });

  it("native Back and Forward restore the clean Customize entry in the same visit", async () => {
    startAtHome(ORIGIN);
    renderHome();
    await openEditor();
    act(() => window.history.back());
    await waitFor(() => expect(location()).toBe(HOME));
    expect(
      screen.queryByRole("dialog", { name: "Customize quick menu" }),
    ).not.toBeInTheDocument();
    act(() => window.history.forward());
    expect(
      await screen.findByRole("dialog", { name: "Customize quick menu" }),
    ).toBeVisible();
  });

  it("remount removes an orphaned Customize entry while preserving the base URL", async () => {
    startAtHome(ORIGIN);
    const first = renderHome();
    await openEditor();
    first.unmount();
    renderHome();
    await waitFor(() => expect(location()).toBe(HOME));
    expect(
      screen.queryByRole("dialog", { name: "Customize quick menu" }),
    ).not.toBeInTheDocument();
    act(() => window.history.back());
    await waitFor(() => expect(location()).toBe(ORIGIN));
  });

  it("protects dirty Customize on native Back and closes on explicit discard", async () => {
    startAtHome(ORIGIN);
    renderHome();
    const editor = await openEditor();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Move Announcements up" }),
    );
    expect(
      within(editor).getByRole("button", { name: "Move Announcements down" }),
    ).toHaveFocus();
    act(() => window.history.back());
    const discard = await screen.findByRole("button", {
      name: "Discard changes",
    });
    fireEvent.click(discard);
    await waitFor(() => expect(location()).toBe(HOME));
    expect(
      screen.queryByRole("dialog", { name: "Customize quick menu" }),
    ).not.toBeInTheDocument();
    act(() => window.history.back());
    await waitFor(() => expect(location()).toBe(ORIGIN));
  });

  it("preserves the editor draft on read retry and retires it on access loss", async () => {
    startAtHome(ORIGIN);
    const view = renderHome();
    const editor = await openEditor();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Unpin Announcements" }),
    );
    mocks.current = { status: "error", error: new Error("Read failed") };
    view.rerender(ui());
    const failedRead = mocks.calls.at(-1)?.args;
    fireEvent.click(within(editor).getByRole("button", { name: "Retry" }));
    expect(mocks.calls.at(-1)?.args).not.toEqual(failedRead);
    expect(mocks.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "workspace/quickMenus:current",
          args: expect.objectContaining({
            readRetryAttempt: expect.any(Number),
          }),
        }),
      ]),
    );
    mocks.current = current();
    view.rerender(ui());
    expect(
      within(editor).getByRole("button", { name: "Pin Announcements" }),
    ).toBeEnabled();
    mocks.current = { status: "success", data: { ok: false } };
    view.rerender(ui());
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Customize quick menu" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(location()).toBe(HOME));
  });

  it("retires a revoked Customize entry without popping a newer foreground", async () => {
    startAtHome(ORIGIN);
    const page = (searchOpen: boolean) => (
      <NavigationGuardProvider>
        <DashboardScreen />
        {searchOpen && (
          <Dialog defaultOpen>
            <DialogContent>
              <DialogTitle>Search</DialogTitle>
              <DialogDescription>Search the workspace</DialogDescription>
            </DialogContent>
          </Dialog>
        )}
      </NavigationGuardProvider>
    );
    const view = renderWithIntl(page(false), {
      locale: "en",
      environment: configuredEnvironment,
      workspace: false,
      preserveProviders: true,
    });
    await openEditor();
    view.rerender(page(true));
    expect(screen.getByRole("dialog", { name: "Search" })).toBeVisible();
    const searchUrl = location();
    mocks.current = { status: "success", data: { ok: false } };
    view.rerender(page(true));
    expect(screen.getByRole("dialog", { name: "Search" })).toBeVisible();
    expect(location()).toBe(searchUrl);
    expect(
      screen.queryByRole("dialog", { name: "Customize quick menu" }),
    ).not.toBeInTheDocument();
    act(() => window.history.back());
    await waitFor(() => expect(location()).toBe(HOME));
    expect(
      screen.queryByRole("dialog", { name: "Search" }),
    ).not.toBeInTheDocument();
    act(() => window.history.back());
    await waitFor(() => expect(location()).toBe(ORIGIN));
  });

  it("holds pending Save through Back and consumes Customize when the live save completes", async () => {
    startAtHome(ORIGIN);
    let settle: (outcome: unknown) => void = () => undefined;
    mocks.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    renderHome();
    const editor = await openEditor();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Unpin Announcements" }),
    );
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(
      within(editor).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
    act(() => window.history.back());
    expect(
      await screen.findByRole("dialog", { name: "Customize quick menu" }),
    ).toBeVisible();
    await act(async () => {
      settle({ ok: true, value: { ok: true, version: 3 } });
    });
    await waitFor(() => expect(location()).toBe(HOME));
    expect(
      screen.queryByRole("dialog", { name: "Customize quick menu" }),
    ).not.toBeInTheDocument();
    expect(readQuickMenuCommand(clerkScope, actorUserId)).toBeNull();
  });

  it("checks a retained save by receipt at the version limit without mutating", async () => {
    startAtHome();
    const pending = { ...command, expectedVersion: MAX_QUICK_MENU_VERSION - 1 };
    storeQuickMenuCommand(pending);
    mocks.current = current({ ...snapshot, version: MAX_QUICK_MENU_VERSION });
    mocks.verify.mockResolvedValue({
      ok: true,
      value: { status: "NOT_FOUND" },
    });
    renderHome();
    const editor = await openEditor();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Check save status" }),
    );
    expect(await within(editor).findByText(/still unconfirmed/)).toBeVisible();
    expect(mocks.verify).toHaveBeenCalledWith(expect.anything(), pending);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(
      within(editor).queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    expect(readQuickMenuCommand(clerkScope, actorUserId)).toEqual(pending);

    mocks.verify.mockResolvedValue({
      ok: true,
      value: { status: "CONFIRMED" },
    });
    fireEvent.click(
      within(editor).getByRole("button", { name: "Check save status" }),
    );
    await waitFor(() =>
      expect(readQuickMenuCommand(clerkScope, actorUserId)).toBeNull(),
    );
  });

  it("keeps both the saved command and an independent draft when receipt access is denied", async () => {
    startAtHome();
    mocks.verify.mockResolvedValue({ ok: false });
    renderHome();
    const editor = await openEditor();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Unpin Announcements" }),
    );
    storeQuickMenuCommand(command);
    act(() => window.dispatchEvent(new StorageEvent("storage")));
    fireEvent.click(
      within(editor).getByRole("button", { name: "Check save status" }),
    );
    expect(
      await within(editor).findByText(
        "Couldn’t verify the save. You can check again.",
      ),
    ).toBeVisible();
    expect(readQuickMenuCommand(clerkScope, actorUserId)).toEqual(command);
    expect(mocks.save).not.toHaveBeenCalled();

    mocks.verify.mockResolvedValue({
      ok: true,
      value: { status: "CONFIRMED" },
    });
    fireEvent.click(
      within(editor).getByRole("button", { name: "Check save status" }),
    );
    await waitFor(() =>
      expect(readQuickMenuCommand(clerkScope, actorUserId)).toBeNull(),
    );
    expect(
      within(editor).getByRole("button", { name: "Pin Announcements" }),
    ).toBeVisible();
  });

  it("lets a member keep a newer menu after an older save has no receipt", async () => {
    startAtHome();
    storeQuickMenuCommand(command);
    mocks.current = current({
      ...snapshot,
      version: command.expectedVersion + 1,
    });
    mocks.verify.mockResolvedValue({
      ok: true,
      value: { status: "NOT_FOUND" },
    });
    renderHome();
    const editor = await openEditor();
    expect(
      within(editor).queryByRole("button", {
        name: "Keep the newer saved menu",
      }),
    ).toBeNull();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Check save status" }),
    );
    fireEvent.click(
      await within(editor).findByRole("button", {
        name: "Keep the newer saved menu",
      }),
    );
    expect(readQuickMenuCommand(clerkScope, actorUserId)).toBeNull();
    expect(
      within(editor).getByRole("button", { name: "Unpin Announcements" }),
    ).toBeEnabled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("uses the original command only after an explicit retry of an unconfirmed save", async () => {
    startAtHome();
    storeQuickMenuCommand(command);
    mocks.verify.mockResolvedValue({
      ok: true,
      value: { status: "NOT_FOUND" },
    });
    mocks.save.mockResolvedValue({ ok: true, value: { ok: true, version: 3 } });
    renderHome();
    const editor = await openEditor();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Check save status" }),
    );
    const resend = await within(editor).findByRole("button", {
      name: "Retry the same save",
    });
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(resend);
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledExactlyOnceWith(command),
    );
    await waitFor(() =>
      expect(readQuickMenuCommand(clerkScope, actorUserId)).toBeNull(),
    );
  });

  it("suppresses preferences and badge results from the wrong active Clerk scope", () => {
    startAtHome();
    mocks.unread = unread(5, 5, { ...clerkScope, clerkOrgId: "wrong" });
    const view = renderHome();
    expect(screen.getByRole("link", { name: "Announcements" })).toBeVisible();
    mocks.activeOrg = "org-b";
    view.rerender(ui());
    expect(
      screen.queryByRole("link", { name: /announcements/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Customize" })).toBeDisabled();
  });
});
