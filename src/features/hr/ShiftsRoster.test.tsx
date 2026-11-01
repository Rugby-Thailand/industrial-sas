import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { useSyncExternalStore, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
  identityKey: "org-a:user-a",
}));
vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) =>
      args === "skip" ? undefined : state.queries.get(name(reference)),
    useMutation: (reference: Parameters<typeof name>[0]) => {
      const key = name(reference);
      if (!state.mutations.has(key)) state.mutations.set(key, vi.fn());
      return state.mutations.get(key);
    },
  };
});
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: ["hr.admin.manage"],
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    today: "2026-10-20",
    identityKey: state.identityKey,
    sites: [{ id: "w1", code: "HQ", name: "Head office" }],
  }),
  useHrCan: () => true,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    const query = useSyncExternalStore(
      (listener) => {
        window.addEventListener("app-query-state", listener);
        window.addEventListener("popstate", listener);
        return () => {
          window.removeEventListener("app-query-state", listener);
          window.removeEventListener("popstate", listener);
        };
      },
      () => window.location.search,
    );
    return new URLSearchParams(query);
  },
}));
vi.mock("@/i18n/navigation", () => {
  function navigate(href: string, mode: "pushState" | "replaceState") {
    window.history[mode]({}, "", `/en${href}`);
    window.dispatchEvent(new Event("app-query-state"));
  }
  const router = {
    push: (href: string) => navigate(href, "pushState"),
    replace: (href: string) => navigate(href, "replaceState"),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
  };
  return {
    Link: (props: ComponentProps<"a">) => <a {...props} />,
    useRouter: () => router,
  };
});

import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { hrRefs } from "@/lib/convex/hrApi";

import { HrRosterScreen, HrShiftsScreen } from "./ShiftsRoster";

const query = (value: unknown) => ({ ok: true, requestId: "query", value });
const saved = (documentId: string) => ({
  ok: true,
  value: { written: true, documentId, replayed: false },
});
const mutation = (reference: Parameters<typeof getFunctionName>[0]) => {
  const key = getFunctionName(reference);
  if (!state.mutations.has(key)) state.mutations.set(key, vi.fn());
  return state.mutations.get(key)!;
};
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

const day = {
  id: "s1",
  code: "SHIFT101",
  name: "Day shift",
  color: "sky",
  status: "ACTIVE",
  startTime: "08:00",
  endTime: "17:00",
  endsNextDay: false,
  breakMinutes: 60,
  version: 3,
};
const dates = ["2026-10-20", "2026-10-21", "2026-10-22"];
function rosterValue(revision = 0) {
  return {
    ok: true,
    today: "2026-10-20",
    month: "2026-10",
    site: { id: "w1", code: "HQ", name: "Head office" },
    dates: dates.map((date, index) => ({ date, weekday: 2 + index })),
    shifts: [day],
    shiftsComplete: true,
    totalEmployees: 1,
    employees: [
      {
        id: "e1",
        code: "E001",
        displayName: "Somchai",
        status: "ACTIVE",
        departmentId: null,
        departmentName: "Sales",
        cells: dates.map((date) => ({
          date,
          revision: date === "2026-10-21" ? revision : 0,
          assignment: null,
          plan: { kind: "SCHEDULED", startTime: "09:00", endTime: "18:00" },
          recorded: date === "2026-10-20",
          lock: date === "2026-10-20" ? "RECORDED" : null,
        })),
      },
    ],
  };
}

let stopTracking: () => void;
let actor = 0;
beforeEach(() => {
  state.identityKey = `org-a:user-${++actor}`;
  state.queries.clear();
  state.mutations.clear();
  window.sessionStorage.clear();
  state.queries.set(
    getFunctionName(hrRefs.shifts),
    query({ ok: true, complete: true, items: [day] }),
  );
  state.queries.set(getFunctionName(hrRefs.roster), query(rosterValue()));
  window.history.replaceState({ appNavigationIndex: 0 }, "", "/en/hr/today");
  stopTracking = trackAppHistory();
});
afterEach(() => stopTracking());

const here = () =>
  window.location.pathname + window.location.search + window.location.hash;
function open(Screen: () => React.JSX.Element, url: string, push = true) {
  if (push) window.history.pushState({}, "", url);
  else window.history.replaceState({ appNavigationIndex: 0 }, "", url);
  return renderWithIntl(
    <DraftGuardProvider>
      <main>
        <Screen />
      </main>
    </DraftGuardProvider>,
    { locale: "en", workspace: false, preserveProviders: true },
  );
}
async function traverse(delta: "back" | "forward") {
  await act(async () => {
    window.history[delta]();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
  });
}
const field = (text: string) => new RegExp(`^${text}( \\*)?$`);

it("Add shift -> explicit Cancel -> next Back returns to the shifts caller with locale, query and hash", async () => {
  open(HrShiftsScreen, "/en/hr/shifts?keep=1#list");
  expect(screen.getByRole("rowheader", { name: /SHIFT101/ })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Add shift" }));
  const editor = await screen.findByRole("dialog", { name: "Add shift" });
  fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(here()).toBe("/en/hr/shifts?keep=1#list"));
  await traverse("back");
  await waitFor(() => expect(here()).toBe("/en/hr/today"));
});

it("native Back closes a clean shift editor and Forward reopens the same shift", async () => {
  open(HrShiftsScreen, "/en/hr/shifts");
  fireEvent.click(screen.getByRole("button", { name: "Edit shift SHIFT101" }));
  await screen.findByRole("dialog", { name: "Edit shift" });
  await traverse("back");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(here()).toBe("/en/hr/shifts");
  await traverse("forward");
  const editor = await screen.findByRole("dialog", { name: "Edit shift" });
  expect(within(editor).getByLabelText(field("Shift code"))).toHaveValue(
    "SHIFT101",
  );
});

it("a dirty shift draft asks before native Back discards it, and Discard consumes only the dialog", async () => {
  open(HrShiftsScreen, "/en/hr/shifts#list");
  fireEvent.click(screen.getByRole("button", { name: "Add shift" }));
  const editor = await screen.findByRole("dialog", { name: "Add shift" });
  fireEvent.change(within(editor).getByLabelText(field("Shift code")), {
    target: { value: "NIGHT" },
  });
  await traverse("back");
  await screen.findByRole("dialog", { name: "Save changes before leaving?" });
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(here()).toBe("/en/hr/shifts#list"));
  await traverse("back");
  await waitFor(() => expect(here()).toBe("/en/hr/today"));
  expect(mutation(hrRefs.saveShift)).not.toHaveBeenCalled();
});

it("a pending shift save blocks native Back and Cancel until it settles, then consumes its dialog", async () => {
  const pending = deferred();
  const save = mutation(hrRefs.saveShift);
  save.mockReturnValue(pending.promise);
  open(HrShiftsScreen, "/en/hr/shifts#list");
  fireEvent.click(screen.getByRole("button", { name: "Edit shift SHIFT101" }));
  const editor = await screen.findByRole("dialog", { name: "Edit shift" });
  fireEvent.change(within(editor).getByLabelText(field("Shift name")), {
    target: { value: "Morning" },
  });
  fireEvent.click(within(editor).getByRole("button", { name: "Save shift" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      warehouseId: "w1",
      shiftId: "s1",
      expectedVersion: 3,
      code: "SHIFT101",
      name: "Morning",
      breakMinutes: 60,
      status: "ACTIVE",
    }),
  );
  expect(within(editor).getByRole("button", { name: "Cancel" })).toBeDisabled();
  await traverse("back");
  expect(screen.getByRole("dialog", { name: "Edit shift" })).toBeVisible();
  await act(async () => pending.resolve(saved("s1")));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(here()).toBe("/en/hr/shifts#list"));
  await traverse("back");
  await waitFor(() => expect(here()).toBe("/en/hr/today"));
});

it("roster assignment Cancel consumes its step before the next native Back restores the caller with locale, query and hash", async () => {
  open(HrRosterScreen, "/en/hr/roster?keep=1#grid");
  expect(
    screen.getByRole("table", { name: "Roster by employee and date" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Assign shifts" }));
  const bar = await screen.findByRole("form", {
    name: "Assign shifts to selected dates",
  });
  expect(within(bar).getByRole("status")).toHaveTextContent(
    "No dates selected",
  );
  fireEvent.click(within(bar).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("form", { name: "Assign shifts to selected dates" }),
    ).toBeNull(),
  );
  await waitFor(() => expect(here()).toBe("/en/hr/roster?keep=1#grid"));
  await traverse("back");
  await waitFor(() => expect(here()).toBe("/en/hr/today"));
});

it("native Back leaves a clean roster assignment and Forward reopens it", async () => {
  open(HrRosterScreen, "/en/hr/roster");
  fireEvent.click(screen.getByRole("button", { name: "Assign shifts" }));
  await screen.findByRole("form", { name: "Assign shifts to selected dates" });
  await traverse("back");
  await waitFor(() =>
    expect(
      screen.queryByRole("form", { name: "Assign shifts to selected dates" }),
    ).toBeNull(),
  );
  expect(here()).toBe("/en/hr/roster");
  await traverse("forward");
  await screen.findByRole("form", { name: "Assign shifts to selected dates" });
});

it("a selected roster draft asks before native Back discards it and survives a remote roster update", async () => {
  const view = open(HrRosterScreen, "/en/hr/roster#grid");
  fireEvent.click(screen.getByRole("button", { name: "Assign shifts" }));
  const bar = await screen.findByRole("form", {
    name: "Assign shifts to selected dates",
  });
  // A captured day is not selectable; open dates toggle with aria-pressed.
  expect(
    screen.getByRole("button", { name: /Somchai, 2026-10-20/ }),
  ).toBeDisabled();
  const cell = screen.getByRole("button", { name: /Somchai, 2026-10-21/ });
  fireEvent.click(cell);
  expect(cell).toHaveAttribute("aria-pressed", "true");
  expect(within(bar).getByRole("status")).toHaveTextContent("1 date selected");
  // A remote revision arrives: the draft selection is retained.
  state.queries.set(getFunctionName(hrRefs.roster), query(rosterValue(5)));
  view.rerender(
    <DraftGuardProvider>
      <main>
        <HrRosterScreen />
      </main>
    </DraftGuardProvider>,
  );
  expect(
    screen.getByRole("button", { name: /Somchai, 2026-10-21/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await traverse("back");
  await screen.findByRole("dialog", { name: "Save changes before leaving?" });
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Save changes before leaving?" }),
    ).toBeNull(),
  );
  expect(within(bar).getByRole("status")).toHaveTextContent("1 date selected");
  fireEvent.click(within(bar).getByRole("button", { name: "Cancel" }));
  await screen.findByRole("dialog", { name: "Save changes before leaving?" });
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() => expect(here()).toBe("/en/hr/roster#grid"));
  await traverse("back");
  await waitFor(() => expect(here()).toBe("/en/hr/today"));
  expect(mutation(hrRefs.assignRoster)).not.toHaveBeenCalled();
});

it("a pending roster save blocks Back, sends the selected revisions, then consumes the assignment step", async () => {
  const pending = deferred();
  const save = mutation(hrRefs.assignRoster);
  save.mockReturnValue(pending.promise);
  open(HrRosterScreen, "/en/hr/roster#grid");
  fireEvent.click(screen.getByRole("button", { name: "Assign shifts" }));
  const bar = await screen.findByRole("form", {
    name: "Assign shifts to selected dates",
  });
  fireEvent.click(screen.getByRole("button", { name: /Somchai, 2026-10-21/ }));
  fireEvent.click(screen.getByRole("button", { name: /Somchai, 2026-10-22/ }));
  fireEvent.click(within(bar).getByRole("combobox"));
  fireEvent.click(await screen.findByRole("option", { name: "OFF" }));
  fireEvent.click(within(bar).getByRole("button", { name: "Save assignment" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      warehouseId: "w1",
      action: { kind: "OFF" },
      cells: [
        { employeeId: "e1", date: "2026-10-21", expectedRevision: 0 },
        { employeeId: "e1", date: "2026-10-22", expectedRevision: 0 },
      ],
    }),
  );
  expect(within(bar).getByRole("button", { name: "Cancel" })).toBeDisabled();
  await traverse("back");
  expect(
    await screen.findByRole("form", {
      name: "Assign shifts to selected dates",
    }),
  ).toBeVisible();
  await act(async () => pending.resolve(saved("a1")));
  await waitFor(() =>
    expect(
      screen.queryByRole("form", { name: "Assign shifts to selected dates" }),
    ).toBeNull(),
  );
  await waitFor(() => expect(here()).toBe("/en/hr/roster#grid"));
  await traverse("back");
  await waitFor(() => expect(here()).toBe("/en/hr/today"));
});

it("a refreshed roster assignment link remounts with an empty selection and Cancel removes only its step", async () => {
  open(HrRosterScreen, "/en/hr/roster?rosterAssign=1&keep=1#grid", false);
  const bar = await screen.findByRole("form", {
    name: "Assign shifts to selected dates",
  });
  // Unsent selections are never reconstructed from a URL.
  expect(within(bar).getByRole("status")).toHaveTextContent(
    "No dates selected",
  );
  fireEvent.click(within(bar).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("form", { name: "Assign shifts to selected dates" }),
    ).toBeNull(),
  );
  await waitFor(() => expect(here()).toBe("/en/hr/roster?keep=1#grid"));
});

// Independent Codex review regressions for reactive template edits and repeat
// assignment visits. These drive the shipped caller with mocked transport;
// registered persistence assertions live in the integration suite.
it("a selected shift retains the template version the admin chose across a remote definition edit", async () => {
  const save = mutation(hrRefs.assignRoster);
  save.mockResolvedValue({
    ok: true,
    value: { written: false, error: { code: "SHIFT_STALE" } },
  });
  const view = open(HrRosterScreen, "/en/hr/roster#grid");
  fireEvent.click(screen.getByRole("button", { name: "Assign shifts" }));
  const bar = await screen.findByRole("form", {
    name: "Assign shifts to selected dates",
  });
  fireEvent.click(screen.getByRole("button", { name: /Somchai, 2026-10-21/ }));
  fireEvent.click(within(bar).getByRole("combobox"));
  fireEvent.click(await screen.findByRole("option", { name: /SHIFT101/ }));

  const updated = rosterValue();
  updated.shifts = [{ ...day, version: 4, startTime: "07:00" }];
  state.queries.set(getFunctionName(hrRefs.roster), query(updated));
  view.rerender(
    <DraftGuardProvider>
      <main>
        <HrRosterScreen />
      </main>
    </DraftGuardProvider>,
  );
  fireEvent.click(within(bar).getByRole("button", { name: "Save assignment" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      action: { kind: "SHIFT", shiftId: "s1", expectedShiftVersion: 3 },
    }),
  );
  expect(
    screen.getByRole("button", { name: /Somchai, 2026-10-21/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

it("a second roster draft after a successful save still asks before Back discards it", async () => {
  const save = mutation(hrRefs.assignRoster);
  save.mockResolvedValue(saved("a1"));
  open(HrRosterScreen, "/en/hr/roster#grid");
  fireEvent.click(screen.getByRole("button", { name: "Assign shifts" }));
  const first = await screen.findByRole("form", {
    name: "Assign shifts to selected dates",
  });
  fireEvent.click(screen.getByRole("button", { name: /Somchai, 2026-10-21/ }));
  fireEvent.click(within(first).getByRole("combobox"));
  fireEvent.click(await screen.findByRole("option", { name: "OFF" }));
  fireEvent.click(
    within(first).getByRole("button", { name: "Save assignment" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("form")).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Assign shifts" }));
  await screen.findByRole("form", { name: "Assign shifts to selected dates" });
  fireEvent.click(screen.getByRole("button", { name: /Somchai, 2026-10-22/ }));
  await traverse("back");
  await screen.findByRole("dialog", { name: "Save changes before leaving?" });
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("button", { name: /Somchai, 2026-10-22/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(save).toHaveBeenCalledOnce();
});

it("roster month and employee filters keep the same page and are disabled while assigning", async () => {
  open(HrRosterScreen, "/en/hr/roster?keep=1#grid");
  fireEvent.change(screen.getByLabelText("Month"), { target: { value: "" } });
  expect(screen.getByRole("alert")).toHaveTextContent("Choose a valid month");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Month"), {
    target: { value: "2026-02" },
  });
  fireEvent.change(screen.getByLabelText("Employee code or name"), {
    target: { value: "Somchai" },
  });
  expect(here()).toBe("/en/hr/roster?keep=1#grid");
  fireEvent.click(screen.getByRole("button", { name: "Assign shifts" }));
  await screen.findByRole("form", { name: "Assign shifts to selected dates" });
  expect(screen.getByLabelText("Month")).toBeDisabled();
  expect(screen.getByLabelText("Employee code or name")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.getByLabelText("Month")).toBeEnabled());
  expect(screen.getByLabelText("Month")).toHaveValue("2026-02");
  expect(screen.getByLabelText("Employee code or name")).toHaveValue("Somchai");
});

it("header Back asks before discarding a roster selection, then the next Back restores the exact origin", async () => {
  window.history.replaceState(
    {},
    "",
    "/en/hr/settings?section=organization#team",
  );
  open(HrRosterScreen, "/en/hr/roster?keep=1#grid");
  fireEvent.click(screen.getByRole("button", { name: "Assign shifts" }));
  await screen.findByRole("form", { name: "Assign shifts to selected dates" });
  fireEvent.click(screen.getByRole("button", { name: /Somchai, 2026-10-21/ }));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByRole("dialog", { name: "Save changes before leaving?" });
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() => expect(here()).toBe("/en/hr/roster?keep=1#grid"));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await waitFor(() =>
    expect(here()).toBe("/en/hr/settings?section=organization#team"),
  );
});
