import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { guardedNavigate } from "@/lib/navigationGuard";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { thailandDefaults } from "../../../convex/model/hr/policy";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  preview: vi.fn(),
  access: {
    status: "READY",
    permissions: ["hr.self.access", "hr.team.review", "hr.admin.manage"],
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    today: "2026-10-12",
    identityKey: "org:user",
    sites: [],
  },
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({
    query: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
      state.preview(getFunctionName(ref), args),
  }),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    state.query(getFunctionName(ref), args),
  useMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      state.mutation(getFunctionName(ref), args),
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => state.access,
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/hr/leave",
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
import { HrPolicySettings } from "./HrPolicySettings";
import { HrLeaveScreen } from "./LeaveScreen";
import { HrLeaveDetailScreen } from "./LeaveDetailScreen";
import {
  HrLeaveReviewScreen,
  HrLeaveReviewDetailScreen,
} from "./LeaveReviewScreen";

const envelope = (value: unknown) => ({ ok: true, value });
const policy = () => ({
  ok: true,
  draft: {
    config: thailandDefaults(),
    effectiveDate: "2026-10-12",
    version: 0,
    preset: "TH_LPA_MINIMUM_2026_10_11",
  },
  active: null,
  sources: [],
  blockers: [],
  employees: [],
});
const leave = () => ({
  ok: true,
  employeeId: "employee-1",
  today: "2026-10-12",
  active: null,
  accounts: [],
  requests: [],
  requestsComplete: true,
  gate: "POLICY_NOT_ACTIVE",
  types: ["ANNUAL", "SICK", "PERSONAL"],
});
const request = (type = "ANNUAL") => ({
  _id: "request-1",
  employeeId: "employee-1",
  type,
  from: "2026-10-20",
  to: "2026-10-20",
  days: 1,
  paidDays: 1,
  payPercent: 100,
  reason: "Family appointment",
  status: "PENDING",
  version: 1,
  evidence: "",
  history: [],
  dates: ["2026-10-20"],
  employeeName: "Employee One",
  employeeCode: "EMP-1",
});
let testActor = 0;
beforeEach(() => {
  // Recovery belongs to the actor across remounts. Separate cases represent
  // separate actors so an intentionally uncertain command cannot lock them.
  state.access.identityKey = `org:user-${++testActor}`;
  window.history.replaceState({ appNavigationIndex: 0 }, "", "/en/hr/leave");
  state.query.mockReset();
  state.mutation.mockReset();
  state.preview.mockReset();
  state.preview.mockResolvedValue(envelope(chargePreview()));
  state.access.permissions = [
    "hr.self.access",
    "hr.team.review",
    "hr.admin.manage",
  ];
  state.mutation.mockResolvedValue(envelope({ written: true, version: 1 }));
});
afterEach(cleanup);

it("prefills Thai defaults but saving never activates a workflow", async () => {
  state.query.mockReturnValue(envelope(policy()));
  renderWithIntl(<HrPolicySettings />, { locale: "en" });
  expect(
    screen.getByLabelText(/Annual leave days per service year/),
  ).toHaveValue(6);
  expect(screen.getByLabelText(/Maternity days per pregnancy/)).toHaveValue(
    120,
  );
  expect(
    screen.getByRole("button", { name: "Activate saved draft" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(1));
  expect(state.mutation.mock.calls[0]?.[0]).toBe("hr/policies:saveDraft");
  expect(state.mutation.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({
      capability: "LEAVE",
      expectedVersion: 0,
      config: expect.objectContaining({
        annualDays: 6,
        maternityDays: 120,
        maternityPaidDays: 60,
      }),
    }),
  );
  expect(
    screen.getByRole("button", { name: "Activate saved draft" }),
  ).toBeDisabled();
});
it("rejects below-minimum values before sending a draft", async () => {
  state.query.mockReturnValue(envelope(policy()));
  renderWithIntl(<HrPolicySettings />, { locale: "en" });
  fireEvent.change(
    screen.getByLabelText(/Annual leave days per service year/),
    { target: { value: "5" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect(
    screen.getByText(
      "Check required dates, whole-day values and the legal minimums.",
    ),
  ).toBeInTheDocument();
  expect(state.mutation).not.toHaveBeenCalled();
});
it("requires explicit opening usage instead of assuming an unused balance", () => {
  const value = policy();
  const employee = {
    id: "employee",
    code: "EMP-1",
    displayName: "Employee One",
    warehouseId: "site",
    employmentStartDate: "2024-10-12",
    accounts: [],
  };
  state.query.mockReturnValue(
    envelope({
      ...value,
      employees: [employee],
      blockers: ["OPENING_REQUIRED:EMP-1:ANNUAL"],
    }),
  );
  renderWithIntl(<HrPolicySettings />, { locale: "en" });
  const disclosure = screen.getByText("Reconcile opening leave balances");
  fireEvent.click(disclosure);
  expect(screen.getByLabelText(/Granted days/)).toHaveValue(null);
  expect(screen.getByLabelText(/Used days/)).toHaveValue(null);
  expect(screen.getByLabelText(/Pending reserved days/)).toHaveValue(null);
  fireEvent.click(
    screen.getByRole("button", { name: "Save reconciled balance" }),
  );
  expect(state.mutation).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Activate saved draft" }),
  ).toBeDisabled();
});
it("keeps leave requests gated and displays no synthetic balances", () => {
  state.query.mockReturnValue(envelope(leave()));
  renderWithIntl(<HrLeaveScreen />, { locale: "en" });
  expect(screen.getByTestId("hr-leave-gate")).toBeInTheDocument();
  expect(
    screen.getByText("HR has not reconciled your leave accounts."),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Submit request" }),
  ).not.toBeInTheDocument();
  expect(state.mutation).not.toHaveBeenCalled();
});
it("shows exhausted sick pay separately while keeping sick requests available", () => {
  const account = {
    type: "SICK",
    granted: 30,
    used: 32,
    reserved: 1,
    paidUsed: 30,
    paidReserved: 0,
    available: 0,
    paidAvailable: 0,
  };
  state.query.mockReturnValue(
    envelope({
      ...leave(),
      gate: null,
      active: { version: 1 },
      accounts: [account],
    }),
  );
  renderWithIntl(<HrLeaveScreen />, { locale: "en" });
  expect(screen.getByRole("button", { name: "Submit request" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Preview leave charges" }),
  ).toBeEnabled();
  const card = screen
    .getByRole("heading", { name: "Sick leave" })
    .closest("section");
  expect(card).not.toBeNull();
  expect(
    within(card!).getByText("Paid days remaining").nextElementSibling,
  ).toHaveTextContent("0");
});
it("retries a lost leave submission with the same request ID and payload", async () => {
  state.query.mockReturnValue(
    envelope({ ...leave(), gate: null, active: { version: 1 } }),
  );
  state.mutation.mockRejectedValueOnce(new Error("Lost response"));
  renderWithIntl(<HrLeaveScreen />, { locale: "en" });
  fireEvent.change(screen.getByLabelText(/Start date/), {
    target: { value: "2026-10-20" },
  });
  fireEvent.change(screen.getByLabelText(/End date/), {
    target: { value: "2026-10-20" },
  });
  fireEvent.change(screen.getByLabelText(/Reason/), {
    target: { value: "Family appointment" },
  });
  await previewAndConfirm();
  fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  await waitFor(() => expect(screen.getByLabelText(/Reason/)).toBeDisabled());
  const command = state.mutation.mock.calls[0];
  const uncertain = await screen.findByTestId("hr-write-uncertain");
  fireEvent.click(within(uncertain).getByRole("button"));
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(2));
  expect(state.mutation.mock.calls[1]).toEqual(command);
  await waitFor(() => expect(screen.getByLabelText(/Reason/)).toHaveValue(""));
});
/** One ready page of the paged leave review queue. */
const queuePage = (page: readonly unknown[]) => ({
  ok: true,
  status: "ready",
  page,
  isDone: true,
  continueCursor: "",
  scanned: page.length,
});
it("requires a reason for a returned annual request and cannot return statutory sick leave", () => {
  state.query.mockReturnValue(envelope(queuePage([request()])));
  const view = renderWithIntl(<HrLeaveReviewScreen />, {
    locale: "en",
    preserveProviders: true,
  });
  expect(
    screen.getByRole("button", { name: "Return with reason" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Decision reason/), {
    target: { value: "Please select scheduled days" },
  });
  expect(
    screen.getByRole("button", { name: "Return with reason" }),
  ).toBeEnabled();
  state.query.mockReturnValue(envelope(queuePage([request("SICK")])));
  view.rerender(<HrLeaveReviewScreen />);
  expect(
    screen.getByRole("button", { name: "Return with reason" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
});
it("does not query employee leave without self-service access", () => {
  state.access.permissions = [];
  renderWithIntl(<HrLeaveScreen />, { locale: "th" });
  expect(screen.getByTestId("hr-denied")).toBeInTheDocument();
  expect(state.query).not.toHaveBeenCalled();
});

it("activates only a saved draft after HR confirms coverage and benefits", async () => {
  state.query.mockReturnValue(
    envelope({ ...policy(), draft: { ...policy().draft, version: 2 } }),
  );
  renderWithIntl(<HrPolicySettings />, { locale: "en" });
  const activate = screen.getByRole("button", { name: "Activate saved draft" });
  expect(activate).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/I confirmed this policy applies/));
  expect(activate).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/I reviewed existing benefits/));
  expect(activate).toBeEnabled();
  fireEvent.click(activate);
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(1));
  expect(state.mutation.mock.calls[0]?.[0]).toBe("hr/policies:activate");
  expect(state.mutation.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({
      expectedVersion: 2,
      coverageConfirmed: true,
      existingBenefitsReviewed: true,
    }),
  );
});
it("restores only explicitly selected approved dates through the audited HR API", async () => {
  state.query.mockReturnValue(
    envelope({
      ok: true,
      request: {
        ...request(),
        status: "APPROVED",
        dates: ["2026-10-20", "2026-10-21"],
        to: "2026-10-21",
        days: 2,
        paidDays: 2,
      },
      employeeName: "Employee One",
      employeeCode: "EMP-1",
      canAdjust: true,
    }),
  );
  renderWithIntl(<HrLeaveReviewDetailScreen requestId="request-1" />, {
    locale: "en",
  });
  expect(
    screen.queryByRole("button", { name: "Approve" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("checkbox")[0]!);
  fireEvent.change(screen.getByLabelText(/Decision reason/), {
    target: { value: "Employee returned to work" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save audited adjustment" }),
  );
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(1));
  expect(state.mutation.mock.calls[0]?.[0]).toBe("hr/leave:adjust");
  expect(state.mutation.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({
      leaveRequestId: "request-1",
      expectedVersion: 1,
      restoreDates: ["2026-10-20"],
      reason: "Employee returned to work",
    }),
  );
});

function chargePreview(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    previewHash: "preview-1",
    type: "ANNUAL",
    dates: ["2026-10-20"],
    days: 1,
    paidDays: 1,
    payPercent: 100,
    daySnapshots: [],
    policyVersionId: "policy-1",
    ...overrides,
  };
}
function fillLeave() {
  fireEvent.change(screen.getByLabelText(/Start date/), {
    target: { value: "2026-10-20" },
  });
  fireEvent.change(screen.getByLabelText(/End date/), {
    target: { value: "2026-10-20" },
  });
  fireEvent.change(screen.getByLabelText(/Reason/), {
    target: { value: "Family appointment" },
  });
}
async function previewAndConfirm() {
  fireEvent.click(
    screen.getByRole("button", { name: "Preview leave charges" }),
  );
  const confirm = await screen.findByLabelText(
    "I checked the charged dates and pay.",
  );
  fireEvent.click(confirm);
}
function openLeave() {
  state.query.mockReturnValue(
    envelope({ ...leave(), gate: null, active: { version: 1 } }),
  );
  renderWithIntl(<HrLeaveScreen />, { locale: "en" });
  fillLeave();
}
it("requires an explicit server charge preview and confirmation before reserving leave", async () => {
  openLeave();
  expect(screen.getByRole("button", { name: "Submit request" })).toBeDisabled();
  expect(state.mutation).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Preview leave charges" }),
  );
  const confirm = await screen.findByLabelText(
    "I checked the charged dates and pay.",
  );
  expect(state.preview).toHaveBeenCalledWith("hr/leave:preview", {
    type: "ANNUAL",
    from: "2026-10-20",
    to: "2026-10-20",
    reason: "Family appointment",
  });
  expect(screen.getByRole("button", { name: "Submit request" })).toBeDisabled();
  expect(
    within(screen.getByTestId("hr-leave-preview")).getByText("2026-10-20"),
  ).toBeInTheDocument();
  fireEvent.click(confirm);
  fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  await waitFor(() =>
    expect(state.mutation).toHaveBeenCalledWith(
      "hr/leave:submit",
      expect.objectContaining({ expectedPreviewHash: "preview-1" }),
    ),
  );
});
it("discards a confirmed preview after any draft change", async () => {
  openLeave();
  await previewAndConfirm();
  expect(screen.getByRole("button", { name: "Submit request" })).toBeEnabled();
  fireEvent.change(screen.getByLabelText(/Evidence \/ medical explanation/), {
    target: { value: "Updated explanation" },
  });
  expect(screen.queryByTestId("hr-leave-preview")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Submit request" })).toBeDisabled();
  expect(state.mutation).not.toHaveBeenCalled();
});
it("ignores a late preview for an older draft", async () => {
  let resolve!: (value: unknown) => void;
  state.preview.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  openLeave();
  fireEvent.click(
    screen.getByRole("button", { name: "Preview leave charges" }),
  );
  fireEvent.change(screen.getByLabelText(/Reason/), {
    target: { value: "Changed appointment" },
  });
  resolve(envelope(chargePreview()));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Preview leave charges" }),
    ).toBeEnabled(),
  );
  expect(screen.queryByTestId("hr-leave-preview")).not.toBeInTheDocument();
  expect(state.mutation).not.toHaveBeenCalled();
});
it("requires a new preview after the server refuses stale calculated charges", async () => {
  openLeave();
  state.mutation.mockResolvedValueOnce(
    envelope({ written: false, error: { code: "LEAVE_PREVIEW_STALE" } }),
  );
  await previewAndConfirm();
  fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  await screen.findByText(
    "Your policy, balance or schedule changed. Preview again before submitting.",
  );
  expect(screen.getByRole("button", { name: "Submit request" })).toBeDisabled();
  expect(screen.queryByTestId("hr-leave-preview")).not.toBeInTheDocument();
});
it("shows the split-period refusal without sending a mutation", async () => {
  openLeave();
  state.preview.mockResolvedValueOnce(
    envelope({ ok: false, code: "LEAVE_SPLIT_PERIOD_REQUIRED" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Preview leave charges" }),
  );
  await screen.findByText(
    "These dates cross a leave entitlement period. Split them into separate requests.",
  );
  expect(state.mutation).not.toHaveBeenCalled();
});
it("resubmits a returned request with its original ID, version and exact uncertain command", async () => {
  state.query.mockReturnValue(
    envelope({
      ok: true,
      item: { ...request(), status: "RETURNED", version: 4 },
      today: "2026-10-12",
      revisions: [],
    }),
  );
  state.mutation.mockRejectedValueOnce(new Error("Lost response"));
  renderWithIntl(<HrLeaveDetailScreen requestId="request-1" />, {
    locale: "en",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Edit returned request" }),
  );
  expect(screen.getByLabelText(/Reason/)).toHaveValue("Family appointment");
  await previewAndConfirm();
  expect(state.preview).toHaveBeenCalledWith(
    "hr/leave:preview",
    expect.objectContaining({
      leaveRequestId: "request-1",
      expectedVersion: 4,
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Resubmit returned request" }),
  );
  const uncertain = await screen.findByTestId("hr-write-uncertain");
  const command = state.mutation.mock.calls[0];
  expect(command).toEqual([
    "hr/leave:resubmit",
    expect.objectContaining({
      leaveRequestId: "request-1",
      expectedVersion: 4,
      expectedPreviewHash: "preview-1",
    }),
  ]);
  expect(screen.getByLabelText(/Reason/)).toBeDisabled();
  fireEvent.click(within(uncertain).getByRole("button"));
  await waitFor(() => expect(state.mutation.mock.calls[1]).toEqual(command));
});
it("loads an exact retained employee request and previous submitted snapshot independently of active policy", () => {
  state.query.mockReturnValue(
    envelope({
      ok: true,
      item: request(),
      today: "2026-10-12",
      revisions: [
        {
          version: 1,
          archivedAt: 1,
          snapshot: {
            ...request(),
            reason: "Original submission",
            status: "RETURNED",
          },
        },
      ],
    }),
  );
  renderWithIntl(<HrLeaveDetailScreen requestId="request-1" />, {
    locale: "en",
  });
  expect(state.query).toHaveBeenCalledWith("hr/leave:selfDetail", {
    leaveRequestId: "request-1",
  });
  expect(screen.getByText("Original submission")).toBeInTheDocument();
  expect(screen.getByText("Version 1")).toBeInTheDocument();
  expect(
    state.query.mock.calls.every(([name]) => name !== "hr/policies:current"),
  ).toBe(true);
});
it("shows loading and refused exact-detail states and does not query when denied", () => {
  state.query.mockReturnValue(undefined);
  const view = renderWithIntl(<HrLeaveDetailScreen requestId="request-1" />, {
    locale: "en",
    preserveProviders: true,
  });
  expect(screen.queryByText("Family appointment")).not.toBeInTheDocument();
  state.query.mockReturnValue(envelope({ ok: false, code: "NOT_FOUND" }));
  view.rerender(<HrLeaveDetailScreen requestId="request-1" />);
  expect(screen.getByTestId("hr-error")).toBeInTheDocument();
  state.query.mockClear();
  state.access.permissions = [];
  view.rerender(<HrLeaveDetailScreen requestId="request-1" />);
  expect(screen.getByTestId("hr-denied")).toBeInTheDocument();
  expect(state.query).not.toHaveBeenCalled();
});

it.each(["first submission", "returned resubmission"])(
  "blocks in-flight navigation but releases uncertain %s without discarding its retry",
  async (mode) => {
    let reject!: (error: Error) => void;
    state.mutation.mockReturnValueOnce(
      new Promise((_resolve, refuse) => {
        reject = refuse;
      }),
    );
    const returned = mode === "returned resubmission";
    state.query.mockReturnValue(
      returned
        ? envelope({
            ok: true,
            item: { ...request(), status: "RETURNED", version: 4 },
            today: "2026-10-12",
            revisions: [],
          })
        : envelope({ ...leave(), gate: null, active: { version: 1 } }),
    );
    renderWithIntl(
      <NavigationGuardProvider>
        {returned ? (
          <HrLeaveDetailScreen requestId="request-1" />
        ) : (
          <HrLeaveScreen />
        )}
      </NavigationGuardProvider>,
      { locale: "en" },
    );
    if (returned)
      fireEvent.click(
        screen.getByRole("button", { name: "Edit returned request" }),
      );
    else fillLeave();
    await previewAndConfirm();
    fireEvent.click(
      screen.getByRole("button", {
        name: returned ? "Resubmit returned request" : "Submit request",
      }),
    );
    await waitFor(() => expect(state.mutation).toHaveBeenCalledOnce());
    const leavePage = vi.fn();
    act(() => guardedNavigate(leavePage));
    expect(screen.getByTestId("navigation-guard-pending")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    const command = state.mutation.mock.calls[0];
    reject(new Error("Lost response"));
    const uncertain = await screen.findByTestId("hr-write-uncertain");
    // The uncertain draft no longer blocks leaving; its retry stays pinned.
    act(() => guardedNavigate(leavePage));
    await waitFor(() => expect(leavePage).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Reason/)).toBeDisabled();
    fireEvent.click(within(uncertain).getByRole("button"));
    await waitFor(() => expect(state.mutation.mock.calls[1]).toEqual(command));
  },
);

it("drops a confirmed preview and draft when the canonical employee link changes", async () => {
  state.query.mockReturnValue(
    envelope({ ...leave(), gate: null, active: { version: 1 } }),
  );
  const view = renderWithIntl(<HrLeaveScreen />, {
    locale: "en",
    preserveProviders: true,
  });
  fillLeave();
  await previewAndConfirm();
  expect(screen.getByRole("button", { name: "Submit request" })).toBeEnabled();
  state.query.mockReturnValue(
    envelope({
      ...leave(),
      employeeId: "employee-2",
      gate: null,
      active: { version: 1 },
    }),
  );
  view.rerender(<HrLeaveScreen />);
  expect(screen.getByLabelText(/Reason/)).toHaveValue("");
  expect(screen.queryByTestId("hr-leave-preview")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Submit request" })).toBeDisabled();
  expect(state.mutation).not.toHaveBeenCalled();
});
it("never reuses an uncertain request ID or receipt on a newly linked employee", async () => {
  state.query.mockReturnValue(
    envelope({ ...leave(), gate: null, active: { version: 1 } }),
  );
  state.mutation.mockRejectedValueOnce(new Error("Lost original response"));
  const view = renderWithIntl(<HrLeaveScreen />, {
    locale: "en",
    preserveProviders: true,
  });
  fillLeave();
  await previewAndConfirm();
  fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  await screen.findByTestId("hr-write-uncertain");
  const oldId = state.mutation.mock.calls[0]?.[1].requestId;
  state.query.mockReturnValue(
    envelope({
      ...leave(),
      employeeId: "employee-2",
      gate: null,
      active: { version: 1 },
    }),
  );
  view.rerender(<HrLeaveScreen />);
  expect(screen.queryByTestId("hr-write-uncertain")).not.toBeInTheDocument();
  expect(screen.queryByTestId("hr-write-saved")).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Reason/)).toHaveValue("");
  expect(screen.getByLabelText(/Reason/)).toBeEnabled();
  fillLeave();
  await previewAndConfirm();
  fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(2));
  expect(state.mutation.mock.calls[1]?.[1].requestId).not.toBe(oldId);
});

it("native Back protects returned-leave editing and consumes it after explicit discard before restoring the caller", async () => {
  state.query.mockReturnValue(
    envelope({
      ok: true,
      item: { ...request(), status: "RETURNED", version: 4 },
      today: "2026-10-12",
      revisions: [],
    }),
  );
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/th/hr/leave?status=returned#list",
  );
  const stop = trackAppHistory();
  try {
    window.history.pushState({}, "", "/en/hr/leave/request-1?kept=yes#request");
    renderWithIntl(
      <NavigationGuardProvider>
        <HrLeaveDetailScreen requestId="request-1" />
      </NavigationGuardProvider>,
      { locale: "en" },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Edit returned request" }),
    );
    expect(screen.getByLabelText(/Reason/)).toHaveValue("Family appointment");
    await act(async () => {
      window.history.back();
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Keep editing" }),
    );
    expect(screen.getByLabelText(/Reason/)).toHaveValue("Family appointment");
    await act(async () => {
      window.history.back();
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Discard changes" }),
    );
    await waitFor(() => expect(screen.queryByLabelText(/Reason/)).toBeNull());
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/en/hr/leave/request-1?kept=yes#request");
    await act(async () => {
      window.history.back();
    });
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/th/hr/leave?status=returned#list"),
    );
  } finally {
    stop();
  }
});

it.each(["native", "explicit"] as const)(
  "%s leave-history close retains the unsent request and the next Back protects that draft",
  async (method) => {
    state.query.mockImplementation((name: string) =>
      name === "hr/leave:history"
        ? envelope({ ok: true, page: [], isDone: true, continueCursor: "" })
        : envelope({ ...leave(), gate: null, requestsComplete: false }),
    );
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/th/hr/today?q=kept#origin",
    );
    const stop = trackAppHistory();
    try {
      window.history.pushState({}, "", "/en/hr/leave?kept=yes#form");
      renderWithIntl(
        <NavigationGuardProvider>
          <HrLeaveScreen />
        </NavigationGuardProvider>,
        { locale: "en" },
      );
      fireEvent.change(screen.getByLabelText(/Reason/), {
        target: { value: "Retained request" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Browse all leave requests" }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      await act(async () => {
        if (method === "native") window.history.back();
        else
          fireEvent.click(
            screen.getByRole("button", { name: "Return to recent requests" }),
          );
      });
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Return to recent requests" }),
        ).toBeNull(),
      );
      expect(screen.getByLabelText(/Reason/)).toHaveValue("Retained request");
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/en/hr/leave?kept=yes#form");
      await act(async () => {
        window.history.back();
      });
      expect(
        await screen.findByRole("button", { name: "Keep editing" }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/Reason/)).toHaveValue("Retained request");
    } finally {
      stop();
    }
  },
);
