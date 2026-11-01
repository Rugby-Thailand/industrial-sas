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
import { chooseOption } from "@tests/fixtures/select-control";

// Component/caller tests of the real Employees screen and editor with the
// Convex client mocked at the hook boundary. They are not browser or backend
// end-to-end tests; registered backend behavior is covered in
// tests/integration/hr-parity/03-employee-offboard.test.ts.

const state = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  args: new Map<string, unknown>(),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
  identityKey: "org-a:user-a",
}));
vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) => {
      if (args === "skip") return undefined;
      state.args.set(name(reference), args);
      return state.queries.get(name(reference));
    },
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
    timezoneSupported: true,
    timezone: "Asia/Bangkok",
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
import { HrEmployeesScreen } from "@/features/hr/EmployeesScreen";

const employee = {
  id: "e7",
  code: "EMP-007",
  displayName: "Somsak",
  status: "ACTIVE",
  employmentState: "ACTIVE",
  siteId: "w1",
  siteCode: "HQ",
  linkedActive: false,
  employmentStartDate: "2026-01-05",
  version: 4,
};
const former = {
  ...employee,
  id: "e8",
  code: "EMP-008",
  displayName: "Malee",
  status: "INACTIVE",
  employmentState: "RESIGNED",
  employmentEndDate: "2026-09-30",
  separation: { type: "RESIGNATION", lastWorkingDate: "2026-09-30" },
};
const query = (value: unknown) => ({ ok: true, requestId: "q", value });
const page = (rows: unknown[]) =>
  query({
    ok: true,
    status: "ready",
    page: rows,
    continueCursor: "",
    isDone: true,
  });
const saved = (documentId: string) => ({
  ok: true,
  value: { written: true, documentId, replayed: false },
});
const mutation = (reference: Parameters<typeof getFunctionName>[0]) => {
  const key = getFunctionName(reference);
  if (!state.mutations.has(key)) state.mutations.set(key, vi.fn());
  return state.mutations.get(key)!;
};
const lifecycle = (overrides: Record<string, unknown> = {}) =>
  query({
    ok: true,
    today: "2026-10-20",
    state: "ACTIVE",
    version: 4,
    employmentStartDate: "2026-01-05",
    complete: true,
    events: [],
    ...overrides,
  });

let stopTracking: () => void;
let actor = 0;
beforeEach(() => {
  state.identityKey = `org-a:user-${++actor}`;
  state.queries.clear();
  state.args.clear();
  state.mutations.clear();
  window.sessionStorage.clear();
  state.queries.set(getFunctionName(hrRefs.employeesPage), page([employee]));
  state.queries.set(
    getFunctionName(hrRefs.employee),
    query({ ok: true, employee }),
  );
  state.queries.set(getFunctionName(hrRefs.memberOptionsPage), page([]));
  state.queries.set(
    getFunctionName(hrRefs.employeeProfile),
    query({
      ok: true,
      version: 2,
      profile: { firstName: "Somsak", emergencyName: "Malee" },
    }),
  );
  state.queries.set(
    getFunctionName(hrRefs.employeePayment),
    query({
      ok: true,
      version: 1,
      payment: {
        method: "BANK",
        bankName: "Example Bank",
        accountNumber: "1234567890",
        accountMasked: "•••• 7890",
      },
    }),
  );
  state.queries.set(getFunctionName(hrRefs.employeeLifecycle), lifecycle());
  window.history.replaceState({ appNavigationIndex: 0 }, "", "/en/hr/today");
  stopTracking = trackAppHistory();
});
afterEach(() => stopTracking());

const here = () =>
  window.location.pathname + window.location.search + window.location.hash;
const LIST = "/en/hr/employees?status=ALL#registry";
function screenAt(url = LIST) {
  window.history.pushState({}, "", url);
  const tree = () => (
    <DraftGuardProvider>
      <main>
        <HrEmployeesScreen />
      </main>
    </DraftGuardProvider>
  );
  return {
    view: renderWithIntl(tree(), { locale: "en", workspace: false }),
    tree,
  };
}
async function traverse(delta: "back" | "forward") {
  await act(async () => {
    window.history[delta]();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
  });
}
async function openEditor() {
  fireEvent.click(screen.getAllByRole("button", { name: /Edit.*Somsak/ })[0]!);
  await screen.findByTestId("hr-employee-profile");
}
const leavePrompt = () =>
  screen.findByRole("dialog", { name: "Save changes before leaving?" });

it("employee profile Edit -> explicit Cancel -> next Back closes the editor to the filtered list", async () => {
  screenAt();
  await openEditor();
  const editorUrl = here();
  expect(editorUrl).toContain("employee=e7");
  expect(screen.getByText("•••• 7890")).toBeVisible();
  // The full account number is not shown outside the payment editor.
  expect(screen.queryByText("1234567890")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Edit personal details" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Personal details",
  });
  expect(within(dialog).getByLabelText("First name")).toHaveValue("Somsak");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(here()).toBe(editorUrl));
  // The next Back leaves the editor for the list with its query and hash.
  await traverse("back");
  await waitFor(() => expect(here()).toBe(LIST));
  await waitFor(() =>
    expect(screen.queryByTestId("hr-employee-profile")).toBeNull(),
  );
  expect(mutation(hrRefs.saveEmployeeProfile)).not.toHaveBeenCalled();
});

it("a dirty personal-details draft asks before Cancel or native Back discard it, and Keep editing retains it", async () => {
  screenAt();
  await openEditor();
  const editorUrl = here();
  fireEvent.click(
    screen.getByRole("button", { name: "Edit personal details" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Personal details",
  });
  fireEvent.change(within(dialog).getByLabelText("Nickname"), {
    target: { value: "Sak" },
  });
  await traverse("back");
  await leavePrompt();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Save changes before leaving?" }),
    ).toBeNull(),
  );
  expect(screen.getByLabelText("Nickname")).toHaveValue("Sak");
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Personal details" })).getByRole(
      "button",
      { name: "Cancel" },
    ),
  );
  await leavePrompt();
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  // The employment editor underneath is retained.
  await waitFor(() => expect(here()).toBe(editorUrl));
  expect(screen.getByTestId("hr-employee-form")).toBeVisible();
  expect(mutation(hrRefs.saveEmployeeProfile)).not.toHaveBeenCalled();
});

it("a pending contact save blocks Cancel and native Back, then the saved dialog consumes its entry before the next Back", async () => {
  let resolve: (value: unknown) => void = () => undefined;
  const save = mutation(hrRefs.saveEmployeeProfile);
  save.mockReturnValue(new Promise((done) => (resolve = done)));
  screenAt();
  await openEditor();
  const editorUrl = here();
  fireEvent.click(screen.getByRole("button", { name: "Edit contact details" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Contact and emergency contact",
  });
  fireEvent.change(within(dialog).getByLabelText("Email"), {
    target: { value: "somsak@example.com" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  // Only the contact section is sent; empty values clear, others are kept.
  expect(save.mock.calls[0]![0]).toMatchObject({
    employeeId: "e7",
    expectedVersion: 2,
    email: "somsak@example.com",
    phone: "",
    emergencyName: "Malee",
  });
  expect(save.mock.calls[0]![0]).not.toHaveProperty("firstName");
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  await traverse("back");
  expect(
    screen.getByRole("dialog", { name: "Contact and emergency contact" }),
  ).toBeVisible();
  await act(async () => resolve(saved("p1")));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(here()).toBe(editorUrl));
  await traverse("back");
  await waitFor(() => expect(here()).toBe(LIST));
});

it("native Back closes a clean payment editor and Forward reopens it", async () => {
  screenAt();
  await openEditor();
  const editorUrl = here();
  fireEvent.click(screen.getByRole("button", { name: "Edit payment details" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Payment details",
  });
  expect(within(dialog).getByLabelText("Account number")).toHaveValue(
    "1234567890",
  );
  await traverse("back");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(here()).toBe(editorUrl);
  await traverse("forward");
  expect(
    await screen.findByRole("dialog", { name: "Payment details" }),
  ).toBeVisible();
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Payment details" })).getByRole(
      "button",
      { name: "Cancel" },
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await traverse("back");
  await waitFor(() => expect(here()).toBe(LIST));
});

it("recording a resignation refuses today, sends a past last working day with a reason and consumes its dialog", async () => {
  const record = mutation(hrRefs.recordEmploymentEvent);
  record.mockResolvedValue(saved("e7"));
  screenAt();
  await openEditor();
  const editorUrl = here();
  const section = screen.getByTestId("hr-employee-lifecycle");
  expect(within(section).getByText("Active")).toBeVisible();
  fireEvent.click(
    within(section).getByRole("button", {
      name: "Record resignation or termination",
    }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Record resignation or termination",
  });
  expect(
    within(dialog).getByText(/sign-in and HR roles are not changed/),
  ).toBeVisible();
  const date = within(dialog).getByLabelText("Last working day");
  expect(date).toHaveAttribute("max", "2026-10-19");
  fireEvent.change(date, { target: { value: "2026-10-20" } });
  fireEvent.change(within(dialog).getByLabelText(/Reason/), {
    target: { value: "Moved away" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(
    await within(dialog).findByText(
      "The last working day must be before today.",
    ),
  ).toBeVisible();
  expect(record).not.toHaveBeenCalled();
  fireEvent.change(date, { target: { value: "2026-10-19" } });
  fireEvent.click(within(dialog).getByRole("radio", { name: "Termination" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(record).toHaveBeenCalledOnce());
  expect(record.mock.calls[0]![0]).toMatchObject({
    employeeId: "e7",
    expectedVersion: 4,
    kind: "OFFBOARD",
    separationType: "TERMINATION",
    effectiveDate: "2026-10-19",
    reason: "Moved away",
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(here()).toBe(editorUrl));
  await traverse("back");
  await waitFor(() => expect(here()).toBe(LIST));
});

it("an offboarded employee shows its history, offers reinstatement and cannot be switched active in the form", async () => {
  state.queries.set(getFunctionName(hrRefs.employeesPage), page([former]));
  state.queries.set(
    getFunctionName(hrRefs.employee),
    query({ ok: true, employee: former }),
  );
  state.queries.set(
    getFunctionName(hrRefs.employeeLifecycle),
    lifecycle({
      state: "RESIGNED",
      separation: {
        type: "RESIGNATION",
        lastWorkingDate: "2026-09-30",
        reason: "Moved away",
      },
      events: [
        {
          id: "ev1",
          type: "RESIGNED",
          effectiveDate: "2026-09-30",
          reason: "Moved away",
          recordedAt: Date.UTC(2026, 9, 1, 3),
          recordedByName: "HR Admin",
        },
      ],
    }),
  );
  screenAt();
  expect((await screen.findAllByText("Resigned")).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Last day/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole("button", { name: /Edit.*Malee/ })[0]!);
  const section = await screen.findByTestId("hr-employee-lifecycle");
  expect(
    within(screen.getByTestId("hr-lifecycle-history")).getByText("Moved away"),
  ).toBeVisible();
  expect(
    within(section).queryByRole("button", {
      name: "Record resignation or termination",
    }),
  ).toBeNull();
  fireEvent.click(within(section).getByRole("button", { name: "Reinstate" }));
  const dialog = await screen.findByRole("dialog", { name: "Reinstate" });
  fireEvent.change(within(dialog).getByLabelText("Reinstatement date"), {
    target: { value: "2026-09-30" },
  });
  fireEvent.change(within(dialog).getByLabelText(/Reason/), {
    target: { value: "Rehired" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await within(dialog).findByText(/Choose .* or later/)).toBeVisible();
  expect(mutation(hrRefs.recordEmploymentEvent)).not.toHaveBeenCalled();
});

it("the registry defaults to current employees and filters former employees through the URL", async () => {
  screenAt("/en/hr/employees#registry");
  await screen.findAllByText("Somsak");
  expect(
    state.args.get(getFunctionName(hrRefs.employeesPage)),
  ).not.toHaveProperty("status");
  chooseOption("Status", "Former (resigned or terminated)");
  await waitFor(() =>
    expect(state.args.get(getFunctionName(hrRefs.employeesPage))).toMatchObject(
      { status: "FORMER" },
    ),
  );
  expect(here()).toContain("status=FORMER");
  expect(here()).toContain("#registry");
});

it("a remounted editor shows the saved profile again from the server", async () => {
  const { view, tree } = screenAt();
  await openEditor();
  const editorUrl = here();
  view.unmount();
  renderWithIntl(tree(), { locale: "en", workspace: false });
  const personal = await screen.findByTestId("hr-employee-personal");
  expect(within(personal).getByText("Somsak")).toBeVisible();
  expect(here()).toBe(editorUrl);
});
