import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  queries: new Map<string, (args: Record<string, unknown>) => unknown>(),
  action: vi.fn(),
  oneShot: vi.fn(),
  push: vi.fn(),
  access: {} as Record<string, unknown>,
}));

vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) =>
      args === "skip"
        ? undefined
        : state.queries.get(name(reference))?.(args as Record<string, unknown>),
    useAction: () => state.action,
    useConvex: () => ({ query: state.oneShot }),
  };
});
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => state.access,
}));
vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => ({
    permissionsReady: false,
    navigationPermissions: [],
    denied: true,
    failed: false,
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: state.push, replace: vi.fn() }),
}));

import {
  GlobalSearchProvider,
  useSearchControls,
} from "./GlobalSearchProvider";
import { SearchDialog } from "./SearchDialog";

function Opener({ mode = "SEARCH" }: { readonly mode?: "SEARCH" | "AI" }) {
  const controls = useSearchControls();
  return (
    <button type="button" onClick={() => controls?.open(mode)}>
      Open {mode}
    </button>
  );
}

const arrival = { notify: () => undefined as void };

/**
 * Stands in for the page section a deep link focuses: it takes focus from an
 * effect once navigation has happened, as the real target does.
 */
function Destination() {
  const [arrived, setArrived] = useState(0);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    arrival.notify = () => setArrived((count) => count + 1);
  }, []);
  useEffect(() => {
    if (arrived > 0) section.current?.focus();
  }, [arrived]);
  return (
    <section ref={section} id="destination" tabIndex={-1}>
      Destination section
    </section>
  );
}
const destination = () => document.getElementById("destination")!;

const input = () => screen.getByRole("combobox", { name: "Search" });
const type = async (text: string) => {
  fireEvent.change(input(), { target: { value: text } });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
};
/** Lets the closing dialog run its deferred focus hand-back, if any. */
const afterClose = async () => {
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
};

beforeEach(() => {
  state.queries.clear();
  state.action.mockReset();
  state.oneShot.mockReset();
  state.push.mockReset();
  // The destination page takes focus once it has been navigated to.
  state.push.mockImplementation(() => arrival.notify());
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
});

function renderShell(mode: "SEARCH" | "AI" = "SEARCH") {
  renderWithIntl(
    <GlobalSearchProvider>
      <Opener mode={mode} />
      <Destination />
    </GlobalSearchProvider>,
    { locale: "en" },
  );
  const opener = screen.getByRole("button", { name: `Open ${mode}` });
  const open = async () => {
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole("dialog");
  };
  return { opener, open };
}

describe("focus after the search dialog closes", () => {
  it("leaves focus on the destination after a chosen result, and still returns it on a later Escape", async () => {
    const { opener, open } = renderShell();
    await open();
    await type("holidays");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(state.push).toHaveBeenCalledWith("/hr/settings?section=holidays");
    await afterClose();
    expect(destination()).toHaveFocus();

    // The next ordinary dismissal is not affected by that navigation.
    await open();
    expect(input()).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await afterClose();
    expect(opener).toHaveFocus();
    expect(state.push).toHaveBeenCalledTimes(1);
  });

  it("leaves focus on the destination after an AI navigation", async () => {
    state.action.mockResolvedValue({
      ok: true,
      value: {
        ok: true,
        today: "2026-10-09",
        intent: {
          kind: "TEAM_DAY_REVIEW",
          page: null,
          settingsSection: null,
          employeeFocus: null,
          employee: {
            ref: "CODE",
            code: "EMP-DEMO-002",
            codes: ["EMP-DEMO-002"],
          },
          date: { ref: "DATE", date: "2026-10-08", inferredYear: false },
          period: null,
          dateProblem: null,
          dropped: [],
          clarify: null,
          unsupportedTopic: null,
        },
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
    const { open } = renderShell("AI");
    await open();
    fireEvent.change(input(), {
      target: { value: "ตรวจคำขอ EMP-DEMO-002 วันที่ 8 ต.ค. 2569" },
    });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() =>
      expect(state.push).toHaveBeenCalledWith(
        "/hr/review?employee=e2&date=2026-10-08&focus=decision",
      ),
    );
    await afterClose();
    expect(destination()).toHaveFocus();
  });

  it("returns focus to the opener when the target is refused and the dialog is then dismissed", async () => {
    // The shell refuses the destination: nothing opens, the dialog stays.
    const onNavigate = vi.fn(() => false);
    function Shell() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Destination />
          <SearchDialog
            open={open}
            mode="SEARCH"
            aiAvailable={false}
            granted={state.access.permissions as string[]}
            pageContext={null}
            onOpenChange={setOpen}
            onModeChange={() => undefined}
            onNavigate={onNavigate}
          />
        </>
      );
    }
    renderWithIntl(<Shell />, { locale: "en" });
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole("dialog");
    await type("holidays");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await afterClose();
    expect(opener).toHaveFocus();
  });
});
