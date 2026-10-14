import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { hrRefs } from "@/lib/convex/hrApi";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "@tests/fixtures/convex-tenant-world";
import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  today: "2026-10-12",
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  savePreferences: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) =>
      args === "skip" ? undefined : state.queries[name(reference)],
    useMutation: (reference: Parameters<typeof name>[0]) => {
      switch (name(reference)) {
        case "hr/self:clockIn":
          return state.clockIn;
        case "hr/self:clockOut":
          return state.clockOut;
        case "hr/recovery:reconcileRequest":
          return state.reconcile;
        case "hr/preferences:save":
          return state.savePreferences;
        default:
          throw new Error(`Unexpected mutation: ${name(reference)}`);
      }
    },
  };
});
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: ["hr.self.access"],
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    today: state.today,
    identityKey: "org-fixture:user-fixture",
    sites: [],
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));

import { HrShortcutCustomizeScreen } from "@/features/hr/ShortcutCustomizeScreen";
import { HrTodayScreen } from "@/features/hr/TodayScreen";

const actor = { subject: "user_fixture_a", org_id: "org_fixture_a" };

async function fixture() {
  const world = await createConvexTenantWorld({
    "../convex/hr/self.ts": () => import("../../../convex/hr/self"),
    "../convex/hr/recovery.ts": () => import("../../../convex/hr/recovery"),
    "../convex/hr/preferences.ts": () =>
      import("../../../convex/hr/preferences"),
  });
  await seedConvexAuthorization(world, {
    roleA: "HR_EMPLOYEE",
    roleB: "HR_EMPLOYEE",
  });
  await world.t.run((ctx) =>
    ctx.db.insert("hrEmployees", {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      userId: world.userA,
      code: "PROBE-EMPLOYEE",
      displayName: "Recovery probe employee",
      employmentStartDate: "2020-01-01",
      status: "ACTIVE",
      version: 1,
      createdAt: 1,
      createdByUserId: world.userA,
      updatedAt: 1,
      updatedByUserId: world.userA,
    }),
  );
  return world.t.withIdentity(actor);
}

function customize() {
  return renderWithIntl(
    <DraftGuardProvider>
      <HrShortcutCustomizeScreen />
    </DraftGuardProvider>,
    { locale: "en", preserveProviders: true },
  );
}

beforeEach(() => {
  state.queries = {};
  state.today = "2026-10-12";
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/en/hr/today");
  // Freeze the actual backend clock without changing asynchronous RTL timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T02:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

it("a fresh clock-in after remount on the next day must record the new day", async () => {
  const backend = await fixture();
  state.queries[getFunctionName(hrRefs.today)] = await backend.query(
    hrRefs.today,
    {},
  );
  state.clockIn.mockImplementationOnce(async (args) => {
    await backend.mutation(hrRefs.clockIn, args);
    throw new Error("Clock-in committed; its response was lost");
  });
  const first = renderWithIntl(<HrTodayScreen />, { locale: "en" });
  fireEvent.click(screen.getByTestId("hr-clock-action"));
  await screen.findByTestId("hr-write-uncertain");
  const oldId = state.clockIn.mock.calls[0]![0].requestId;
  first.unmount();

  // A later visit can clock out normally; it uses a different operation scope.
  vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
  const closed = await backend.mutation(hrRefs.clockOut, {
    requestId: "probe_close_previous_day",
  });
  expect(closed).toMatchObject({ ok: true, value: { written: true } });

  vi.setSystemTime(new Date("2026-10-13T02:00:00Z"));
  state.today = "2026-10-13";
  state.queries[getFunctionName(hrRefs.today)] = await backend.query(
    hrRefs.today,
    {},
  );
  expect(state.queries[getFunctionName(hrRefs.today)]).toMatchObject({
    ok: true,
    value: { businessDate: "2026-10-13", nextAction: "CLOCK_IN" },
  });
  state.clockIn.mockImplementation((args) =>
    backend.mutation(hrRefs.clockIn, args),
  );
  renderWithIntl(<HrTodayScreen />, { locale: "en" });
  expect(screen.getByTestId("hr-clock-action")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Try again safely" }));
  await waitFor(() => expect(state.clockIn).toHaveBeenCalledTimes(2));
  await screen.findByText(/Recovered the clock for/);
  expect(screen.queryByTestId("hr-clock-saved")).toBeNull();
  expect(screen.queryByText("Saved")).toBeNull();
  expect(state.clockIn.mock.calls[1]![0].requestId).toBe(oldId);
  fireEvent.click(screen.getByTestId("hr-clock-action"));
  await waitFor(() => expect(state.clockIn).toHaveBeenCalledTimes(3));
  const answer = await state.clockIn.mock.results[2]!.value;
  await act(async () => {});
  const fresh = await backend.query(hrRefs.today, {});
  const receipt = screen.getByTestId("hr-clock-saved").textContent;
  expect(state.clockIn.mock.calls[2]![0].requestId).not.toBe(oldId);
  expect(receipt).toContain("13 October 2026");
  expect(answer).toMatchObject({
    ok: true,
    value: { written: true, businessDate: "2026-10-13", replayed: false },
  });
  expect(fresh).toMatchObject({ ok: true, value: { state: "CLOCKED_IN" } });
});

it("new preferences after a lost reply and remount must save as a new command", async () => {
  const backend = await fixture();
  state.queries[getFunctionName(hrRefs.shortcutPreferences)] =
    await backend.query(hrRefs.shortcutPreferences, {});
  state.savePreferences.mockImplementationOnce(async (args) => {
    await backend.mutation(hrRefs.saveShortcutPreferences, args);
    throw new Error("Preferences committed; their response was lost");
  });
  const first = customize();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show Profile" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByTestId("hr-write-uncertain");
  first.unmount();

  state.queries[getFunctionName(hrRefs.shortcutPreferences)] =
    await backend.query(hrRefs.shortcutPreferences, {});
  state.savePreferences.mockImplementation((args) =>
    backend.mutation(hrRefs.saveShortcutPreferences, args),
  );
  customize();
  expect(
    screen.getByRole("checkbox", { name: "Show Profile" }),
  ).not.toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Show Holidays" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Try again safely" }));
  await screen.findByText("Shortcut preferences saved.");
  expect(state.savePreferences.mock.calls[1]![0]).toEqual(
    state.savePreferences.mock.calls[0]![0],
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Show Holidays" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(state.savePreferences).toHaveBeenCalledTimes(3));
  const answer = await state.savePreferences.mock.results[2]!.value;
  expect(state.savePreferences.mock.calls[2]![0].requestId).not.toBe(
    state.savePreferences.mock.calls[0]![0].requestId,
  );
  await act(async () => {});
  expect(answer).toMatchObject({
    ok: true,
    value: { written: true, version: 2 },
  });
});

it("a clean shortcut editor must reflect a newer persisted query version", async () => {
  const backend = await fixture();
  state.queries[getFunctionName(hrRefs.shortcutPreferences)] =
    await backend.query(hrRefs.shortcutPreferences, {});
  const view = customize();
  expect(screen.getByRole("checkbox", { name: "Show Profile" })).toBeChecked();
  const current = await backend.query(hrRefs.shortcutPreferences, {});
  if (!current.ok || !current.value.ok) throw new Error("Fixture not linked");
  const external = await backend.mutation(hrRefs.saveShortcutPreferences, {
    requestId: "probe_external_preference_save",
    expectedVersion: current.value.version,
    shortcuts: current.value.shortcuts.map((item) => ({
      ...item,
      visible: item.key === "hr.profile" ? false : item.visible,
    })),
  });
  expect(external).toMatchObject({ ok: true, value: { written: true } });
  state.queries[getFunctionName(hrRefs.shortcutPreferences)] =
    await backend.query(hrRefs.shortcutPreferences, {});
  view.rerender(
    <DraftGuardProvider>
      <HrShortcutCustomizeScreen />
    </DraftGuardProvider>,
  );
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(
    screen.getByText("These menus match your saved preferences."),
  ).toBeVisible();
  expect(
    screen.getByRole("checkbox", { name: "Show Profile" }),
  ).not.toBeChecked();
});

it("legacy committed preferences reconcile before a fresh save without replaying them as a new command", async () => {
  const backend = await fixture();
  const current = await backend.query(hrRefs.shortcutPreferences, {});
  if (!current.ok || !current.value.ok) throw new Error("Fixture not linked");
  const oldPayload = {
    requestId: "legacy_preference_request",
    expectedVersion: current.value.version,
    shortcuts: current.value.shortcuts.map((item) => ({
      ...item,
      visible: item.key !== "hr.profile",
    })),
  };
  await backend.mutation(hrRefs.saveShortcutPreferences, oldPayload);
  sessionStorage.setItem(
    "hr-request:org-fixture:user-fixture|shortcut-preferences",
    JSON.stringify(oldPayload.requestId),
  );
  state.queries[getFunctionName(hrRefs.shortcutPreferences)] =
    await backend.query(hrRefs.shortcutPreferences, {});
  state.reconcile.mockImplementation((args) =>
    backend.mutation(hrRefs.reconcileRequest, args),
  );
  state.savePreferences.mockImplementation((args) =>
    backend.mutation(hrRefs.saveShortcutPreferences, args),
  );
  customize();
  expect(
    screen.getByRole("checkbox", { name: "Show Holidays" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Check previous write" }));
  await screen.findByText("The previous write was saved");
  expect(screen.queryByText("Shortcut preferences saved.")).toBeNull();
  expect(state.savePreferences).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show Holidays" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Shortcut preferences saved.");
  expect(state.savePreferences.mock.calls[0]![0].requestId).not.toBe(
    oldPayload.requestId,
  );
  expect(await backend.query(hrRefs.shortcutPreferences, {})).toMatchObject({
    ok: true,
    value: { version: 2 },
  });
});

it("legacy absent preferences are fenced before a fresh command so a late original cannot apply", async () => {
  const backend = await fixture();
  const current = await backend.query(hrRefs.shortcutPreferences, {});
  if (!current.ok || !current.value.ok) throw new Error("Fixture not linked");
  const oldPayload = {
    requestId: "legacy_queued_preference_request",
    expectedVersion: current.value.version,
    shortcuts: current.value.shortcuts.map((item) => ({
      ...item,
      visible: item.key !== "hr.profile",
    })),
  };
  sessionStorage.setItem(
    "hr-request:org-fixture:user-fixture|shortcut-preferences",
    JSON.stringify(oldPayload.requestId),
  );
  state.queries[getFunctionName(hrRefs.shortcutPreferences)] = current;
  state.reconcile.mockImplementation((args) =>
    backend.mutation(hrRefs.reconcileRequest, args),
  );
  state.savePreferences.mockImplementation((args) =>
    backend.mutation(hrRefs.saveShortcutPreferences, args),
  );
  customize();
  fireEvent.click(screen.getByRole("button", { name: "Check previous write" }));
  await screen.findByText("The previous write did not apply");
  fireEvent.click(screen.getByRole("checkbox", { name: "Show Holidays" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("Shortcut preferences saved.");
  expect(
    await backend.mutation(hrRefs.saveShortcutPreferences, oldPayload),
  ).toMatchObject({
    ok: true,
    value: { written: false, error: { code: "REQUEST_RETIRED" } },
  });
  expect(await backend.query(hrRefs.shortcutPreferences, {})).toMatchObject({
    ok: true,
    value: {
      version: 1,
      shortcuts: expect.arrayContaining([
        { key: "hr.profile", visible: true },
        { key: "hr.holidays", visible: false },
      ]),
    },
  });
});

it("a cold prior-day clock command with no server receipt is refused before a fresh day can be clocked", async () => {
  const backend = await fixture();
  vi.setSystemTime(new Date("2026-10-13T02:00:00Z"));
  state.today = "2026-10-13";
  state.queries[getFunctionName(hrRefs.today)] = await backend.query(
    hrRefs.today,
    {},
  );
  const today = state.queries[getFunctionName(hrRefs.today)] as {
    value: { employee: { id: string } };
  };
  const oldId = "cold_previous_clock_request";
  sessionStorage.setItem(
    `hr-request:org-fixture:user-fixture|clock:CLOCK_IN:${today.value.employee.id}`,
    JSON.stringify({
      version: 1,
      requestId: oldId,
      payload: { action: "CLOCK_IN", expectedBusinessDate: "2026-10-12" },
    }),
  );
  state.clockIn.mockImplementation((args) =>
    backend.mutation(hrRefs.clockIn, args),
  );
  renderWithIntl(<HrTodayScreen />, { locale: "en" });
  expect(screen.getByTestId("hr-clock-action")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Try again safely" }));
  await screen.findByTestId("hr-write-refused");
  expect(state.clockIn.mock.calls[0]![0]).toEqual({
    requestId: oldId,
    expectedBusinessDate: "2026-10-12",
  });
  expect(screen.queryByTestId("hr-clock-saved")).toBeNull();
  expect(await backend.query(hrRefs.today, {})).toMatchObject({
    ok: true,
    value: { nextAction: "CLOCK_IN" },
  });
  fireEvent.click(screen.getByTestId("hr-clock-action"));
  await screen.findByTestId("hr-clock-saved");
  expect(state.clockIn.mock.calls[1]![0].requestId).not.toBe(oldId);
  expect(await backend.query(hrRefs.today, {})).toMatchObject({
    ok: true,
    value: { businessDate: "2026-10-13", state: "CLOCKED_IN" },
  });
});

it("a pending clock settling after a next-day remount is displayed as the earlier day's receipt", async () => {
  const backend = await fixture();
  state.queries[getFunctionName(hrRefs.today)] = await backend.query(
    hrRefs.today,
    {},
  );
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.clockIn.mockImplementationOnce(async (args) => {
    const outcome = await backend.mutation(hrRefs.clockIn, args);
    await hold;
    return outcome;
  });
  const first = renderWithIntl(<HrTodayScreen />, { locale: "en" });
  fireEvent.click(screen.getByTestId("hr-clock-action"));
  await waitFor(() => expect(state.clockIn).toHaveBeenCalledOnce());
  // Wait until the backend write, rather than merely the mutation mock, finished.
  await waitFor(async () =>
    expect(await backend.query(hrRefs.today, {})).toMatchObject({
      ok: true,
      value: { state: "CLOCKED_IN" },
    }),
  );
  first.unmount();
  vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
  await backend.mutation(hrRefs.clockOut, {
    requestId: "pending_remount_close_day",
  });
  vi.setSystemTime(new Date("2026-10-13T02:00:00Z"));
  state.today = "2026-10-13";
  state.queries[getFunctionName(hrRefs.today)] = await backend.query(
    hrRefs.today,
    {},
  );
  renderWithIntl(<HrTodayScreen />, { locale: "en" });
  expect(screen.getByTestId("hr-clock-action")).toBeDisabled();
  await act(async () => release());
  await screen.findByText(/Recovered the clock for/);
  expect(screen.queryByTestId("hr-clock-saved")).toBeNull();
  expect(screen.queryByText("Saved")).toBeNull();
  expect(screen.getByTestId("hr-clock-action")).toBeEnabled();
  expect(state.clockIn).toHaveBeenCalledOnce();
});

it("a legacy clock ID reconciles without displaying an old receipt as today's success", async () => {
  const backend = await fixture();
  const oldId = "legacy_previous_clock_request";
  await backend.mutation(hrRefs.clockIn, { requestId: oldId });
  vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
  await backend.mutation(hrRefs.clockOut, {
    requestId: "legacy_clock_close_day",
  });
  vi.setSystemTime(new Date("2026-10-13T02:00:00Z"));
  state.today = "2026-10-13";
  state.queries[getFunctionName(hrRefs.today)] = await backend.query(
    hrRefs.today,
    {},
  );
  const today = state.queries[getFunctionName(hrRefs.today)] as {
    value: { employee: { id: string } };
  };
  sessionStorage.setItem(
    `hr-request:org-fixture:user-fixture|clock:CLOCK_IN:${today.value.employee.id}`,
    JSON.stringify(oldId),
  );
  state.reconcile.mockImplementation((args) =>
    backend.mutation(hrRefs.reconcileRequest, args),
  );
  state.clockIn.mockImplementation((args) =>
    backend.mutation(hrRefs.clockIn, args),
  );
  renderWithIntl(<HrTodayScreen />, { locale: "en" });
  expect(screen.getByTestId("hr-clock-action")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Check previous write" }));
  await screen.findByText("The previous write was saved");
  expect(screen.queryByTestId("hr-clock-saved")).toBeNull();
  expect(state.clockIn).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("hr-clock-action"));
  await screen.findByTestId("hr-clock-saved");
  expect(state.clockIn.mock.calls[0]![0].requestId).not.toBe(oldId);
  expect(await backend.query(hrRefs.today, {})).toMatchObject({
    ok: true,
    value: { businessDate: "2026-10-13", state: "CLOCKED_IN" },
  });
});

it("an incomplete clock receipt stays uncertain until retry recovers the scoped recorded event", async () => {
  const backend = await fixture();
  state.queries[getFunctionName(hrRefs.today)] = await backend.query(
    hrRefs.today,
    {},
  );
  state.clockIn
    .mockImplementationOnce(async (args) => {
      const saved = await backend.mutation(hrRefs.clockIn, args);
      if (!saved.ok || saved.value.written !== true)
        throw new Error("Fixture clock refused");
      return {
        ok: true,
        value: { written: true, documentId: saved.value.documentId },
      };
    })
    .mockImplementation((args) => backend.mutation(hrRefs.clockIn, args));
  renderWithIntl(<HrTodayScreen />, { locale: "en" });
  fireEvent.click(screen.getByTestId("hr-clock-action"));
  await screen.findByTestId("hr-write-uncertain");
  expect(screen.getByTestId("hr-clock-action")).toBeDisabled();
  expect(screen.queryByTestId("hr-clock-saved")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Try again safely" }));
  await screen.findByTestId("hr-clock-saved");
  expect(state.clockIn.mock.calls[1]![0]).toEqual(
    state.clockIn.mock.calls[0]![0],
  );
});

it("a pending preference receipt remounted before settlement supplies the next draft's expected version", async () => {
  const backend = await fixture();
  state.queries[getFunctionName(hrRefs.shortcutPreferences)] =
    await backend.query(hrRefs.shortcutPreferences, {});
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.savePreferences
    .mockImplementationOnce(async (args) => {
      const result = await backend.mutation(
        hrRefs.saveShortcutPreferences,
        args,
      );
      await hold;
      return result;
    })
    .mockImplementation((args) =>
      backend.mutation(hrRefs.saveShortcutPreferences, args),
    );
  const first = customize();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show Profile" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(async () =>
    expect(await backend.query(hrRefs.shortcutPreferences, {})).toMatchObject({
      ok: true,
      value: { version: 1 },
    }),
  );
  first.unmount();
  const second = customize();
  expect(screen.getByRole("checkbox", { name: "Show Profile" })).toBeDisabled();
  await act(async () => release());
  await screen.findByText("Shortcut preferences saved.");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(
    screen.getByRole("checkbox", { name: "Show Profile" }),
  ).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show Holidays" }));
  state.queries[getFunctionName(hrRefs.shortcutPreferences)] =
    await backend.query(hrRefs.shortcutPreferences, {});
  second.rerender(
    <DraftGuardProvider>
      <HrShortcutCustomizeScreen />
    </DraftGuardProvider>,
  );
  // The already-consumed receipt cannot erase a later edit on rerender.
  expect(
    screen.getByRole("checkbox", { name: "Show Holidays" }),
  ).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(state.savePreferences).toHaveBeenCalledTimes(2));
  const result = await state.savePreferences.mock.results[1]!.value;
  expect(state.savePreferences.mock.calls[1]![0].expectedVersion).toBe(1);
  expect(result).toMatchObject({
    ok: true,
    value: { written: true, version: 2 },
  });
});

it("a remounted pending preference receipt keeps newer reactive preferences authoritative before the next save", async () => {
  const backend = await fixture();
  state.queries[getFunctionName(hrRefs.shortcutPreferences)] =
    await backend.query(hrRefs.shortcutPreferences, {});
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.savePreferences
    .mockImplementationOnce(async (args) => {
      const result = await backend.mutation(
        hrRefs.saveShortcutPreferences,
        args,
      );
      await hold;
      return result;
    })
    .mockImplementation((args) =>
      backend.mutation(hrRefs.saveShortcutPreferences, args),
    );
  const first = customize();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show Profile" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(async () =>
    expect(await backend.query(hrRefs.shortcutPreferences, {})).toMatchObject({
      ok: true,
      value: { version: 1 },
    }),
  );
  const current = await backend.query(hrRefs.shortcutPreferences, {});
  if (!current.ok || !current.value.ok) throw new Error("Fixture not linked");
  await backend.mutation(hrRefs.saveShortcutPreferences, {
    requestId: "newer_preferences_before_reply",
    expectedVersion: 1,
    shortcuts: current.value.shortcuts.map((item) => ({
      ...item,
      visible: item.key !== "hr.holidays",
    })),
  });
  state.queries[getFunctionName(hrRefs.shortcutPreferences)] =
    await backend.query(hrRefs.shortcutPreferences, {});
  first.unmount();
  customize();
  expect(screen.getByRole("checkbox", { name: "Show Profile" })).toBeDisabled();
  await act(async () => release());
  await screen.findByText("Shortcut preferences saved.");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Show Profile" })).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Show Holidays" }),
  ).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show My requests" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(state.savePreferences).toHaveBeenCalledTimes(2));
  const result = await state.savePreferences.mock.results[1]!.value;
  expect(state.savePreferences.mock.calls[1]![0].expectedVersion).toBe(2);
  expect(result).toMatchObject({
    ok: true,
    value: { written: true, version: 3 },
  });
});

it.each([
  {
    name: "different latest choices",
    profile: true,
    holidays: false,
    editAfterCancel: "Show Profile",
  },
  {
    name: "matching latest choices",
    profile: false,
    holidays: true,
    editAfterCancel: "Show Holidays",
  },
])(
  "a recovered shortcut draft retains its original version after stale retry with $name until explicit Cancel",
  async ({ profile, holidays, editAfterCancel }) => {
    const backend = await fixture();
    const originalPreferences = await backend.query(
      hrRefs.shortcutPreferences,
      {},
    );
    if (!originalPreferences.ok || !originalPreferences.value.ok)
      throw new Error("Fixture not linked");
    state.queries[getFunctionName(hrRefs.shortcutPreferences)] =
      originalPreferences;
    // The original command was sent, but no server receipt exists. A lost reply
    // does not tell the client whether that command reached the backend.
    state.savePreferences.mockRejectedValueOnce(
      new Error("Original response was lost"),
    );
    const first = customize();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show Profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByTestId("hr-write-uncertain");
    const originalCommand = structuredClone(
      state.savePreferences.mock.calls[0]![0],
    );
    expect(originalCommand.expectedVersion).toBe(0);
    expect(await backend.query(hrRefs.shortcutPreferences, {})).toMatchObject({
      ok: true,
      value: { version: 0 },
    });
    first.unmount();

    const latestShortcuts = originalPreferences.value.shortcuts.map((item) => ({
      ...item,
      visible:
        item.key === "hr.profile"
          ? profile
          : item.key === "hr.holidays"
            ? holidays
            : item.visible,
    }));
    expect(
      await backend.mutation(hrRefs.saveShortcutPreferences, {
        requestId: `other_tab_preference_${profile ? "different" : "matching"}`,
        expectedVersion: 0,
        shortcuts: latestShortcuts,
      }),
    ).toMatchObject({ ok: true, value: { written: true, version: 1 } });
    state.queries[getFunctionName(hrRefs.shortcutPreferences)] =
      await backend.query(hrRefs.shortcutPreferences, {});
    state.savePreferences.mockImplementation((args) =>
      backend.mutation(hrRefs.saveShortcutPreferences, args),
    );
    customize();
    fireEvent.click(screen.getByRole("button", { name: "Try again safely" }));
    await screen.findByTestId("hr-shortcuts-stale");
    expect(state.savePreferences.mock.calls[1]![0]).toEqual(originalCommand);
    expect(await state.savePreferences.mock.results[1]!.value).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "PREFERENCES_STALE" } },
    });
    expect(
      screen.getByRole("checkbox", { name: "Show Profile" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Show Holidays" }),
    ).toBeChecked();

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(state.savePreferences).toHaveBeenCalledTimes(3));
    const nextCommand = state.savePreferences.mock.calls[2]![0];
    expect(nextCommand.requestId).not.toBe(originalCommand.requestId);
    expect(nextCommand.expectedVersion).toBe(originalCommand.expectedVersion);
    expect(nextCommand.shortcuts).toEqual(originalCommand.shortcuts);
    expect(await state.savePreferences.mock.results[2]!.value).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "PREFERENCES_STALE" } },
    });
    expect(await backend.query(hrRefs.shortcutPreferences, {})).toMatchObject({
      ok: true,
      value: { version: 1, shortcuts: latestShortcuts },
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("checkbox", { name: "Show Profile" }),
    ).toHaveProperty("checked", profile);
    expect(
      screen.getByRole("checkbox", { name: "Show Holidays" }),
    ).toHaveProperty("checked", holidays);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: editAfterCancel }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Shortcut preferences saved.");
    expect(state.savePreferences.mock.calls[3]![0].expectedVersion).toBe(1);
    expect(await backend.query(hrRefs.shortcutPreferences, {})).toMatchObject({
      ok: true,
      value: { version: 2 },
    });
  },
);
