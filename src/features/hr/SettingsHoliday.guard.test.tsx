import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const writes = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => ({
    ok: true,
    requestId: "query",
    value: getFunctionName(ref).endsWith(":accessMembers")
      ? { ok: true, provisioned: true, items: [] }
      : { ok: true, items: [], complete: true },
  }),
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref).endsWith(":saveHoliday") ? writes.save : vi.fn(),
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: ["hr.admin.manage"],
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    identityKey: "org-a:user-a",
    sites: [{ id: "w1", code: "HQ", name: "Head office" }],
  }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { guardedNavigate } from "@/lib/navigationGuard";

import { HrSettingsScreen } from "./SettingsScreen";

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/en/hr/settings");
});

const saved = {
  ok: true,
  value: { written: true, documentId: "holiday-1", replayed: false },
};
const settle = () =>
  act(() => {
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  });
function openSettings() {
  renderWithIntl(
    <DraftGuardProvider>
      <HrSettingsScreen />
    </DraftGuardProvider>,
    { locale: "en" },
  );
  return {
    date: screen.getByLabelText(/^Date/),
    name: screen.getByLabelText(/Name or reason/),
  };
}

it("stops showing the last save once the next holiday is typed, and Discard clears that draft before leaving", async () => {
  writes.save.mockResolvedValue(saved);
  const { date, name } = openSettings();
  fireEvent.change(date, { target: { value: "2026-02-03" } });
  fireEvent.change(name, { target: { value: "First holiday" } });
  fireEvent.click(screen.getByTestId("hr-holiday-add"));
  expect(await screen.findByText("Saved")).toBeVisible();
  expect(name).toHaveValue("");
  settle();

  // A saved, empty form holds nothing.
  const free = vi.fn();
  act(() => guardedNavigate(free));
  settle();
  expect(free).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Saved")).toBeVisible();

  // The date alone starts the next draft.
  fireEvent.change(date, { target: { value: "2026-02-04" } });
  expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  const leave = vi.fn();
  act(() => guardedNavigate(leave));
  expect(leave).not.toHaveBeenCalled();
  fireEvent.click(
    await screen.findByRole("button", { name: "Discard changes" }),
  );
  settle();
  expect(leave).toHaveBeenCalledTimes(1);
  expect(date).toHaveValue("");
  expect(name).toHaveValue("");
  expect(writes.save).toHaveBeenCalledTimes(1);
});

it("still retries a lost holiday save as the same command, then guards the following draft", async () => {
  writes.save
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValue(saved);
  const { date, name } = openSettings();
  fireEvent.change(date, { target: { value: "2026-02-03" } });
  fireEvent.change(name, { target: { value: "First holiday" } });
  fireEvent.click(screen.getByTestId("hr-holiday-add"));
  expect(await screen.findByTestId("hr-write-uncertain")).toBeVisible();
  // Fixed while the outcome is unknown, with the entry still shown.
  expect(date).toBeDisabled();
  expect(name).toBeDisabled();
  expect(name).toHaveValue("First holiday");

  fireEvent.click(screen.getByRole("button", { name: "Try again safely" }));
  await waitFor(() => expect(writes.save).toHaveBeenCalledTimes(2));
  const [first, second] = writes.save.mock.calls.map(
    (call) => call[0] as Record<string, string>,
  );
  expect(first).toMatchObject({
    warehouseId: "w1",
    date: "2026-02-03",
    name: "First holiday",
  });
  expect(first!.requestId).toBeTruthy();
  expect(second).toEqual(first);
  await waitFor(() => expect(name).toHaveValue(""));
  settle();

  fireEvent.change(name, { target: { value: "Second holiday" } });
  const leave = vi.fn();
  act(() => guardedNavigate(leave));
  expect(leave).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
  expect(name).toHaveValue("Second holiday");

  // The next save is a new command, not a replay of the first.
  fireEvent.change(date, { target: { value: "2026-02-04" } });
  fireEvent.click(screen.getByTestId("hr-holiday-add"));
  await waitFor(() => expect(writes.save).toHaveBeenCalledTimes(3));
  const third = writes.save.mock.calls[2]![0] as Record<string, string>;
  expect(third).toMatchObject({ date: "2026-02-04", name: "Second holiday" });
  expect(third.requestId).not.toBe(first!.requestId);
});
