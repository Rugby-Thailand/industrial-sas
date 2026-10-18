import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn(), replace: vi.fn() }));
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
    identityKey: "organization-qa|actor-qa",
    today: "2026-10-10",
    sites: [{ id: "site-qa", code: "QA", name: "QA Site" }],
  }),
  useHrCan: () => true,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: unknown }) => (
    <a href={href} {...props}>
      {children as never}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: state.replace }),
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

it("preserves an unsent period range when Search or a link asks to leave", async () => {
  openCreateForm();
  const from = screen.getByLabelText("From");
  fireEvent.change(from, { target: { value: "2026-02-02" } });
  const leave = vi.fn();
  act(() => guardedNavigate(leave));
  expect(leave).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
  expect(from).toHaveValue("2026-02-02");
  expect(state.create).not.toHaveBeenCalled();
});

it("holds navigation during creation and still opens the persisted period on success", async () => {
  let answer: ((value: unknown) => void) | undefined;
  state.create.mockReturnValue(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  openCreateForm();
  fireEvent.click(screen.getByTestId("hr-period-create"));
  await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));

  const leave = vi.fn();
  act(() => guardedNavigate(leave));
  expect(leave).not.toHaveBeenCalled();
  expect(await screen.findByTestId("navigation-guard-pending")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Discard changes" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

  const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  // SAVED arrives while the guard still holds the pending creation. The
  // period opens only after the buffer is removed, so the removal's Back can
  // never land on (and leave) the newly opened period page.
  await act(async () => {
    answer?.({
      ok: true,
      value: { written: true, documentId: "period-qa", replayed: false },
    });
  });
  expect(back).toHaveBeenCalledOnce();
  expect(state.push).not.toHaveBeenCalled();
  act(() => {
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: window.history.state }),
    );
  });
  expect(state.replace).toHaveBeenCalledExactlyOnceWith("/hr/periods/period-qa");
  // Later commits of the saved form do not remove anything again.
  await waitFor(() => expect(back).toHaveBeenCalledOnce());
  expect(window.history.state?.__storageWorkspaceGuard).toBeUndefined();
  act(() => guardedNavigate(leave));
  expect(leave).toHaveBeenCalledTimes(1);
  back.mockRestore();
});
