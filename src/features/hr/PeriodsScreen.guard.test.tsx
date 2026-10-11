import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn() }));
vi.mock("convex/react", () => ({
  useQuery: () => ({
    ok: true,
    requestId: "query",
    value: { items: [], complete: true },
  }),
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref).endsWith(":create") ? state.create : vi.fn(),
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: ["hr.period.close"],
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    identityKey: "org-a:user-a",
    today: "2026-10-10",
    sites: [{ id: "w1", code: "HQ", name: "Head office" }],
  }),
  useHrCan: () => true,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: unknown }) => (
    <a href={href} {...props}>
      {children as never}
    </a>
  ),
  useRouter: () => ({ push: state.push, replace: vi.fn() }),
}));

import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { guardedNavigate } from "@/lib/navigationGuard";

import { HrPeriodsScreen } from "./PeriodsScreen";

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/en/hr/periods");
});

function openCreateForm() {
  renderWithIntl(
    <DraftGuardProvider>
      <HrPeriodsScreen />
    </DraftGuardProvider>,
    { locale: "en" },
  );
  fireEvent.click(screen.getByTestId("hr-period-new"));
}
const settle = () =>
  act(() => {
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  });

it("asks nothing for an untouched form, and Discard restores the default range before leaving", async () => {
  openCreateForm();
  const from = screen.getByLabelText("From");
  // The suggested range (last month) is not unsent work.
  expect(from).toHaveValue("2026-09-01");
  const untouched = vi.fn();
  act(() => guardedNavigate(untouched));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(untouched).toHaveBeenCalledTimes(1);

  fireEvent.change(from, { target: { value: "2026-02-02" } });
  const leave = vi.fn();
  act(() => guardedNavigate(leave));
  expect(leave).not.toHaveBeenCalled();
  fireEvent.click(
    await screen.findByRole("button", { name: "Discard changes" }),
  );
  settle();
  expect(leave).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("From")).toHaveValue("2026-09-01");
  expect(screen.getByLabelText("To")).toHaveValue("2026-09-30");
  expect(state.create).not.toHaveBeenCalled();
});

it("leaves Cancel as the explicit way to abandon a changed range, without a prompt", () => {
  openCreateForm();
  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2026-02-02" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByTestId("hr-period-create")).not.toBeInTheDocument();
  // Nothing is left registered: the next navigation is free.
  const leave = vi.fn();
  act(() => guardedNavigate(leave));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  // The guard first removes its history buffer, then navigates.
  settle();
  expect(leave).toHaveBeenCalledTimes(1);
});

it("retries a lost creation as the same command for the same site and range, then opens the period", async () => {
  state.create
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValueOnce({
      ok: true,
      value: { written: true, documentId: "period-1", replayed: true },
    });
  openCreateForm();
  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2026-02-02" },
  });
  fireEvent.change(screen.getByLabelText("To"), {
    target: { value: "2026-02-08" },
  });
  fireEvent.click(screen.getByTestId("hr-period-create"));
  expect(await screen.findByTestId("hr-write-uncertain")).toBeVisible();
  expect(state.push).not.toHaveBeenCalled();
  // The range is fixed while the outcome is unknown.
  expect(screen.getByLabelText("From")).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "Try again safely" }));
  await waitFor(() =>
    expect(state.push).toHaveBeenCalledWith("/hr/periods/period-1"),
  );
  const [first, second] = state.create.mock.calls.map(
    (call) => call[0] as Record<string, string>,
  );
  expect(first).toMatchObject({
    warehouseId: "w1",
    startDate: "2026-02-02",
    endDate: "2026-02-08",
  });
  expect(first!.requestId).toBeTruthy();
  expect(second).toEqual(first);

  // Saved: the changed range no longer holds navigation.
  const leave = vi.fn();
  act(() => guardedNavigate(leave));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  settle();
  expect(leave).toHaveBeenCalledTimes(1);
});
