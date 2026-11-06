import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  queries: new Map<string, (args: Record<string, unknown>) => unknown>(),
  queryCalls: [] as { name: string; args: unknown }[],
  action: vi.fn(),
  getToken: vi.fn(),
  auth: { userId: "user-a", orgId: "org-a" },
  oneShot: vi.fn(),
  push: vi.fn(),
  access: {} as Record<string, unknown>,
  workspace: {} as Record<string, unknown>,
  pathname: "/hr/today",
}));

vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) => {
      if (args === "skip") return undefined;
      const key = name(reference);
      state.queryCalls.push({ name: key, args });
      return state.queries.get(key)?.(args as Record<string, unknown>);
    },
    useConvex: () => ({ query: state.oneShot }),
  };
});
vi.mock("@/lib/ai/client", () => ({ interpretAiSearch: state.action }));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ ...state.auth, getToken: state.getToken }),
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => state.access,
}));
vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => state.workspace,
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: state.push, replace: vi.fn() }),
  usePathname: () => state.pathname,
}));

import { hrRefs } from "@/lib/convex/hrApi";
import { registerNavigationGuardOwner } from "@/lib/navigationGuard";

import {
  GlobalSearchProvider,
  useSearchControls,
} from "./GlobalSearchProvider";
import { usePageSearchContext } from "./pageContext";

const ref = (reference: Parameters<typeof getFunctionName>[0]) =>
  getFunctionName(reference);

function Opener({ mode = "SEARCH" }: { readonly mode?: "SEARCH" | "AI" }) {
  const controls = useSearchControls();
  return (
    <button type="button" onClick={() => controls?.open(mode)}>
      Open {mode}
    </button>
  );
}

function ReviewContext() {
  usePageSearchContext({
    page: "hr.review",
    employee: { id: "e3", code: "EMP-DEMO-003", name: "Somchai" },
    date: "2026-10-08",
  });
  return null;
}

function renderSearch(children = <Opener />, locale: "en" | "th" = "en") {
  return renderWithIntl(
    <GlobalSearchProvider>{children}</GlobalSearchProvider>,
    { locale },
  );
}

const input = () => screen.getByRole("combobox", { name: "Search" });
/** The one AI action for typed text: a list row, never a button (D14). */
const aiRow = (text?: string) =>
  screen.getByRole("option", {
    name:
      text === undefined
        ? /^Ask AI where to go for “/
        : `Ask AI where to go for “${text}”`,
  });
const type = async (text: string) => {
  fireEvent.change(input(), { target: { value: text } });
  // Debounced record search; menu results render after the pause too.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
};

const grounded = (fields: Record<string, unknown>) => ({
  kind: "OPEN_PAGE",
  page: null,
  settingsSection: null,
  employeeFocus: null,
  employee: null,
  date: null,
  period: null,
  dateProblem: null,
  dropped: [],
  clarify: null,
  unsupportedTopic: null,
  ...fields,
});

beforeEach(() => {
  // Recent destinations are remembered per member; each test starts fresh.
  window.localStorage.clear();
  state.queries.clear();
  state.queryCalls.length = 0;
  state.action.mockReset();
  state.getToken.mockReset().mockResolvedValue("cached-convex-token");
  state.auth = { userId: "user-a", orgId: "org-a" };
  state.oneShot.mockReset();
  state.push.mockReset();
  state.pathname = "/hr/today";
  state.access = {
    status: "READY",
    permissions: ["hr.self.access", "hr.team.review", "hr.admin.manage"],
    today: "2026-10-09",
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    employee: { code: "EMP-DEMO-010", displayName: "Lead" },
    sites: [],
    identityKey: "org-a:user-a",
  };
  state.workspace = {
    permissionsReady: false,
    navigationPermissions: [],
    denied: true,
    failed: false,
  };
});

describe("global search dialog", () => {
  it("opens with the shortcut, finds a section by Thai alias and opens it through the router", async () => {
    renderSearch();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(input()).toHaveFocus();
    // Nothing is queried before text is typed.
    expect(state.queryCalls).toEqual([]);
    await type("วันหยุด");
    const option = screen.getByRole("option", { name: /Holidays/ });
    // Its name first, then where it sits: the trail does not repeat the
    // title, and it describes the row rather than starting its name.
    expect(option).toHaveTextContent(/^HolidaysPeople › HR settings/);
    expect(option).toHaveAccessibleName("Holidays");
    expect(option).toHaveAccessibleDescription(/^People › HR settings/);
    expect(input()).toHaveAttribute("aria-activedescendant", option.id);
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() =>
      expect(state.push).toHaveBeenCalledWith("/hr/settings?section=holidays"),
    );
    expect(
      screen.getByText("Opening People › HR settings › Holidays"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("drops the generic Open page line but keeps specific actions", async () => {
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    await type("employee");
    const pages = screen.getAllByRole("option");
    expect(pages.length).toBeGreaterThan(1);
    expect(screen.getByRole("group", { name: "Tasks" })).toBeInTheDocument();
    for (const option of pages)
      expect(option).not.toHaveTextContent("Open page");
    await type("วันหยุด");
    expect(screen.getByRole("option", { name: /Holidays/ })).toHaveTextContent(
      "Open this section",
    );
  });

  it("centres its own close on the title row and returns focus to the opener", async () => {
    renderSearch();
    const opener = screen.getByRole("button", { name: "Open SEARCH" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    const close = screen.getAllByRole("button", { name: "Close search" });
    // One close, sharing a centred row with the title, not the corner.
    expect(close).toHaveLength(1);
    const row = close[0]!.parentElement!;
    expect(row).toHaveClass("items-center");
    expect(row).toContainElement(
      screen.getByRole("heading", { name: "Search" }),
    );
    expect(dialog).toContainElement(row);
    fireEvent.click(close[0]!);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(opener).toHaveFocus();
  });

  it("moves with arrows, ignores keys while an IME composes, clears on Escape and returns focus on the next Escape", async () => {
    renderSearch();
    const opener = screen.getByRole("button", { name: "Open SEARCH" });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole("dialog");
    await type("review");
    const options = screen
      .getAllByRole("option")
      .filter((option) => option.getAttribute("aria-disabled") !== "true");
    expect(options.length).toBeGreaterThan(1);
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input()).toHaveAttribute("aria-activedescendant", options[1]!.id);
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(input()).toHaveAttribute("aria-activedescendant", options[0]!.id);
    fireEvent.compositionStart(input());
    fireEvent.keyDown(input(), { key: "Enter", keyCode: 229 });
    expect(state.push).not.toHaveBeenCalled();
    // Escape drops the IME candidate: the text and the dialog stay.
    fireEvent.keyDown(input(), { key: "Escape", isComposing: true });
    expect(input()).toHaveValue("review");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.compositionEnd(input());
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(screen.getByTestId("global-search-keys")).toHaveTextContent(
      /Esc to clear$/,
    );

    // Escape with text clears it: the dialog stays, the box keeps focus, the
    // chosen row is forgotten and the places to go return.
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(input()).toHaveValue("");
    expect(input()).toHaveFocus();
    const places = within(
      screen.getByRole("group", { name: "Go to" }),
    ).getAllByRole("option");
    expect(input()).toHaveAttribute("aria-activedescendant", places[0]!.id);
    expect(screen.getByTestId("global-search-keys")).toHaveTextContent(
      /Esc to close$/,
    );

    // Escape on the empty box closes and returns focus to the opener.
    fireEvent.keyDown(input(), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(opener).toHaveFocus();
    expect(state.push).not.toHaveBeenCalled();
  });

  it("clears the text with its own button, keeping focus in the box", async () => {
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    // Nothing typed, nothing to clear; the placeholder keeps the full width.
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    expect(input()).toHaveClass("pr-3");

    await type("review");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    const clear = screen.getByRole("button", { name: "Clear search" });
    // Typed text stops short of the button, which is a full touch target.
    expect(input()).toHaveClass("pr-12");
    expect(clear).toHaveClass("min-h-touch", "min-w-touch");
    // A pointer press does not take focus from the box.
    expect(fireEvent.mouseDown(clear)).toBe(false);
    fireEvent.click(clear);

    expect(input()).toHaveValue("");
    expect(input()).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    const places = within(
      screen.getByRole("group", { name: "Go to" }),
    ).getAllByRole("option");
    expect(input()).toHaveAttribute("aria-activedescendant", places[0]!.id);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(state.push).not.toHaveBeenCalled();
  });

  it("finds an exact code through the reviewer search and builds the review link", async () => {
    state.queries.set(ref(hrRefs.searchReviewEmployees), () => ({
      ok: true,
      value: {
        complete: true,
        items: [
          {
            id: "e2",
            code: "EMP-DEMO-002",
            name: "Anan Wong",
            siteCode: "HQ",
            active: true,
            match: "CODE",
          },
        ],
      },
    }));
    state.queries.set(ref(hrRefs.searchAdminEmployees), () => ({
      ok: true,
      value: { complete: true, items: [] },
    }));
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    await type("ตรวจ EMP-DEMO-002 เมื่อวาน");
    expect(
      state.queryCalls.find(
        (call) => call.name === ref(hrRefs.searchReviewEmployees),
      )?.args,
    ).toEqual({ text: "", codes: ["EMP-DEMO-002"] });
    fireEvent.click(screen.getByRole("option", { name: /Anan Wong/ }));
    await waitFor(() =>
      expect(state.push).toHaveBeenCalledWith(
        "/hr/review?employee=e2&date=2026-10-08&focus=decision",
      ),
    );
  });

  it("says when record results are incomplete, and keeps menu results when records fail", async () => {
    state.queries.set(ref(hrRefs.searchReviewEmployees), () => ({
      ok: true,
      value: { complete: false, items: [] },
    }));
    state.queries.set(ref(hrRefs.searchAdminEmployees), () => {
      throw new Error("server unavailable");
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    await type("พนักงาน สมหญิง");
    expect(
      await screen.findByTestId("global-search-records-failed"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Employees/ }),
    ).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("does not navigate while an unsaved-work guard holds the transition", async () => {
    let held: (() => void) | undefined;
    const release = registerNavigationGuardOwner({
      requestTransition: (next, options) => {
        if (options?.preserveDraftScope) next();
        else held = next;
      },
      isTraversing: () => false,
    });
    try {
      renderSearch();
      fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
      await screen.findByRole("dialog");
      await type("holidays");
      fireEvent.keyDown(input(), { key: "Enter" });
      expect(state.push).not.toHaveBeenCalled();
      await waitFor(() => expect(held).toBeDefined());
      release();
      act(() => held?.());
      await waitFor(() =>
        expect(state.push).toHaveBeenCalledWith(
          "/hr/settings?section=holidays",
        ),
      );
    } finally {
      release();
    }
  });

  it("hides AI Search from members without HR access", async () => {
    state.access = { status: "NONE", permissions: [], sites: [] };
    state.workspace = {
      permissionsReady: true,
      navigationPermissions: ["masterData.storageLayout.read"],
    };
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    expect(
      screen.queryByTestId("global-search-ai-disclosure"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("global-search-group-ask")).toBeNull();
    await type("scan");
    expect(
      screen.getByRole("option", { name: /Scan job tickets/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("global-search-ai")).toBeNull();
    expect(screen.queryByRole("option", { name: /Ask AI/ })).toBeNull();
    expect(
      screen.queryByRole("option", { name: /Review/ }),
    ).not.toBeInTheDocument();
  });
});

describe("AI Search", () => {
  it("offers AI through its examples on an empty box and as one row once text is typed, sending nothing before it is chosen", async () => {
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    // D16 restores a short disclosure at the AI entry, not a separate panel.
    expect(screen.queryByTestId("global-search-ai-disclosure")).toBeNull();
    expect(screen.queryByText(/No records are sent/)).toBeNull();
    // Nothing to ask about yet: the examples are the AI entry (D14).
    expect(screen.queryByTestId("global-search-ai")).toBeNull();
    // The examples say what the AI is for: it finds pages and forms, it is
    // not a general chatbot.
    const scope =
      "AI takes you to pages and forms for time, leave, requests and employees.";
    const privacy =
      "When you choose AI, your search text is sent to the AI provider to find relevant pages.";
    const examples = screen.getByRole("group", { name: "Ask AI where to go" });
    expect(
      within(examples).getByTestId("global-search-ask-scope"),
    ).toHaveTextContent(scope);
    expect(examples).toHaveTextContent(privacy);
    expect(examples).toHaveAccessibleDescription(`${scope} ${privacy}`);

    // Two characters bring one row that asks about them, carrying the
    // scope; there is no Ask AI button at any width.
    fireEvent.change(input(), { target: { value: "l" } });
    expect(screen.queryByTestId("global-search-ai")).toBeNull();
    fireEvent.change(input(), { target: { value: "leave" } });
    expect(aiRow("leave")).toHaveAttribute("data-testid", "global-search-ai");
    expect(aiRow("leave")).toHaveAccessibleDescription(`${scope} ${privacy}`);
    expect(
      within(aiRow("leave")).getByTestId("global-search-ai-privacy"),
    ).toHaveTextContent(privacy);
    expect(screen.queryByRole("button", { name: /Ask AI/ })).toBeNull();
    expect(
      screen.queryByTestId("global-search-ai-panel"),
    ).not.toBeInTheDocument();
    expect(state.action).not.toHaveBeenCalled();
  });

  it("offers places to go and AI examples before anything is typed", async () => {
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    const goTo = screen.getByRole("group", { name: "Go to" });
    const places = within(goTo).getAllByRole("option");
    // The member's own module first, without the page already open.
    expect(places.map((option) => option.textContent)).toEqual([
      "Attendance historyPeople",
      "My requestsPeople",
      "Company holidaysPeople",
      "LeavePeople",
      "Review leavePeople",
      "AnnouncementsPeople",
    ]);
    expect(input()).toHaveAttribute("aria-activedescendant", places[0]!.id);
    const examples = within(
      screen.getByRole("group", { name: "Ask AI where to go" }),
    ).getAllByRole("option");
    // "This record" needs a page context; there is none here.
    expect(examples.map((option) => option.textContent)).toEqual([
      "Forgot to clock in yesterday",
      "Set up holidays",
    ]);
    expect(screen.getByTestId("global-search-keys")).toHaveTextContent(
      "↑ ↓ to choose · Enter to open · Esc to close",
    );
    // Nothing is queried for the suggestions.
    expect(state.queryCalls).toEqual([]);
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(state.push).toHaveBeenCalledWith("/hr/time"));
  });

  it("puts the current module's places first and hides suggestions once typing starts", async () => {
    state.pathname = "/finished-goods/scan";
    state.workspace = {
      permissionsReady: true,
      navigationPermissions: ["masterData.storageLayout.read"],
    };
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    const places = within(
      screen.getByRole("group", { name: "Go to" }),
    ).getAllByRole("option");
    expect(places.map((option) => option.textContent)).toEqual([
      "Finished goodsWarehouse",
      "Scanned recordsWarehouse",
      "Buildings & spotsWarehouse",
      "TodayPeople",
      "Attendance historyPeople",
      "My requestsPeople",
    ]);
    fireEvent.change(input(), { target: { value: "s" } });
    expect(screen.queryByRole("group", { name: "Go to" })).toBeNull();
    expect(
      screen.queryByRole("group", { name: "Ask AI where to go" }),
    ).toBeNull();
  });

  it("asks an example at once when it is chosen, keeping focus in the box", async () => {
    state.action.mockResolvedValue({
      ok: true,
      value: {
        ok: true,
        today: "2026-10-09",
        intent: grounded({ kind: "CLARIFY", clarify: "TASK" }),
      },
    });
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("option", { name: "Set up holidays" }));
    expect(input()).toHaveValue("Set up holidays");
    expect(input()).toHaveFocus();
    expect(screen.getByRole("heading", { name: "AI Search" })).toBeVisible();
    await waitFor(() => expect(state.action).toHaveBeenCalledTimes(1));
    // The AI receives the example as shown, in the page's language.
    expect(state.action.mock.calls[0]![0].query).toBe("Set up holidays");
    expect(
      await screen.findByText("What would you like to do? Try one of these."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Ask AI where to go" }),
    ).toBeNull();

    // Cleared in AI mode: the examples lead, reachable with the arrows.
    fireEvent.change(input(), { target: { value: "" } });
    const first = within(
      screen.getByRole("group", { name: "Ask AI where to go" }),
    ).getAllByRole("option")[0]!;
    expect(input()).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(input()).toHaveAttribute("aria-activedescendant", first.id);
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(state.action).toHaveBeenCalledTimes(2));
    expect(state.action.mock.calls[1]![0].query).toBe(
      "Forgot to clock in yesterday",
    );
  });

  it("offers and asks the examples in Thai on a Thai page", async () => {
    state.action.mockResolvedValue({
      ok: true,
      value: {
        ok: true,
        today: "2026-10-09",
        intent: grounded({ kind: "CLARIFY", clarify: "TASK" }),
      },
    });
    renderSearch(<Opener />, "th");
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("option", { name: "ตั้งวันหยุด" }));
    await waitFor(() => expect(state.action).toHaveBeenCalledTimes(1));
    expect(state.action.mock.calls[0]![0].query).toBe("ตั้งวันหยุด");
  });

  it("offers the review example only while a page names the record", async () => {
    renderSearch(
      <>
        <Opener />
        <ReviewContext />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    expect(
      within(screen.getByRole("group", { name: "Ask AI where to go" }))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Forgot to clock in yesterday",
      "Review this record's correction request",
      "Set up holidays",
    ]);
  });

  it("lists AI page suggestions without a generic Open page line", async () => {
    state.action.mockResolvedValue({
      ok: true,
      value: {
        ok: true,
        today: "2026-10-09",
        intent: grounded({ kind: "CLARIFY", clarify: "TASK" }),
      },
    });
    renderSearch(<Opener mode="AI" />);
    fireEvent.click(screen.getByRole("button", { name: "Open AI" }));
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "fix this one" } });
    fireEvent.click(aiRow());
    const group = await screen.findByRole("group", { name: "AI suggestions" });
    const suggestions = within(group).getAllByRole("option");
    expect(suggestions.length).toBeGreaterThan(0);
    for (const option of suggestions)
      expect(option).not.toHaveTextContent("Open page");
    expect(state.action).toHaveBeenCalledTimes(1);
  });

  it("shows and clears the page context, sending only flags", async () => {
    state.action.mockResolvedValue({
      ok: true,
      value: {
        ok: true,
        today: "2026-10-09",
        intent: grounded({ kind: "CLARIFY", clarify: "TASK" }),
      },
    });
    renderSearch(
      <>
        <Opener mode="AI" />
        <ReviewContext />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open AI" }));
    await screen.findByRole("dialog");
    expect(screen.getByTestId("global-search-context")).toHaveTextContent(
      "Using: People › Review › EMP-DEMO-003 › 8 Oct 2026",
    );
    fireEvent.change(input(), { target: { value: "fix this one" } });
    fireEvent.click(aiRow());
    await waitFor(() => expect(state.action).toHaveBeenCalledTimes(1));
    expect(state.action.mock.calls[0]![0]).toEqual({
      query: "fix this one",
      context: { page: "hr.review", employee: true, date: true, period: false },
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear context" }));
    expect(
      screen.queryByTestId("global-search-context"),
    ).not.toBeInTheDocument();
    fireEvent.click(aiRow());
    await waitFor(() => expect(state.action).toHaveBeenCalledTimes(2));
    expect(state.action.mock.calls[1]![0].context).toEqual({
      page: null,
      employee: false,
      date: false,
      period: false,
    });
  });

  it("opens an exact, verified destination and never one the model invented", async () => {
    state.action.mockResolvedValue({
      ok: true,
      value: {
        ok: true,
        today: "2026-10-09",
        intent: grounded({
          kind: "TEAM_DAY_REVIEW",
          employee: {
            ref: "CODE",
            code: "EMP-DEMO-002",
            codes: ["EMP-DEMO-002"],
          },
          date: { ref: "DATE", date: "2026-10-08", inferredYear: false },
        }),
      },
    });
    state.oneShot.mockResolvedValue({
      ok: true,
      value: {
        complete: true,
        items: [
          {
            id: "e2",
            code: "EMP-DEMO-002",
            name: "Anan Wong",
            siteCode: "HQ",
            active: true,
            match: "CODE",
          },
        ],
      },
    });
    renderSearch(<Opener mode="AI" />);
    fireEvent.click(screen.getByRole("button", { name: "Open AI" }));
    await screen.findByRole("dialog");
    fireEvent.change(input(), {
      target: { value: "ตรวจคำขอ EMP-DEMO-002 วันที่ 8 ต.ค. 2569" },
    });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() =>
      expect(state.push).toHaveBeenCalledWith(
        "/hr/review?employee=e2&date=2026-10-08&focus=decision",
      ),
    );
    // Exact code only: no name comparison for an AI code reference.
    expect(state.oneShot.mock.calls[0]![1]).toEqual({
      text: "",
      codes: ["EMP-DEMO-002"],
    });
  });

  it("asks the user to choose for a name, and keeps normal search when AI is unavailable", async () => {
    state.action.mockResolvedValueOnce({
      ok: true,
      value: {
        ok: true,
        today: "2026-10-09",
        intent: grounded({
          kind: "TEAM_DAY_REVIEW",
          employee: { ref: "NAME", name: "สมชาย" },
          date: { ref: "DATE", date: "2026-10-08", inferredYear: false },
        }),
      },
    });
    state.oneShot.mockResolvedValue({
      ok: true,
      value: {
        complete: true,
        items: [
          {
            id: "e3",
            code: "EMP-DEMO-003",
            name: "สมชาย ใจดี",
            siteCode: "HQ",
            active: true,
            match: "PARTIAL",
          },
          {
            id: "e4",
            code: "EMP-DEMO-004",
            name: "สมชาย รักงาน",
            siteCode: "HQ",
            active: true,
            match: "PARTIAL",
          },
        ],
      },
    });
    renderSearch(<Opener mode="AI" />);
    fireEvent.click(screen.getByRole("button", { name: "Open AI" }));
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "แก้เวลาสมชาย เมื่อวาน" } });
    fireEvent.click(aiRow());
    expect(
      await screen.findByText(
        "Choose the person. A name alone never opens a record.",
      ),
    ).toBeInTheDocument();
    expect(state.push).not.toHaveBeenCalled();
    const choices = screen.getAllByRole("option", { name: /สมชาย/ });
    expect(choices.length).toBeGreaterThanOrEqual(2);

    state.action.mockResolvedValueOnce({
      ok: true,
      value: { ok: false, code: "AI_UNAVAILABLE" },
    });
    fireEvent.change(input(), { target: { value: "ตั้งวันหยุด" } });
    fireEvent.click(aiRow());
    expect(
      await screen.findByTestId("global-search-ai-error"),
    ).toHaveTextContent("Normal search still works");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(
      screen.getByRole("option", { name: /Holidays/ }),
    ).toBeInTheDocument();
  });

  it("discards a late answer after the query changes", async () => {
    let resolve: (value: unknown) => void = () => {};
    state.action.mockReturnValue(new Promise((done) => (resolve = done)));
    renderSearch(<Opener mode="AI" />);
    fireEvent.click(screen.getByRole("button", { name: "Open AI" }));
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "ตั้งวันหยุด" } });
    fireEvent.click(aiRow());
    expect(
      await screen.findByText("AI is reading your request…"),
    ).toBeInTheDocument();
    fireEvent.change(input(), { target: { value: "ตั้งวันหยุดใหม่" } });
    await act(async () => {
      resolve({
        ok: true,
        value: {
          ok: true,
          today: "2026-10-09",
          intent: grounded({
            kind: "HR_SETTINGS_SECTION",
            settingsSection: "holidays",
          }),
        },
      });
    });
    expect(state.push).not.toHaveBeenCalled();
  });

  it("reports the rate limit with the wait time", async () => {
    state.action.mockResolvedValue({
      ok: true,
      value: { ok: false, code: "RATE_LIMITED", retryAfterMs: 125_000 },
    });
    renderSearch(<Opener mode="AI" />);
    fireEvent.click(screen.getByRole("button", { name: "Open AI" }));
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "ลืมลงเวลา" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(
      await screen.findByTestId("global-search-ai-error"),
    ).toHaveTextContent("Try again in 3 min");
  });
});

const hit = (
  id: string,
  code: string,
  name: string,
  match = "CODE",
): Record<string, unknown> => ({
  id,
  code,
  name,
  siteCode: "HQ",
  active: true,
  match,
});
const found = (...items: Record<string, unknown>[]) => ({
  ok: true,
  value: { complete: true, items },
});
const flush = async (ms = 0) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};

describe("record results lifecycle", () => {
  it("preserves match rank and code order after merging overlapping review and admin hits", async () => {
    const first = hit("e1", "EMP-DEMO-001", "First", "CODE_PREFIX");
    const second = hit("e2", "EMP-DEMO-002", "Second", "CODE_PREFIX");
    const third = hit("e3", "EMP-DEMO-003", "Third", "CODE_PREFIX");
    const exactName = hit("e4", "ZZZ-004", "EMP", "NAME");
    state.queries.set(ref(hrRefs.searchReviewEmployees), () =>
      found(second, third),
    );
    state.queries.set(ref(hrRefs.searchAdminEmployees), () =>
      found(exactName, first, second, third),
    );
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    await type("EMP");
    const employees = within(
      screen.getByRole("group", { name: "Employees" }),
    ).getAllByRole("option");
    expect(
      employees.map((row) => row.querySelector('[id$="-title"]')?.textContent),
    ).toEqual(["EMP", "First", "Second", "Third"]);
    fireEvent.click(employees[1]!);
    await waitFor(() =>
      expect(state.push).toHaveBeenCalledWith(
        "/hr/employees?employee=e1&mode=edit&focus=details",
      ),
    );
  });

  it("settles when every render returns a fresh but identical outcome", async () => {
    // A new object per call, like a protected query re-delivering the same
    // answer: publication must be idempotent, not loop.
    state.queries.set(ref(hrRefs.searchReviewEmployees), () =>
      found(hit("e2", "EMP-DEMO-002", "Anan Wong")),
    );
    state.queries.set(ref(hrRefs.searchAdminEmployees), () => found());
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    await type("ตรวจ EMP-DEMO-002 เมื่อวาน");
    expect(screen.getByRole("option", { name: /Anan Wong/ })).toBeVisible();
    const calls = state.queryCalls.length;
    await flush(100);
    // No further renders without new input.
    expect(state.queryCalls.length).toBe(calls);
    expect(calls).toBeLessThan(40);
  });

  it("drops record results when the account changes with the same text and grants", async () => {
    let answer: unknown = found(hit("e2", "EMP-DEMO-002", "Anan Wong"));
    state.queries.set(ref(hrRefs.searchReviewEmployees), () => answer);
    state.queries.set(ref(hrRefs.searchAdminEmployees), () =>
      answer === undefined ? undefined : found(),
    );
    // A fresh element each time, so rerender really renders the shell again.
    const tree = () => (
      <GlobalSearchProvider>
        <Opener />
      </GlobalSearchProvider>
    );
    const view = renderWithIntl(tree(), {
      locale: "en",
      preserveProviders: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    await type("EMP-DEMO-002 yesterday");
    expect(screen.getByRole("option", { name: /Anan Wong/ })).toBeVisible();

    // Another organization or account, same grants and text; its answer is
    // still loading. Nothing of the previous account stays visible or opens.
    answer = undefined;
    state.access = { ...state.access, identityKey: "org-b:user-b" };
    view.rerender(tree());
    expect(
      screen.queryByRole("option", { name: /Anan Wong/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Searching records…|still searching records/),
    ).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(state.push).not.toHaveBeenCalled();
  });

  it("never opens the previous query's result while new text is unsettled", async () => {
    state.queries.set(ref(hrRefs.searchReviewEmployees), (args) =>
      found(
        ...((args.codes as string[] | undefined)?.includes("EMP-DEMO-002")
          ? [hit("e2", "EMP-DEMO-002", "Anan Wong")]
          : [hit("e3", "EMP-DEMO-003", "Somchai")]),
      ),
    );
    state.queries.set(ref(hrRefs.searchAdminEmployees), () => found());
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    await type("EMP-DEMO-002 yesterday");
    const old = screen.getByRole("option", { name: /Anan Wong/ });

    // Type another person and press Enter before the pause ends.
    fireEvent.change(input(), { target: { value: "EMP-DEMO-003 yesterday" } });
    expect(old).toHaveAttribute("aria-disabled", "true");
    expect(input()).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.click(old);
    expect(state.push).not.toHaveBeenCalled();

    // While an IME composes, results are not openable either.
    await flush(300);
    fireEvent.compositionStart(input());
    fireEvent.click(screen.getByRole("option", { name: /Somchai/ }));
    expect(state.push).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input(), {
      target: { value: "EMP-DEMO-003 yesterday" },
    });
    await flush(300);
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() =>
      expect(state.push).toHaveBeenCalledWith(
        "/hr/review?employee=e3&date=2026-10-08&focus=decision",
      ),
    );
  });

  it.each([
    [
      "incomplete",
      () => ({ ok: true, value: { complete: false, items: [] } }),
      "not every record could be searched",
    ],
    ["denied", () => ({ ok: false }), "records could not be searched"],
    [
      "failed",
      () => {
        throw new Error("server unavailable");
      },
      "records could not be searched",
    ],
  ])(
    "does not announce a definitive no-match when the record search is %s",
    async (_kind, outcome, message) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      state.queries.set(ref(hrRefs.searchReviewEmployees), outcome);
      state.queries.set(ref(hrRefs.searchAdminEmployees), outcome);
      renderSearch();
      fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
      await screen.findByRole("dialog");
      await type("ซซซซซ");
      const status = screen
        .getAllByRole("status")
        .find((node) => node.textContent !== "")!;
      expect(status.textContent?.toLowerCase()).toContain(message);
      expect(status).not.toHaveTextContent("No matching pages or records.");
      // Scope-neutral: nothing about whose records exist.
      expect(status.textContent).not.toMatch(/permission|access|exist/i);
      consoleError.mockRestore();
    },
  );

  it("says no match only when every record search answered completely", async () => {
    state.queries.set(ref(hrRefs.searchReviewEmployees), () => found());
    state.queries.set(ref(hrRefs.searchAdminEmployees), () => found());
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    await type("ซซซซซ");
    expect(
      screen.getByText("No matching pages or records."),
    ).toBeInTheDocument();
  });
});

describe("normal search tasks and periods", () => {
  it("offers a labelled own-day link, but not when the text names someone else", async () => {
    state.queries.set(ref(hrRefs.searchReviewEmployees), () =>
      found(hit("e2", "EMP-DEMO-002", "Anan Wong")),
    );
    state.queries.set(ref(hrRefs.searchAdminEmployees), () => found());
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    await type("ลืมลงเวลาเมื่อวาน");
    const own = screen.getByRole("option", { name: /Correct my time/ });
    expect(own).toHaveTextContent("Your own attendance");

    await type("ลืมลงเวลา EMP-DEMO-002 เมื่อวาน");
    expect(
      screen.queryByRole("option", { name: /Correct my time/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Anan Wong/ })).toBeVisible();
    await type("ลืมลงเวลาสมชายเมื่อวาน");
    expect(
      screen.queryByRole("option", { name: /Correct my time/ }),
    ).not.toBeInTheDocument();
  });

  it("opens the version written in the text and never falls back to the latest", async () => {
    state.access = {
      ...state.access,
      permissions: ["hr.period.close", "hr.period.export"],
    };
    state.queries.set(ref(hrRefs.searchPeriodsByRange), () => ({
      ok: true,
      value: { complete: true, items: [closedPeriod] },
    }));
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    await type("ส่งออกงวด 2026-09-19 to 2026-09-25 ฉบับ 9");
    const missing = screen.getByRole("option", { name: /19 Sept|19 Sep/ });
    expect(screen.getByRole("group", { name: "Periods" })).toContainElement(
      missing,
    );
    expect(missing).toHaveAttribute("aria-disabled", "true");
    expect(missing).toHaveTextContent(
      "Version 9 is not available for this period.",
    );
    // A disabled row keeps the period's real state; it never claims v9.
    expect(missing).toHaveTextContent("HQ · Closed, version 4");
    expect(missing).not.toHaveTextContent("Closed, version 9");
    fireEvent.click(missing);
    expect(state.push).not.toHaveBeenCalled();

    await type("ส่งออกงวด 2026-09-19 to 2026-09-25 ฉบับ abc");
    const unreadable = screen.getByRole("option", { name: /19 Sept|19 Sep/ });
    expect(unreadable).toHaveAttribute("aria-disabled", "true");
    expect(unreadable).toHaveTextContent(
      "That version could not be read. Write it as “v1” or “ฉบับ 1”.",
    );
    expect(unreadable).toHaveTextContent("HQ · Closed, version 4");
    fireEvent.click(unreadable);
    expect(state.push).not.toHaveBeenCalled();

    // No version written: the row names the latest it opens.
    await type("ส่งออกงวด 2026-09-19 to 2026-09-25");
    expect(
      screen.getByRole("option", { description: /Go to export/ }),
    ).toHaveTextContent("HQ · Closed, version 4");

    // Native finding: the latest is v4, the text asks for v1. The row must
    // name the version it opens, not the latest.
    await type("ส่งออกงวด 19–25 ก.ย. 2569 ฉบับ 1");
    const first = screen.getByRole("option", { description: /Go to export/ });
    expect(first).not.toHaveAttribute("aria-disabled");
    expect(first).toHaveTextContent("HQ · Closed, version 1");
    expect(first).not.toHaveTextContent("version 4");
    fireEvent.click(first);
    await waitFor(() =>
      expect(state.push).toHaveBeenCalledWith(
        "/hr/periods/p1?version=1&focus=export",
      ),
    );
  });

  it("names the requested version on an AI period choice", async () => {
    state.access = {
      ...state.access,
      permissions: ["hr.self.access", "hr.period.close", "hr.period.export"],
    };
    // An inferred year always asks, so the choice row is what opens.
    state.action.mockResolvedValue({
      ok: true,
      value: {
        ok: true,
        today: "2026-10-09",
        intent: grounded({
          kind: "PERIOD_EXPORT",
          date: {
            ref: "RANGE",
            from: "2026-09-19",
            to: "2026-09-25",
            inferredYear: true,
          },
          version: { kind: "ONE", version: 1 },
        }),
      },
    });
    state.oneShot.mockResolvedValue({
      ok: true,
      value: { complete: true, items: [closedPeriod] },
    });
    renderSearch(<Opener mode="AI" />);
    fireEvent.click(screen.getByRole("button", { name: "Open AI" }));
    await screen.findByRole("dialog");
    await type("ส่งออกงวดนั้น ฉบับ 1");
    fireEvent.click(aiRow());
    const choice = await screen.findByRole("option", {
      description: /Go to export/,
    });
    expect(choice).not.toHaveAttribute("aria-disabled");
    expect(choice).toHaveTextContent("HQ · Closed, version 1");
    expect(choice).not.toHaveTextContent("version 4");
    expect(state.push).not.toHaveBeenCalled();
    fireEvent.click(choice);
    await waitFor(() =>
      expect(state.push).toHaveBeenCalledWith(
        "/hr/periods/p1?version=1&focus=export",
      ),
    );
  });
});

const closedPeriod = {
  id: "p1",
  siteCode: "HQ",
  siteName: "Head office",
  startDate: "2026-09-19",
  endDate: "2026-09-25",
  status: "CLOSED",
  latestClosedVersion: 4,
};

describe("AI Search lifecycle", () => {
  const settingsAnswer = {
    ok: true,
    value: {
      ok: true,
      today: "2026-10-09",
      intent: grounded({
        kind: "HR_SETTINGS_SECTION",
        settingsSection: "holidays",
      }),
    },
  };
  const pending = () => {
    let resolve: (value: unknown) => void = () => {};
    state.action.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    return (value: unknown) => act(async () => resolve(value));
  };
  const startAi = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Open AI" }));
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "ตั้งวันหยุด" } });
    fireEvent.click(aiRow());
    expect(
      await screen.findByText("AI is reading your request…"),
    ).toBeInTheDocument();
  };

  it("uses cached Clerk tokens for the captured organization", async () => {
    state.action.mockResolvedValue(settingsAnswer);
    renderSearch(<Opener mode="AI" />);
    fireEvent.click(screen.getByRole("button", { name: "Open AI" }));
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "ตั้งวันหยุด" } });
    fireEvent.click(aiRow());
    await waitFor(() => expect(state.action).toHaveBeenCalledTimes(1));
    expect(state.getToken).toHaveBeenCalledWith({ organizationId: "org-a" });
    expect(state.getToken).toHaveBeenCalledWith({
      template: "convex",
      organizationId: "org-a",
    });
    expect(state.action.mock.calls[0]?.[1]).toEqual({
      session: "cached-convex-token",
      convex: "cached-convex-token",
    });
  });

  it("refuses missing tokens before sending an HTTP request", async () => {
    state.getToken.mockResolvedValue(null);
    renderSearch(<Opener mode="AI" />);
    fireEvent.click(screen.getByRole("button", { name: "Open AI" }));
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "ตั้งวันหยุด" } });
    fireEvent.click(aiRow());
    expect(await screen.findByTestId("global-search-ai-error")).toBeVisible();
    expect(state.action).not.toHaveBeenCalled();
  });

  it.each(["close", "organization"] as const)(
    "discards pending token acquisition after %s changes",
    async (change) => {
      let resolve: (value: string) => void = () => {};
      state.getToken.mockReturnValue(
        new Promise<string>((done) => {
          resolve = done;
        }),
      );
      const view = renderWithIntl(
        <GlobalSearchProvider>
          <Opener mode="AI" />
        </GlobalSearchProvider>,
        { locale: "en", preserveProviders: true },
      );
      await startAi();
      if (change === "close") {
        // Escape would clear the text first; the close button closes.
        fireEvent.click(screen.getByRole("button", { name: "Close search" }));
        await waitFor(() =>
          expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
        );
      } else {
        // Clerk changes immediately, before Convex updates HrAccessProvider.
        state.auth = { userId: "user-a", orgId: "org-b" };
        view.rerender(
          <GlobalSearchProvider>
            <Opener mode="AI" />
          </GlobalSearchProvider>,
        );
      }
      await act(async () => resolve("late-token"));
      expect(state.action).not.toHaveBeenCalled();
      expect(state.push).not.toHaveBeenCalled();
    },
  );

  it("ignores a late answer after the dialog closes and reopens", async () => {
    const resolve = pending();
    renderSearch(<Opener mode="AI" />);
    await startAi();
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open AI" }));
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "ตั้งวันหยุด" } });
    await resolve(settingsAnswer);
    expect(state.push).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("global-search-ai-outcome"),
    ).not.toBeInTheDocument();
  });

  it("drops a running request when Escape clears its text", async () => {
    const resolve = pending();
    renderSearch(<Opener mode="AI" />);
    await startAi();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(input()).toHaveValue("");
    expect(input()).toHaveFocus();
    expect(screen.queryByText("AI is reading your request…")).toBeNull();
    // The same text typed again does not bring the old answer back.
    fireEvent.change(input(), { target: { value: "ตั้งวันหยุด" } });
    await resolve(settingsAnswer);
    expect(state.push).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("global-search-ai-outcome"),
    ).not.toBeInTheDocument();
  });

  it("ignores a late answer after the search shell unmounts", async () => {
    const resolve = pending();
    const view = renderSearch(<Opener mode="AI" />);
    await startAi();
    view.unmount();
    await resolve(settingsAnswer);
    expect(state.push).not.toHaveBeenCalled();
  });

  it("ignores a late record lookup after cancel", async () => {
    state.action.mockResolvedValueOnce({
      ok: true,
      value: {
        ok: true,
        today: "2026-10-09",
        intent: grounded({
          kind: "EMPLOYEE_EDIT",
          employee: {
            ref: "CODE",
            code: "EMP-DEMO-002",
            codes: ["EMP-DEMO-002"],
          },
        }),
      },
    });
    let finish: (value: unknown) => void = () => {};
    state.oneShot.mockReturnValueOnce(
      new Promise((done) => {
        finish = done;
      }),
    );
    renderSearch(<Opener mode="AI" />);
    fireEvent.click(screen.getByRole("button", { name: "Open AI" }));
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "แก้ข้อมูล EMP-DEMO-002" } });
    fireEvent.click(aiRow());
    await waitFor(() => expect(state.oneShot).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () =>
      finish(found(hit("e2", "EMP-DEMO-002", "Anan Wong"))),
    );
    expect(state.push).not.toHaveBeenCalled();
  });

  it("does not ask the AI while an IME is composing", async () => {
    state.action.mockResolvedValue(settingsAnswer);
    renderSearch(<Opener mode="AI" />);
    fireEvent.click(screen.getByRole("button", { name: "Open AI" }));
    await screen.findByRole("dialog");
    fireEvent.change(input(), { target: { value: "ตั้งวันหยุด" } });
    fireEvent.compositionStart(input());
    const row = aiRow();
    expect(row).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(row);
    fireEvent.keyDown(input(), { key: "Enter", keyCode: 229 });
    expect(state.action).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input(), { target: { value: "ตั้งวันหยุด" } });
    fireEvent.click(aiRow());
    await waitFor(() => expect(state.action).toHaveBeenCalledTimes(1));
  });
});

describe("search guidance", () => {
  it("offers the typed text to the AI when nothing matches", async () => {
    state.queries.set(ref(hrRefs.searchReviewEmployees), () => found());
    state.queries.set(ref(hrRefs.searchAdminEmployees), () => found());
    state.action.mockResolvedValue({
      ok: true,
      value: {
        ok: true,
        today: "2026-10-09",
        intent: grounded({ kind: "CLARIFY", clarify: "TASK" }),
      },
    });
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    await type("ซซซซซ");
    // The miss is said first, as body text, with what can be searched as its
    // second line, read out with it; then the offer to ask about it.
    const status = screen.getByTestId("global-search-status");
    const hint = "Try a page name, an employee's name or an employee code.";
    expect(status).toHaveTextContent(`No matching pages or records. ${hint}`);
    expect(status).toHaveClass("text-sm", "text-text");
    expect(
      within(status).getByTestId("global-search-no-match-hint"),
    ).toHaveClass("block", "text-muted");
    const fallback = aiRow("ซซซซซ");
    expect(status.compareDocumentPosition(fallback)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(input()).toHaveAttribute("aria-activedescendant", fallback.id);
    // The offer itself says what the AI is for; no separate line above.
    expect(fallback).toHaveAccessibleDescription(
      "AI takes you to pages and forms for time, leave, requests and employees. When you choose AI, your search text is sent to the AI provider to find relevant pages.",
    );
    expect(screen.queryByTestId("global-search-ai-scope")).toBeNull();
    // Then places to go without the AI, under their own heading.
    const goTo = screen.getByRole("group", { name: "Go to" });
    expect(goTo).not.toHaveAttribute("aria-describedby");
    expect(fallback.compareDocumentPosition(goTo)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(within(goTo).getAllByRole("option").length).toBeGreaterThan(0);
    expect(screen.getByTestId("global-search-keys")).toHaveTextContent(
      "↑ ↓ to choose · Enter to ask AI · Esc to clear",
    );
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(state.action).toHaveBeenCalledTimes(1));
    expect(state.action.mock.calls[0]![0].query).toBe("ซซซซซ");
    expect(input()).toHaveFocus();
    // Asked: the same text is not offered again.
    await screen.findByTestId("global-search-ai-outcome");
    expect(
      screen.queryByRole("option", { name: /Ask AI where to go for “ซซซซซ”/ }),
    ).not.toBeInTheDocument();
  });

  it("offers AI as one row after the typed results, first when nothing matches, and keeps it in place while typing on", async () => {
    state.queries.set(ref(hrRefs.searchReviewEmployees), () => found());
    state.queries.set(ref(hrRefs.searchAdminEmployees), () => found());
    state.action.mockResolvedValue({
      ok: true,
      value: {
        ok: true,
        today: "2026-10-09",
        intent: grounded({ kind: "CLARIFY", clarify: "TASK" }),
      },
    });
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    const options = () => screen.getAllByRole("option");
    const keys = () => screen.getByTestId("global-search-keys");

    // Typed results lead and the first is chosen; the AI row follows them,
    // one arrow away, and there is never an Ask AI button.
    await type("holidays");
    expect(options().at(-1)).toBe(aiRow("holidays"));
    expect(input()).toHaveAttribute("aria-activedescendant", options()[0]!.id);
    expect(keys()).toHaveTextContent("Enter to open");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(input()).toHaveAttribute(
      "aria-activedescendant",
      aiRow("holidays").id,
    );
    expect(keys()).toHaveTextContent("Enter to ask AI");
    expect(screen.queryByRole("button", { name: /Ask AI/ })).toBeNull();

    // Nothing matches: the same row comes first and is chosen.
    await type("ซซซซซ");
    expect(options()[0]).toBe(aiRow("ซซซซซ"));
    expect(input()).toHaveAttribute("aria-activedescendant", aiRow("ซซซซซ").id);

    // Typing on, the row keeps its place and follows the text; it asks about
    // the text as typed, so it never waits for the results to settle.
    fireEvent.change(input(), { target: { value: "ซซซซซซ" } });
    expect(options()[0]).toBe(aiRow("ซซซซซซ"));
    expect(aiRow("ซซซซซซ")).not.toHaveAttribute("aria-disabled");
    await type("ซซซซซซ");
    expect(options()[0]).toBe(aiRow("ซซซซซซ"));

    // Choosing the row asks the AI about the text shown in it.
    fireEvent.click(aiRow("ซซซซซซ"));
    await waitFor(() => expect(state.action).toHaveBeenCalledTimes(1));
    expect(state.action.mock.calls[0]![0].query).toBe("ซซซซซซ");
    await screen.findByTestId("global-search-ai-outcome");
    expect(screen.queryByTestId("global-search-ai")).toBeNull();

    // New text with matches brings the row back after them.
    await type("holidays");
    expect(options().at(-1)).toBe(aiRow("holidays"));
  });

  it("says what can be searched when nothing matches and AI is not available", async () => {
    state.access = { status: "NONE", permissions: [], sites: [] };
    state.workspace = {
      permissionsReady: true,
      navigationPermissions: ["masterData.storageLayout.read"],
    };
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    expect(input()).toHaveAttribute("placeholder", "Search pages and sections");
    await type("zzzzz");
    // The miss is said first with what can be searched under it, on the same
    // edge and read out together; then places to go.
    const status = screen.getByTestId("global-search-status");
    const hint =
      "Only page and section names can be searched. Try a shorter word.";
    expect(status).toHaveTextContent(`No matching pages or records. ${hint}`);
    expect(status).toHaveClass("text-sm", "text-text");
    expect(
      within(status).getByTestId("global-search-no-match-hint"),
    ).toHaveTextContent(hint);
    const goTo = screen.getByRole("group", { name: "Go to" });
    expect(status.compareDocumentPosition(goTo)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(
      within(goTo).getByRole("option", { name: /Finished goods/ }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("global-search-ai")).toBeNull();
    // None of them is chosen for the missed text: the arrows reach them,
    // and Enter does nothing, so the hint does not offer it.
    expect(input()).not.toHaveAttribute("aria-activedescendant");
    expect(screen.getByTestId("global-search-keys")).toHaveTextContent(
      /^↑ ↓ to choose · Esc to clear$/,
    );
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(state.push).not.toHaveBeenCalled();
  });

  it("names record results by what they are and leaves their count to the live status", async () => {
    state.queries.set(ref(hrRefs.searchReviewEmployees), () => found());
    state.queries.set(ref(hrRefs.searchAdminEmployees), () =>
      found(hit("e3", "EMP-DEMO-003", "สมชาย ใจดี", "PARTIAL")),
    );
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    await type("สมชาย");
    const employees = screen.getByRole("group", { name: "Employees" });
    const person = within(employees).getByRole("option", {
      name: "สมชาย ใจดี",
    });
    expect(person).toBeVisible();
    // The name leads; the code and site and what opening it does describe
    // it. No trail repeats the heading.
    expect(person).toHaveTextContent(/^สมชาย ใจดี/);
    expect(person).not.toHaveTextContent("People ›");
    expect(person).toHaveAccessibleDescription(
      "EMP-DEMO-003 · HQ Open the employee form",
    );
    expect(screen.queryByRole("group", { name: "Records" })).toBeNull();
    // The heading says what was found; the count is announced, not shown.
    const status = screen.getByTestId("global-search-status");
    expect(status).toHaveTextContent("1 result");
    expect(status).toHaveClass("sr-only");
  });

  it("marks the page already open as this page and keeps it selectable", async () => {
    state.pathname = "/hr/holidays";
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    await type("holidays");
    const here = screen.getByRole("option", { name: "Company holidays" });
    // The tag takes the trail's place and describes the row.
    expect(
      within(here).getByTestId("global-search-this-page"),
    ).toHaveTextContent(/^This page$/);
    expect(here).toHaveAccessibleDescription("This page");
    expect(here).not.toHaveAttribute("aria-disabled");
    // Another page keeps its trail and no tag.
    const other = screen.getByRole("option", { name: "Holidays" });
    expect(within(other).queryByTestId("global-search-this-page")).toBeNull();
    expect(other).toHaveAccessibleDescription(/^People › HR settings/);
    fireEvent.click(here);
    await waitFor(() =>
      expect(state.push).toHaveBeenCalledWith("/hr/holidays"),
    );
  });

  it("marks the typed text in result titles and keeps the full title as the name", async () => {
    state.queries.set(ref(hrRefs.searchReviewEmployees), () => found());
    state.queries.set(ref(hrRefs.searchAdminEmployees), () =>
      found(hit("e3", "EMP-DEMO-003", "สมชาย ใจดี", "PARTIAL")),
    );
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    expect(input()).toHaveAttribute("placeholder", "Search pages or employees");
    await type("สมชาย");
    const option = screen.getByRole("option", { name: /สมชาย ใจดี/ });
    const marks = option.querySelectorAll("mark");
    expect([...marks].map((mark) => mark.textContent)).toEqual(["สมชาย"]);
    expect(marks[0]!.parentElement).toHaveTextContent(/^สมชาย ใจดี$/);

    await type("holi");
    expect(
      [
        ...screen
          .getByRole("option", { name: /Company holidays/ })
          .querySelectorAll("mark"),
      ].map((mark) => mark.textContent),
    ).toEqual(["holi"]);
  });

  it("shows AI progress in the AI row's place as the only AI control, and keeps the box focused", async () => {
    let resolve: (value: unknown) => void = () => {};
    state.action.mockReturnValue(new Promise((done) => (resolve = done)));
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    await type("holidays");
    expect(screen.getByTestId("global-search-keys")).toHaveTextContent(
      "↑ ↓ to choose · Enter to open · Esc to clear",
    );
    fireEvent.mouseMove(
      screen.getByRole("option", { name: "Company holidays" }),
    );
    fireEvent.click(aiRow("holidays"));

    const words = await screen.findByText("AI is reading your request…");
    expect(input()).not.toHaveAttribute("aria-activedescendant");
    expect(words).toHaveAttribute("role", "status");
    const running = screen.getByTestId("global-search-ai-running");
    expect(running.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(running).toHaveTextContent(
      "AI takes you to pages and forms for time, leave, requests and employees.",
    );
    // Cancel is beside the words, not inside what is announced, and keeps a
    // full touch target.
    const cancel = within(running).getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveClass("min-h-touch");
    expect(words).not.toContainElement(cancel);
    // It takes the row's place after the typed results, outside the list,
    // and no other AI control is shown while it runs.
    const list = screen.getByRole("listbox");
    expect(list.compareDocumentPosition(running)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(list).not.toContainElement(running);
    expect(screen.queryByTestId("global-search-ai")).toBeNull();
    expect(screen.queryByRole("option", { name: /Ask AI/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Ask AI/ })).toBeNull();
    expect(screen.queryByTestId("global-search-ai-scope")).toBeNull();
    expect(screen.queryByTestId("global-search-ai-panel")).toBeNull();
    expect(input()).toHaveFocus();
    // The typed results keep their place and heading; nothing stands in
    // for the answer yet.
    expect(
      screen.getByRole("group", { name: "Pages and sections" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("global-search-ordinary-heading")).toBeNull();
    expect(screen.queryByTestId("global-search-ai-pending")).toBeNull();
    // Enter can neither ask (running) nor open (nothing chosen) yet.
    expect(screen.getByTestId("global-search-keys")).toHaveTextContent(
      /^↑ ↓ to choose · Esc to clear$/,
    );
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(screen.getByTestId("global-search-keys")).toHaveTextContent(
      "↑ ↓ to choose · Enter to open · Esc to clear",
    );
    await act(async () =>
      resolve({
        ok: true,
        value: {
          ok: true,
          today: "2026-10-09",
          intent: grounded({ kind: "CLARIFY", clarify: "TASK" }),
        },
      }),
    );
    // Answered: the progress row goes, and with the answer above them the
    // ordinary results are named for the typed text; with one kind of
    // result, that one heading names the group.
    expect(screen.queryByTestId("global-search-ai-running")).toBeNull();
    expect(
      screen.getByTestId("global-search-ordinary-heading"),
    ).toHaveTextContent(/^Matches for your text( \(\d+\))?$/);
    expect(
      screen.getByRole("group", { name: "Matches for your text" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Pages and sections")).toBeNull();
    expect(screen.queryByTestId("global-search-ai")).toBeNull();
  });
});

describe("recent destinations", () => {
  const open = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
  };
  const choose = async (name: RegExp) => {
    fireEvent.click(screen.getByRole("option", { name }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  };
  const names = (group: HTMLElement) =>
    within(group)
      .getAllByRole("option")
      .map((option) => option.textContent);

  it("offers places opened from search first, newest first, for this member and organization only", async () => {
    state.queries.set(ref(hrRefs.searchReviewEmployees), () =>
      found(hit("e2", "EMP-DEMO-002", "Anan Wong")),
    );
    state.queries.set(ref(hrRefs.searchAdminEmployees), () => found());
    renderSearch();
    await open();
    await type("holidays");
    await choose(/Company holidays/);
    await open();
    await type("ตรวจ EMP-DEMO-002 เมื่อวาน");
    await choose(/Anan Wong/);
    expect(state.push).toHaveBeenLastCalledWith(
      "/hr/review?employee=e2&date=2026-10-08&focus=decision",
    );

    await open();
    // A record is remembered as the page it opened on; nothing about the
    // person is stored.
    const recent = screen.getByRole("group", { name: "Recent" });
    expect(names(recent)).toEqual(["ReviewPeople", "Company holidaysPeople"]);
    expect(JSON.stringify({ ...window.localStorage })).not.toMatch(
      /e2|EMP-DEMO|Anan/,
    );
    expect(input()).toHaveAttribute(
      "aria-activedescendant",
      within(recent).getAllByRole("option")[0]!.id,
    );
    // Go to does not repeat them, and the places stay six in all.
    expect(names(screen.getByRole("group", { name: "Go to" }))).toEqual([
      "Attendance historyPeople",
      "My requestsPeople",
      "LeavePeople",
      "Review leavePeople",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    // A place the member can no longer open is not offered.
    state.access = { ...state.access, permissions: ["hr.self.access"] };
    await open();
    expect(names(screen.getByRole("group", { name: "Recent" }))).toEqual([
      "Company holidaysPeople",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    // Another organization has its own (here, none).
    state.auth = { userId: "user-a", orgId: "org-b" };
    await open();
    expect(screen.queryByRole("group", { name: "Recent" })).toBeNull();
  });

  it("still opens a place when the browser refuses to store it", async () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    try {
      renderSearch();
      await open();
      await type("holidays");
      await choose(/Company holidays/);
      expect(state.push).toHaveBeenCalledWith("/hr/holidays");
      await open();
      expect(screen.queryByRole("group", { name: "Recent" })).toBeNull();
    } finally {
      setItem.mockRestore();
    }
  });
});
