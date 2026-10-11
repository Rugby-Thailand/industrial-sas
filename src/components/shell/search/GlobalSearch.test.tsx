import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  queries: new Map<string, (args: Record<string, unknown>) => unknown>(),
  queryCalls: [] as { name: string; args: unknown }[],
  action: vi.fn(),
  oneShot: vi.fn(),
  push: vi.fn(),
  access: {} as Record<string, unknown>,
  workspace: {} as Record<string, unknown>,
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
    useAction: () => state.action,
    useConvex: () => ({ query: state.oneShot }),
  };
});
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => state.access,
}));
vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => state.workspace,
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: state.push, replace: vi.fn() }),
}));

import { hrRefs } from "@/lib/convex/hrApi";
import { registerTransitionGuard } from "@/lib/navigationGuard";

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

function renderSearch(children = <Opener />) {
  return renderWithIntl(
    <GlobalSearchProvider>{children}</GlobalSearchProvider>,
    {
      locale: "en",
    },
  );
}

const input = () => screen.getByRole("combobox", { name: "Search" });
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
  state.queries.clear();
  state.queryCalls.length = 0;
  state.action.mockReset();
  state.oneShot.mockReset();
  state.push.mockReset();
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
    expect(option).toHaveTextContent("People › HR settings › Holidays");
    expect(input()).toHaveAttribute("aria-activedescendant", option.id);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(state.push).toHaveBeenCalledWith("/hr/settings?section=holidays");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("moves with arrows, ignores Enter while an IME composes, and returns focus on Escape", async () => {
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
    fireEvent.compositionEnd(input());
    fireEvent.keyDown(input(), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(opener).toHaveFocus();
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
    expect(state.push).toHaveBeenCalledWith(
      "/hr/review?employee=e2&date=2026-10-08&focus=decision",
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
    const release = registerTransitionGuard((next) => {
      held = next;
    });
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    await type("holidays");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(state.push).not.toHaveBeenCalled();
    act(() => held?.());
    expect(state.push).toHaveBeenCalledWith("/hr/settings?section=holidays");
    release();
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
      screen.queryByRole("button", { name: "Ask AI" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("global-search-ai-disclosure"),
    ).not.toBeInTheDocument();
    await type("scan");
    expect(
      screen.getByRole("option", { name: /Scan job tickets/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Review/ }),
    ).not.toBeInTheDocument();
  });
});

describe("AI Search", () => {
  it("says what Ask AI sends before anything is asked, and offers examples only for an empty query", async () => {
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Open SEARCH" }));
    await screen.findByRole("dialog");
    // Normal search: the AI button and what pressing it sends, nothing more.
    const note = screen.getByTestId("global-search-ai-disclosure");
    expect(note).toBeVisible();
    expect(note).toHaveTextContent("typed text (including any names)");
    expect(note).toHaveTextContent("AI provider");
    expect(note).toHaveTextContent("No records are sent");
    expect(screen.getByRole("button", { name: "Ask AI" })).toBeDisabled();
    expect(
      screen.queryByTestId("global-search-ai-panel"),
    ).not.toBeInTheDocument();
    expect(state.action).not.toHaveBeenCalled();
  });

  it("offers examples only while the AI query is empty, keeping the disclosure in view", async () => {
    renderSearch(<Opener mode="AI" />);
    fireEvent.click(screen.getByRole("button", { name: "Open AI" }));
    await screen.findByRole("dialog");
    const examples = screen.getByRole("group", { name: "Examples" });
    expect(examples).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "ตั้งวันหยุด" }));
    expect(input()).toHaveValue("ตั้งวันหยุด");
    expect(input()).toHaveFocus();
    expect(
      screen.queryByRole("group", { name: "Examples" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("global-search-ai-disclosure")).toBeVisible();
    // An example only fills the box: nothing is sent until Ask AI.
    expect(state.action).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Ask AI" })).toBeEnabled();
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
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
    await waitFor(() => expect(state.action).toHaveBeenCalledTimes(1));
    expect(state.action.mock.calls[0]![0]).toEqual({
      query: "fix this one",
      context: { page: "hr.review", employee: true, date: true, period: false },
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear context" }));
    expect(
      screen.queryByTestId("global-search-context"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
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
    expect(state.push).toHaveBeenCalledWith(
      "/hr/review?employee=e3&date=2026-10-08&focus=decision",
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
      screen.getByRole("option", { name: /Go to export/ }),
    ).toHaveTextContent("HQ · Closed, version 4");

    // Native finding: the latest is v4, the text asks for v1. The row must
    // name the version it opens, not the latest.
    await type("ส่งออกงวด 19–25 ก.ย. 2569 ฉบับ 1");
    const first = screen.getByRole("option", { name: /Go to export/ });
    expect(first).not.toHaveAttribute("aria-disabled");
    expect(first).toHaveTextContent("HQ · Closed, version 1");
    expect(first).not.toHaveTextContent("version 4");
    fireEvent.click(first);
    expect(state.push).toHaveBeenCalledWith(
      "/hr/periods/p1?version=1&focus=export",
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
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
    const choice = await screen.findByRole("option", { name: /Go to export/ });
    expect(choice).not.toHaveAttribute("aria-disabled");
    expect(choice).toHaveTextContent("HQ · Closed, version 1");
    expect(choice).not.toHaveTextContent("version 4");
    expect(state.push).not.toHaveBeenCalled();
    fireEvent.click(choice);
    expect(state.push).toHaveBeenCalledWith(
      "/hr/periods/p1?version=1&focus=export",
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
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
    expect(
      await screen.findByText("AI is reading your request…"),
    ).toBeInTheDocument();
  };

  it("ignores a late answer after the dialog closes and reopens", async () => {
    const resolve = pending();
    renderSearch(<Opener mode="AI" />);
    await startAi();
    fireEvent.keyDown(input(), { key: "Escape" });
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
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
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
    const button = screen.getByRole("button", { name: "Ask AI" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(state.action).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input(), { target: { value: "ตั้งวันหยุด" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask AI" }));
    await waitFor(() => expect(state.action).toHaveBeenCalledTimes(1));
  });
});
