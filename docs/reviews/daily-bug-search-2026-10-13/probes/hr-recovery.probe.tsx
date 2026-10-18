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
    "../convex/hr/self.ts": () => import("../../../../convex/hr/self"),
    "../convex/hr/preferences.ts": () =>
      import("../../../../convex/hr/preferences"),
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
  // Diagnostic control only: remove the orphaned ID, without changing source.
  if (process.env.DAILY_BUG_CONTROL === "fresh-intent") sessionStorage.clear();

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
  fireEvent.click(screen.getByTestId("hr-clock-action"));
  await waitFor(() => expect(state.clockIn).toHaveBeenCalledTimes(2));
  const answer = await state.clockIn.mock.results[1]!.value;
  await act(async () => {});
  const fresh = await backend.query(hrRefs.today, {});
  const receipt = screen.getByTestId("hr-clock-saved").textContent;
  console.info("CLOCK_RECOVERY_EVIDENCE", {
    reusedOldId: state.clockIn.mock.calls[1]![0].requestId === oldId,
    answer,
    fresh,
    receipt,
  });
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
  if (process.env.DAILY_BUG_CONTROL === "fresh-intent") sessionStorage.clear();

  state.queries[getFunctionName(hrRefs.shortcutPreferences)] =
    await backend.query(hrRefs.shortcutPreferences, {});
  state.savePreferences.mockImplementation((args) =>
    backend.mutation(hrRefs.saveShortcutPreferences, args),
  );
  customize();
  expect(
    screen.getByRole("checkbox", { name: "Show Profile" }),
  ).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "Show Holidays" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(state.savePreferences).toHaveBeenCalledTimes(2));
  const answer = await state.savePreferences.mock.results[1]!.value;
  await act(async () => {});
  console.info("PREFERENCES_RECOVERY_EVIDENCE", answer);
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
      <HrShortcutCustomizeScreen
        key={
          process.env.DAILY_BUG_CONTROL === "remount-clean" ? "new" : undefined
        }
      />
    </DraftGuardProvider>,
  );
  console.info("CLEAN_EDITOR_EVIDENCE", {
    query: state.queries[getFunctionName(hrRefs.shortcutPreferences)],
    profileChecked: (
      screen.getByRole("checkbox", {
        name: "Show Profile",
      }) as HTMLInputElement
    ).checked,
  });
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(
    screen.getByText("These menus match your saved preferences."),
  ).toBeVisible();
  expect(
    screen.getByRole("checkbox", { name: "Show Profile" }),
  ).not.toBeChecked();
});
