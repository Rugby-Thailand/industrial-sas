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
    view: renderWithIntl(tree(), {
      locale: "en",
      workspace: false,
      preserveProviders: true,
    }),
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

it("hardening U1 keeps dirty profile draft when another editor updates server version", async () => {
  const { view, tree } = screenAt();
  await openEditor();
  fireEvent.click(
    screen.getByRole("button", { name: "Edit personal details" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Personal details",
  });
  fireEvent.change(within(dialog).getByLabelText("Nickname"), {
    target: { value: "Unsaved nickname" },
  });
  state.queries.set(
    getFunctionName(hrRefs.employeeProfile),
    query({
      ok: true,
      version: 3,
      profile: { firstName: "Somsak", email: "changed-elsewhere@example.com" },
    }),
  );
  view.rerender(tree());
  expect(screen.getByLabelText("Nickname")).toHaveValue("Unsaved nickname");
});

it("hardening U2 completes original save after live query version refresh", async () => {
  let resolve: (value: unknown) => void = () => undefined;
  const save = mutation(hrRefs.saveEmployeeProfile);
  save.mockReturnValue(new Promise((done) => (resolve = done)));
  const { view, tree } = screenAt();
  await openEditor();
  const editorUrl = here();
  fireEvent.click(screen.getByRole("button", { name: "Edit contact details" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Contact and emergency contact",
  });
  fireEvent.change(within(dialog).getByLabelText("Email"), {
    target: { value: "saved@example.com" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  state.queries.set(
    getFunctionName(hrRefs.employeeProfile),
    query({ ok: true, version: 3, profile: { email: "saved@example.com" } }),
  );
  view.rerender(tree());
  await act(async () => resolve(saved("p1")));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(here()).toBe(editorUrl));
  await traverse("back");
  await waitFor(() => expect(here()).toBe(LIST));
});

it("hardening U3 loaded ID-only request offers status recovery with no original callback", async () => {
  screenAt();
  await openEditor();
  // This is the exact storage record useHrWrite leaves when a response is lost;
  // a new document has no in-memory owner.command callback.
  window.sessionStorage.setItem(
    `hr-request:${state.identityKey}|employee-profile:e7:personal`,
    JSON.stringify({ version: 1, requestId: "reload-request-0001" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Edit personal details" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Personal details",
  });
  expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  expect(
    within(dialog).queryByText(/saved request reference could not be read/i),
  ).toBeNull();
});

const editors = [
  {
    name: "personal",
    action: "Edit personal details",
    title: "Personal details",
    field: "Nickname",
    value: "Retained personal draft",
    ref: hrRefs.saveEmployeeProfile,
    queryRef: hrRefs.employeeProfile,
    expectedVersion: 2,
    refresh: () =>
      query({ ok: true, version: 3, profile: { nickname: "Other editor" } }),
  },
  {
    name: "contact",
    action: "Edit contact details",
    title: "Contact and emergency contact",
    field: "Email",
    value: "private@example.com",
    ref: hrRefs.saveEmployeeProfile,
    queryRef: hrRefs.employeeProfile,
    expectedVersion: 2,
    refresh: () =>
      query({ ok: true, version: 3, profile: { email: "other@example.com" } }),
  },
  {
    name: "payment",
    action: "Edit payment details",
    title: "Payment details",
    field: "Bank",
    value: "Retained private bank",
    ref: hrRefs.saveEmployeePayment,
    queryRef: hrRefs.employeePayment,
    expectedVersion: 1,
    refresh: () => query({ ok: true, version: 2, payment: { method: "CASH" } }),
  },
  {
    name: "lifecycle",
    action: "Record resignation or termination",
    title: "Record resignation or termination",
    field: "Reason",
    value: "Retained departure reason",
    ref: hrRefs.recordEmploymentEvent,
    queryRef: hrRefs.employeeLifecycle,
    expectedVersion: 4,
    refresh: () => lifecycle({ version: 5, state: "INACTIVE" }),
  },
];

it.each(editors)(
  "$name session keeps its pending owner through query refresh, blocks Cancel/header/native Back, then consumes completion to the query/hash origin",
  async (editor) => {
    let resolve: (value: unknown) => void = () => undefined;
    const save = mutation(editor.ref);
    save.mockReturnValue(new Promise((done) => (resolve = done)));
    const { view, tree } = screenAt();
    await openEditor();
    const origin = here();
    // Capture the actual page-header control before the modal hides its underlay.
    const headerBack = screen.getByRole("button", { name: "Back" });
    fireEvent.click(screen.getByRole("button", { name: editor.action }));
    const dialog = await screen.findByRole("dialog", { name: editor.title });
    fireEvent.change(
      within(dialog).getByLabelText(
        editor.field === "Reason" ? /Reason/ : editor.field,
      ),
      { target: { value: editor.value } },
    );
    if (editor.name === "lifecycle")
      fireEvent.change(within(dialog).getByLabelText("Last working day"), {
        target: { value: "2026-10-19" },
      });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    state.queries.set(getFunctionName(editor.queryRef), editor.refresh());
    if (editor.name === "lifecycle")
      state.queries.set(
        getFunctionName(hrRefs.employee),
        query({
          ok: true,
          employee: {
            ...employee,
            version: 5,
            status: "INACTIVE",
            employmentState: "RESIGNED",
            employmentEndDate: "2026-10-19",
            separation: { type: "RESIGNATION", lastWorkingDate: "2026-10-19" },
          },
        }),
      );
    view.rerender(tree());
    expect(
      screen.getByLabelText(
        editor.field === "Reason" ? /Reason/ : editor.field,
      ),
    ).toHaveValue(editor.value);
    expect(within(dialog).getByText(/Your draft is retained/)).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(headerBack);
    await traverse("back");
    expect(screen.getByRole("dialog", { name: editor.title })).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "Save changes before leaving?" }),
    ).toBeNull();
    expect(save.mock.calls[0]![0]).toMatchObject({
      expectedVersion: editor.expectedVersion,
    });
    // Persist only identity/operation, never the private draft.
    const stored =
      Object.values(window.sessionStorage).join(" ") +
      Object.values(window.localStorage).join(" ");
    expect(stored).not.toContain(editor.value);
    expect(stored).not.toContain("1234567890");
    await act(async () => resolve(saved("e7")));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(here()).toBe(origin));
    await traverse("back");
    await waitFor(() => expect(here()).toBe(LIST));
    await traverse("forward");
    await waitFor(() => expect(here()).toBe(origin));
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

it("a refreshed dirty personal session survives loading and header Back, then explicit discard consumes the entry before the next Back", async () => {
  const { view, tree } = screenAt();
  await openEditor();
  const origin = here();
  const headerBack = screen.getByRole("button", { name: "Back" });
  fireEvent.click(
    screen.getByRole("button", { name: "Edit personal details" }),
  );
  fireEvent.change(screen.getByLabelText("Nickname"), {
    target: { value: "Keep this draft" },
  });
  state.queries.set(getFunctionName(hrRefs.employeeProfile), undefined);
  view.rerender(tree());
  expect(screen.getByLabelText("Nickname")).toHaveValue("Keep this draft");
  state.queries.set(
    getFunctionName(hrRefs.employeeProfile),
    query({ ok: true, version: 8, profile: { nickname: "Another editor" } }),
  );
  view.rerender(tree());
  fireEvent.click(headerBack);
  await leavePrompt();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Save changes before leaving?" }),
    ).toBeNull(),
  );
  expect(screen.getByLabelText("Nickname")).toHaveValue("Keep this draft");
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Personal details" })).getByRole(
      "button",
      { name: "Cancel" },
    ),
  );
  await leavePrompt();
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(here()).toBe(origin));
  await traverse("back");
  await waitFor(() => expect(here()).toBe(LIST));
});

it("Forward opens a fresh payment session after Back while a remount reads current server values", async () => {
  const { view, tree } = screenAt();
  await openEditor();
  fireEvent.click(screen.getByRole("button", { name: "Edit payment details" }));
  await screen.findByRole("dialog", { name: "Payment details" });
  await traverse("back");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  state.queries.set(
    getFunctionName(hrRefs.employeePayment),
    query({
      ok: true,
      version: 2,
      payment: {
        method: "BANK",
        bankName: "Current bank",
        accountNumber: "9876543210",
      },
    }),
  );
  view.rerender(tree());
  await traverse("forward");
  await screen.findByRole("dialog", { name: "Payment details" });
  expect(screen.getByLabelText("Bank")).toHaveValue("Current bank");
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  view.unmount();
  renderWithIntl(tree(), { locale: "en", workspace: false });
  fireEvent.click(screen.getByRole("button", { name: "Edit payment details" }));
  await screen.findByRole("dialog", { name: "Payment details" });
  expect(screen.getByLabelText("Account number")).toHaveValue("9876543210");
});

it.each(["org-a:other-actor", "org-b:other-actor"])(
  "identity change to %s invalidates private sessions and an old pending result cannot close the new actor's dialog",
  async (identity) => {
    let resolve: (value: unknown) => void = () => undefined;
    mutation(hrRefs.saveEmployeeProfile).mockReturnValue(
      new Promise((done) => (resolve = done)),
    );
    const { view, tree } = screenAt();
    await openEditor();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit personal details" }),
    );
    fireEvent.change(screen.getByLabelText("Nickname"), {
      target: { value: "Old actor private draft" },
    });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }),
    );
    await waitFor(() =>
      expect(mutation(hrRefs.saveEmployeeProfile)).toHaveBeenCalledOnce(),
    );
    state.identityKey = identity;
    state.queries.set(
      getFunctionName(hrRefs.employeeProfile),
      query({ ok: true, version: 2, profile: { nickname: "New actor data" } }),
    );
    view.rerender(tree());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(
      screen.getByRole("button", { name: "Edit personal details" }),
    );
    await screen.findByRole("dialog", { name: "Personal details" });
    expect(screen.getByLabelText("Nickname")).toHaveValue("New actor data");
    await act(async () => resolve(saved("e7")));
    expect(
      screen.getByRole("dialog", { name: "Personal details" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Nickname")).toHaveValue("New actor data");
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    ).toBeEnabled();
  },
);

const recoveryEditors = [
  {
    action: "Edit personal details",
    title: "Personal details",
    intent: "employee-profile:e7:personal",
    operation: "hr.employee.profile.save",
  },
  {
    action: "Edit payment details",
    title: "Payment details",
    intent: "employee-payment:e7",
    operation: "hr.employee.payment.save",
  },
  {
    action: "Record resignation or termination",
    title: "Record resignation or termination",
    intent: "employee-lifecycle:e7",
    operation: "hr.employee.lifecycle",
  },
];
for (const status of ["COMMITTED", "FENCED"] as const) {
  it.each(recoveryEditors)(
    `$operation ID-only reload recovery handles ${status} with no original callback and no private payload replay`,
    async (editor) => {
      const recover = mutation(hrRefs.reconcileRequest);
      recover.mockResolvedValue({
        ok: true,
        value: { resolved: true, status },
      });
      // New document representation: only the serialized ID, no owner.command
      // ever existed for this actor/intent in this test's module lifetime.
      window.sessionStorage.setItem(
        `hr-request:${state.identityKey}|${editor.intent}`,
        JSON.stringify({
          version: 1,
          requestId: "employee-reload-request-0001",
        }),
      );
      screenAt();
      await openEditor();
      fireEvent.click(screen.getByRole("button", { name: editor.action }));
      const dialog = await screen.findByRole("dialog", { name: editor.title });
      expect(
        within(dialog).getByRole("button", { name: "Save" }),
      ).toBeDisabled();
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Check previous write" }),
      );
      await waitFor(() =>
        expect(recover).toHaveBeenCalledWith({
          operation: editor.operation,
          requestId: "employee-reload-request-0001",
        }),
      );
      expect(
        await within(dialog).findByText(
          status === "COMMITTED"
            ? "The previous write was saved"
            : "Unable to confirm whether the previous write was saved",
        ),
      ).toBeVisible();
      expect(
        within(dialog).getByRole("button", { name: "Save" }),
      ).toBeEnabled();
      for (const ref of [
        hrRefs.saveEmployeeProfile,
        hrRefs.saveEmployeePayment,
        hrRefs.recordEmploymentEvent,
      ])
        expect(mutation(ref)).not.toHaveBeenCalled();
      expect(
        window.sessionStorage.getItem(
          `hr-request:${state.identityKey}|${editor.intent}`,
        ),
      ).toBeNull();
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await traverse("back");
      await waitFor(() => expect(here()).toBe(LIST));
    },
  );
}

it.each([
  {
    action: "Edit personal details",
    title: "Personal details",
    field: "Nickname",
    value: "Retained stale nickname",
    ref: hrRefs.saveEmployeeProfile,
    queryRef: hrRefs.employeeProfile,
    version: 2,
    code: "PROFILE_STALE",
    refresh: query({
      ok: true,
      version: 3,
      profile: { nickname: "Newer server value" },
    }),
  },
  {
    action: "Edit payment details",
    title: "Payment details",
    field: "Account name",
    value: "Retained stale account holder",
    ref: hrRefs.saveEmployeePayment,
    queryRef: hrRefs.employeePayment,
    version: 1,
    code: "PAYMENT_STALE",
    refresh: query({ ok: true, version: 2, payment: { method: "CASH" } }),
  },
])(
  "independent $code response retains the pinned draft after loading and version advance without overwriting the newer snapshot",
  async (editor) => {
    let resolve: (value: unknown) => void = () => undefined;
    const save = mutation(editor.ref);
    save.mockReturnValue(new Promise((done) => (resolve = done)));
    const { view, tree } = screenAt();
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: editor.action }));
    const dialog = await screen.findByRole("dialog", { name: editor.title });
    fireEvent.change(within(dialog).getByLabelText(editor.field), {
      target: { value: editor.value },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    state.queries.set(getFunctionName(editor.queryRef), undefined);
    view.rerender(tree());
    expect(within(dialog).getByLabelText(editor.field)).toHaveValue(
      editor.value,
    );
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
    state.queries.set(getFunctionName(editor.queryRef), editor.refresh);
    view.rerender(tree());
    await act(async () =>
      resolve({
        ok: true,
        value: { written: false, error: { code: editor.code } },
      }),
    );
    await waitFor(() =>
      expect(within(dialog).getByTestId("hr-write-refused")).toBeVisible(),
    );
    expect(within(dialog).getByLabelText(editor.field)).toHaveValue(
      editor.value,
    );
    expect(save.mock.calls[0]![0]).toMatchObject({
      expectedVersion: editor.version,
    });
    expect(save).toHaveBeenCalledOnce();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeEnabled();
  },
);

it("independent reinstatement refusal can return to inactive employment assignment editing", async () => {
  const separated = {
    ...employee,
    status: "INACTIVE",
    employmentState: "RESIGNED",
    employmentEndDate: "2026-09-30",
    separation: { type: "RESIGNATION", lastWorkingDate: "2026-09-30" },
  };
  state.queries.set(
    getFunctionName(hrRefs.employee),
    query({ ok: true, employee: separated }),
  );
  state.queries.set(
    getFunctionName(hrRefs.employeeLifecycle),
    lifecycle({
      state: "RESIGNED",
      separation: {
        type: "RESIGNATION",
        lastWorkingDate: "2026-09-30",
        reason: "Earlier departure",
      },
    }),
  );
  state.queries.set(
    getFunctionName(hrRefs.departmentOptions),
    query({ items: [{ id: "d1", name: "Sales", status: "ACTIVE" }] }),
  );
  state.queries.set(
    getFunctionName(hrRefs.positionOptions),
    query({ items: [{ id: "p1", name: "Staff", status: "ACTIVE" }] }),
  );
  mutation(hrRefs.recordEmploymentEvent).mockResolvedValue({
    ok: true,
    value: {
      written: false,
      error: { code: "DEPARTMENT_REQUIRED", field: "departmentId" },
    },
  });
  screenAt();
  await openEditor();
  const editorUrl = here();
  fireEvent.click(screen.getByRole("button", { name: "Reinstate" }));
  const dialog = await screen.findByRole("dialog", { name: "Reinstate" });
  expect(
    within(dialog).getByText(/update the employment fields below/),
  ).toBeVisible();
  fireEvent.change(within(dialog).getByRole("textbox", { name: /Reason/ }), {
    target: { value: "Returning employee" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(within(dialog).getByText("Choose a department")).toBeVisible(),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  const confirm = await screen.findByRole("dialog", {
    name: "Save changes before leaving?",
  });
  fireEvent.click(
    within(confirm).getByRole("button", { name: "Discard changes" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(here()).toBe(editorUrl));
  chooseOption("Department", "Sales");
  chooseOption("Position", "Staff");
  const save = mutation(hrRefs.saveEmployee);
  save.mockResolvedValue({
    ok: true,
    value: { written: false, error: { code: "EMPLOYEE_STALE" } },
  });
  fireEvent.submit(screen.getByTestId("hr-employee-form"));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]![0]).toMatchObject({
    status: "INACTIVE",
    employmentEndDate: "2026-09-30",
    departmentId: "d1",
    positionId: "p1",
    replaceOrgFields: true,
  });
});

it("independent successful personal foreground completion preserves a dirty employment underlay without asking to discard it", async () => {
  screenAt();
  await openEditor();
  fireEvent.change(screen.getByLabelText(/^Display name/), {
    target: { value: "Unsaved employment name" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Edit personal details" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Personal details",
  });
  fireEvent.change(within(dialog).getByLabelText("Nickname"), {
    target: { value: "Saved personal nickname" },
  });
  mutation(hrRefs.saveEmployeeProfile).mockResolvedValue(saved("e7"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(mutation(hrRefs.saveEmployeeProfile)).toHaveBeenCalledOnce(),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Personal details" }),
    ).toBeNull(),
  );
  expect(
    screen.queryByRole("dialog", { name: "Save changes before leaving?" }),
  ).toBeNull();
  expect(screen.getByLabelText(/^Display name/)).toHaveValue(
    "Unsaved employment name",
  );
  await traverse("back");
  await leavePrompt();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Save changes before leaving?" }),
    ).toBeNull(),
  );
  expect(screen.getByLabelText(/^Display name/)).toHaveValue(
    "Unsaved employment name",
  );
  await traverse("back");
  await leavePrompt();
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() => expect(here()).toBe(LIST));
});

// Durable recovery from the actual caller: the first command's response is
// lost, then a reload starts a new module lifetime (no in-memory owner or
// callback) while the server version has advanced. The ID-only record must
// stay reachable for the same actor/tenant/employee/operation without ever
// storing the private draft or replaying it.
const lostResponseEditors = [
  {
    name: "personal",
    action: "Edit personal details",
    reopen: "Edit personal details",
    title: "Personal details",
    reopenTitle: "Personal details",
    field: "Nickname",
    value: "Private nickname draft",
    ref: hrRefs.saveEmployeeProfile,
    queryRef: hrRefs.employeeProfile,
    operation: "hr.employee.profile.save",
    opened: 2,
    advanced: () =>
      query({ ok: true, version: 3, profile: { nickname: "Server value" } }),
  },
  {
    name: "payment",
    action: "Edit payment details",
    reopen: "Edit payment details",
    title: "Payment details",
    reopenTitle: "Payment details",
    field: "Account name",
    value: "Private account holder",
    ref: hrRefs.saveEmployeePayment,
    queryRef: hrRefs.employeePayment,
    operation: "hr.employee.payment.save",
    opened: 1,
    advanced: () =>
      query({ ok: true, version: 2, payment: { method: "CASH" } }),
  },
  {
    name: "lifecycle",
    action: "Record resignation or termination",
    reopen: "Record resignation or termination",
    title: "Record resignation or termination",
    reopenTitle: "Record resignation or termination",
    field: "Reason",
    value: "Private departure reason",
    ref: hrRefs.recordEmploymentEvent,
    queryRef: hrRefs.employeeLifecycle,
    operation: "hr.employee.lifecycle",
    opened: 4,
    advanced: () => lifecycle({ version: 5 }),
  },
];
async function loseFirstResponse(editor: (typeof lostResponseEditors)[number]) {
  const save = mutation(editor.ref);
  save.mockRejectedValue(new Error("connection lost"));
  const { view } = screenAt();
  await openEditor();
  const origin = here();
  fireEvent.click(screen.getByRole("button", { name: editor.action }));
  const dialog = await screen.findByRole("dialog", { name: editor.title });
  const label = editor.field === "Reason" ? /Reason/ : editor.field;
  fireEvent.change(within(dialog).getByLabelText(label), {
    target: { value: editor.value },
  });
  if (editor.name === "lifecycle")
    fireEvent.change(within(dialog).getByLabelText("Last working day"), {
      target: { value: "2026-10-19" },
    });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await within(dialog).findByTestId("hr-write-uncertain");
  expect(save).toHaveBeenCalledOnce();
  const sent = save.mock.calls[0]![0] as {
    requestId: string;
    expectedVersion: number;
  };
  expect(sent.expectedVersion).toBe(editor.opened);
  return { save, sent, view, origin };
}
const storedText = () =>
  Object.values(window.sessionStorage).join(" ") +
  Object.values(window.localStorage).join(" ");
/** A real reload: new module instances, so no owner/callback survives. */
async function reloadAt(url: string) {
  stopTracking();
  vi.resetModules();
  const [intl, guard, history, employees] = await Promise.all([
    import("@tests/fixtures/intl-render"),
    import("@/components/providers/DraftGuardProvider"),
    import("@/lib/browser/appHistory"),
    import("@/features/hr/EmployeesScreen"),
  ]);
  window.history.replaceState({ appNavigationIndex: 0 }, "", url);
  stopTracking = history.trackAppHistory();
  return intl.renderWithIntl(
    <guard.DraftGuardProvider>
      <main>
        <employees.HrEmployeesScreen />
      </main>
    </guard.DraftGuardProvider>,
    { locale: "en", workspace: false },
  );
}

it.each(
  lostResponseEditors.flatMap((editor) =>
    (["COMMITTED", "FENCED"] as const).map((status) => ({ ...editor, status })),
  ),
)(
  "durable $name recovery survives reload after the version advances and resolves $status without replay or private storage",
  async ({ status, ...editor }) => {
    // An unrelated employee's uncertain write must stay untouched.
    const unrelated = `hr-request:${state.identityKey}|employee-payment:e9`;
    window.sessionStorage.setItem(
      unrelated,
      JSON.stringify({ version: 1, requestId: "unrelated-request-0001" }),
    );
    const { save, sent, view, origin } = await loseFirstResponse(editor);
    expect(storedText()).not.toContain(editor.value);
    expect(storedText()).not.toContain("1234567890");
    expect(storedText()).toContain(sent.requestId);
    // Only identity/operation and the captured command revision persist.
    const record = Object.entries(window.sessionStorage).find(([, value]) =>
      value.includes(sent.requestId),
    )!;
    expect(record[0]).not.toMatch(/:\d+$/);
    expect(Object.keys(JSON.parse(record[1])).sort()).toEqual([
      "operation",
      "requestId",
      "revision",
      "version",
    ]);
    expect(JSON.parse(record[1])).toMatchObject({
      operation: editor.operation,
      revision: editor.opened,
    });
    view.unmount();
    // COMMITTED advanced the version with this write; FENCED with another
    // editor's write. Either way the reopened session sees a new version.
    state.queries.set(getFunctionName(editor.queryRef), editor.advanced());
    const recover = mutation(hrRefs.reconcileRequest);
    recover.mockResolvedValue({ ok: true, value: { resolved: true, status } });
    await reloadAt(origin);
    fireEvent.click(await screen.findByRole("button", { name: editor.reopen }));
    const dialog = await screen.findByRole("dialog", {
      name: editor.reopenTitle,
    });
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Check previous write" }),
    );
    await waitFor(() =>
      expect(recover).toHaveBeenCalledWith({
        operation: editor.operation,
        requestId: sent.requestId,
      }),
    );
    expect(
      await within(dialog).findByText(
        status === "COMMITTED"
          ? "The previous write was saved"
          : "Unable to confirm whether the previous write was saved",
      ),
    ).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled();
    // The lost command was never resent and no private value was restored.
    expect(save).toHaveBeenCalledOnce();
    expect(storedText()).not.toContain(sent.requestId);
    expect(window.sessionStorage.getItem(unrelated)).toContain(
      "unrelated-request-0001",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(here()).toBe(origin));
  },
);

it("durable payment recovery is private to its actor: another actor after reload sees no receipt and the owner still can check it", async () => {
  const owner = state.identityKey;
  const { sent, view, origin } = await loseFirstResponse(
    lostResponseEditors[1]!,
  );
  view.unmount();
  state.queries.set(
    getFunctionName(hrRefs.employeePayment),
    lostResponseEditors[1]!.advanced(),
  );
  const recover = mutation(hrRefs.reconcileRequest);
  recover.mockResolvedValue({
    ok: true,
    value: { resolved: true, status: "COMMITTED" },
  });
  state.identityKey = "org-a:someone-else";
  const other = await reloadAt(origin);
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit payment details" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Payment details" });
  expect(
    within(dialog).queryByRole("button", { name: "Check previous write" }),
  ).toBeNull();
  expect(within(dialog).queryByTestId("hr-write-uncertain")).toBeNull();
  expect(within(dialog).getByRole("button", { name: "Save" })).toBeEnabled();
  expect(recover).not.toHaveBeenCalled();
  other.unmount();
  state.identityKey = owner;
  await reloadAt(origin);
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit payment details" }),
  );
  const own = await screen.findByRole("dialog", { name: "Payment details" });
  fireEvent.click(
    within(own).getByRole("button", { name: "Check previous write" }),
  );
  await waitFor(() =>
    expect(recover).toHaveBeenCalledWith({
      operation: "hr.employee.payment.save",
      requestId: sent.requestId,
    }),
  );
});

it("a lost payment response retried after query refresh resends its captured revision and request instead of a new command", async () => {
  const { save, sent, view } = await loseFirstResponse(lostResponseEditors[1]!);
  const tree = () => (
    <DraftGuardProvider>
      <main>
        <HrEmployeesScreen />
      </main>
    </DraftGuardProvider>
  );
  // The live query advances while the same document is still open.
  state.queries.set(
    getFunctionName(hrRefs.employeePayment),
    lostResponseEditors[1]!.advanced(),
  );
  view.rerender(tree());
  save.mockReset();
  save.mockResolvedValue(saved("e7"));
  const dialog = screen.getByRole("dialog", { name: "Payment details" });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Try again safely" }),
  );
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0]![0]).toMatchObject({
    requestId: sent.requestId,
    expectedVersion: 1,
    accountName: "Private account holder",
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(storedText()).not.toContain(sent.requestId);
});
