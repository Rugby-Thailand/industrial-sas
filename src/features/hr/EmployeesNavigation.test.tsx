import { fireEvent, screen, waitFor, act } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { useSyncExternalStore } from "react";
import type { ComponentProps } from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  save: vi.fn(),
  identityKey: "audit-org:audit-user",
}));
vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) =>
      args === "skip" ? undefined : state.queries.get(name(reference)),
    useMutation: () => state.save,
  };
});
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: ["hr.admin.manage"],
    timezoneSupported: true,
    timezone: "Asia/Bangkok",
    today: "2026-10-09",
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
import { hrRefs } from "@/lib/convex/hrApi";
import { trackAppHistory, appHistoryIndex } from "@/lib/browser/appHistory";
import { HrEmployeesScreen } from "@/features/hr/EmployeesScreen";

const employee = {
  id: "e7",
  code: "EMP-007",
  displayName: "Somsak",
  status: "ACTIVE",
  siteId: "w1",
  siteCode: "HQ",
  linkedActive: false,
  employmentStartDate: "2026-01-05",
  version: 4,
};
let stopTracking: () => void;
let testActor = 0;
const snapshot = () => ({
  url: window.location.pathname + window.location.search + window.location.hash,
  index: appHistoryIndex(),
  guard: !!window.history.state?.__storageWorkspaceGuard,
});
beforeEach(() => {
  // Each case starts a new actor; pending commands deliberately survive a
  // form unmount, so the preceding case's unresolved save must stay isolated.
  state.identityKey = `audit-org:audit-user-${++testActor}`;
  state.save.mockReset();
  window.sessionStorage.clear();
  state.queries.set(getFunctionName(hrRefs.employeesPage), {
    ok: true,
    value: {
      ok: true,
      status: "ready",
      page: [employee],
      continueCursor: "",
      isDone: true,
    },
  });
  state.queries.set(getFunctionName(hrRefs.employee), {
    ok: true,
    value: { ok: true, employee },
  });
  state.queries.set(getFunctionName(hrRefs.memberOptionsPage), {
    ok: true,
    value: {
      ok: true,
      status: "ready",
      page: [],
      continueCursor: "",
      isDone: true,
    },
  });
  window.history.replaceState({ appNavigationIndex: 0 }, "", "/en/hr/today");
  stopTracking = trackAppHistory();
});

it("owned editor provenance survives a remount and Cancel consumes that entry", async () => {
  window.history.pushState({}, "", "/en/hr/employees?q=Som#registry");
  const page = () => (
    <DraftGuardProvider>
      <main>
        <HrEmployeesScreen />
      </main>
    </DraftGuardProvider>
  );
  const view = renderWithIntl(page(), { locale: "en", workspace: false });
  fireEvent.click(screen.getAllByRole("button", { name: /Edit.*Somsak/ })[0]!);
  view.unmount();
  renderWithIntl(page(), { locale: "en", workspace: false });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/en/hr/employees?q=Som#registry"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await waitFor(() => expect(window.location.pathname).toBe("/en/hr/today"));
});

it("Cancel on a direct editor link cleans owned parameters and retains unrelated query/hash", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/hr/employees?q=Som&employee=e7&mode=edit&focus=schedule#registry",
  );
  renderWithIntl(
    <DraftGuardProvider>
      <main>
        <HrEmployeesScreen />
      </main>
    </DraftGuardProvider>,
    { locale: "en", workspace: false },
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/en/hr/employees?q=Som#registry"),
  );
  expect(appHistoryIndex()).toBe(0);
});

it("an in-flight employee write disables Cancel and keeps Back guarded", async () => {
  state.save.mockImplementation(() => new Promise(() => {}));
  window.history.pushState({}, "", "/en/hr/employees");
  renderWithIntl(
    <DraftGuardProvider>
      <main>
        <HrEmployeesScreen />
      </main>
    </DraftGuardProvider>,
    { locale: "en", workspace: false },
  );
  fireEvent.click(screen.getAllByRole("button", { name: /Edit.*Somsak/ })[0]!);
  fireEvent.change(screen.getByRole("textbox", { name: "Display name" }), {
    target: { value: "Edited" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save employee" }));
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByTestId("navigation-guard-pending")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Discard changes" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByRole("textbox", { name: "Display name" })).toHaveValue(
    "Edited",
  );
});
afterEach(() => stopTracking());

it.each([false, true])(
  "employee open -> explicit Cancel -> next Back returns to caller (dirty=%s)",
  async (dirty) => {
    window.history.pushState({}, "", "/en/hr/employees");
    renderWithIntl(
      <DraftGuardProvider>
        <main>
          <HrEmployeesScreen />
        </main>
      </DraftGuardProvider>,
      { locale: "en", workspace: false },
    );
    const trace = [snapshot()];
    fireEvent.click(
      screen.getAllByRole("button", { name: /Edit.*Somsak/ })[0]!,
    );
    expect(
      screen.getByRole("textbox", { name: "Display name" }),
    ).toBeInTheDocument();
    trace.push(snapshot());
    if (dirty) {
      fireEvent.change(screen.getByRole("textbox", { name: "Display name" }), {
        target: { value: "Edited" },
      });
      trace.push(snapshot());
    }
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(screen.queryByRole("textbox", { name: "Display name" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    trace.push(snapshot());
    await act(async () => {
      const pop = new Promise<void>((resolve) =>
        window.addEventListener("popstate", () => resolve(), { once: true }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      await pop;
    });
    trace.push(snapshot());
    expect(window.location.pathname).toBe("/en/hr/today");
  },
);

it("explicit Cancel restores original list query and hash", async () => {
  const original = "/en/hr/employees?q=Som&selection=e7#registry";
  window.history.pushState({}, "", original);
  renderWithIntl(
    <DraftGuardProvider>
      <main>
        <HrEmployeesScreen />
      </main>
    </DraftGuardProvider>,
    { locale: "en", workspace: false },
  );
  fireEvent.click(screen.getAllByRole("button", { name: /Edit.*Somsak/ })[0]!);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByRole("textbox", { name: "Display name" })).toBeNull(),
  );
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe(original),
  );
});

it("locale replacement retains editor ownership so Cancel and the next native Back consume no duplicate list", async () => {
  window.history.pushState({}, "", "/en/hr/employees?q=Som#registry");
  renderWithIntl(
    <DraftGuardProvider>
      <main>
        <HrEmployeesScreen />
      </main>
    </DraftGuardProvider>,
    { locale: "en", workspace: false },
  );
  fireEvent.click(screen.getAllByRole("button", { name: /Edit.*Somsak/ })[0]!);
  act(() => {
    const destination = new URL(window.location.href);
    destination.pathname = "/th/hr/employees";
    window.history.replaceState(
      { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["th"] },
      "",
      destination,
    );
    window.dispatchEvent(new Event("app-query-state"));
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/en/hr/employees?q=Som#registry"),
  );
  expect(appHistoryIndex()).toBe(1);
  act(() => window.history.back());
  await waitFor(() => expect(window.location.pathname).toBe("/en/hr/today"));
});

it.each(["en", "th"] as const)(
  "successful employee save closes the editor with a %s receipt and HR access handoff, then the next Back returns to the caller",
  async (locale) => {
    const linked = {
      ...employee,
      linkedUserId: "u1",
      linkedName: "Nok",
      linkedActive: true,
      linkedSelfAccess: false,
      supervisorUserId: "u2",
      supervisorName: "Lead",
      supervisorReviewAccess: false,
    };
    const answer = (record: object) => ({
      ok: true,
      value: {
        ok: true,
        status: "ready",
        page: [record],
        continueCursor: "",
        isDone: true,
      },
    });
    state.queries.set(getFunctionName(hrRefs.employeesPage), answer(linked));
    state.queries.set(getFunctionName(hrRefs.employee), {
      ok: true,
      value: { ok: true, employee: linked },
    });
    state.save.mockResolvedValue({
      ok: true,
      value: { written: true, documentId: "e7", replayed: false },
    });
    const list = `/${locale}/hr/employees?q=Som#registry`;
    window.history.pushState({}, "", list);
    renderWithIntl(
      <DraftGuardProvider>
        <main>
          <HrEmployeesScreen />
        </main>
      </DraftGuardProvider>,
      { locale, workspace: false },
    );
    const copy =
      locale === "en"
        ? {
            edit: /Edit.*Somsak/,
            name: "Display name",
            save: "Save employee",
            saved: "Employee saved",
            noSelf: "No HR self-service access",
            noReview: "No HR review access",
            grantSelf: "Open HR access for Nok",
            grantReview: "Open HR access for Lead",
          }
        : {
            edit: /แก้ไข.*Somsak/,
            name: "ชื่อที่แสดง",
            save: "บันทึกพนักงาน",
            saved: "บันทึกพนักงานแล้ว",
            noSelf: "ยังไม่มีสิทธิ์ลงเวลาเอง",
            noReview: "ยังไม่มีสิทธิ์ตรวจทีม",
            grantSelf: "เปิดสิทธิ์ใช้งานฝ่ายบุคคลของ Nok",
            grantReview: "เปิดสิทธิ์ใช้งานฝ่ายบุคคลของ Lead",
          };
    // The registry itself shows which linked member still lacks HR access.
    expect(screen.getAllByText(copy.noSelf).length).toBeGreaterThan(0);
    expect(screen.getAllByText(copy.noReview).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: copy.edit })[0]!);
    const index = appHistoryIndex();
    fireEvent.change(screen.getByRole("textbox", { name: copy.name }), {
      target: { value: "Somsak K." },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
    // The save consumes the owned editor entry and restores the list URL.
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe(list),
    );
    expect(appHistoryIndex()).toBe(index! - 1);
    expect(screen.queryByRole("textbox", { name: copy.name })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    const receipt = await screen.findByTestId("hr-employee-saved");
    expect(receipt).toHaveTextContent(copy.saved);
    expect(receipt).toHaveTextContent("Somsak · EMP-007");
    expect(screen.getByText(copy.saved).closest("[role=status]")).toBeVisible();
    // A handoff to the existing Settings grant, never an automatic one.
    expect(screen.getByRole("link", { name: copy.grantSelf })).toHaveAttribute(
      "href",
      "/hr/settings?section=access&mq=Nok",
    );
    expect(
      screen.getByRole("link", { name: copy.grantReview }),
    ).toHaveAttribute("href", "/hr/settings?section=access&mq=Lead");
    expect(state.save).toHaveBeenCalledTimes(1);
    // The receipt adds no history entry: the next Back reaches the caller.
    await act(async () => {
      const pop = new Promise<void>((resolve) =>
        window.addEventListener("popstate", () => resolve(), { once: true }),
      );
      window.history.back();
      await pop;
    });
    expect(window.location.pathname).toBe("/en/hr/today");
  },
);

it("an employee save receipt gives way to the next editor and omits the handoff once access is granted", async () => {
  state.queries.set(getFunctionName(hrRefs.employee), {
    ok: true,
    value: {
      ok: true,
      employee: {
        ...employee,
        linkedUserId: "u1",
        linkedName: "Nok",
        linkedActive: true,
        linkedSelfAccess: true,
      },
    },
  });
  state.save.mockResolvedValue({
    ok: true,
    value: { written: true, documentId: "e7", replayed: false },
  });
  window.history.pushState({}, "", "/en/hr/employees");
  renderWithIntl(
    <DraftGuardProvider>
      <main>
        <HrEmployeesScreen />
      </main>
    </DraftGuardProvider>,
    { locale: "en", workspace: false },
  );
  fireEvent.click(screen.getAllByRole("button", { name: /Edit.*Somsak/ })[0]!);
  fireEvent.click(screen.getByRole("button", { name: "Save employee" }));
  expect(await screen.findByTestId("hr-employee-saved")).toBeVisible();
  await waitFor(() => expect(window.location.search).toBe(""));
  expect(screen.queryByTestId("hr-employee-access-missing")).toBeNull();
  expect(screen.queryByRole("link", { name: /Open HR access/ })).toBeNull();
  // Opening another editor replaces the terminal receipt; Cancel does not
  // bring it back.
  fireEvent.click(screen.getAllByRole("button", { name: /Edit.*Somsak/ })[0]!);
  expect(screen.queryByTestId("hr-employee-saved")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(window.location.search).toBe(""));
  expect(screen.queryByTestId("hr-employee-saved")).toBeNull();
});
