import {
  getTestMutation,
  registerTestMutation,
} from "@tests/fixtures/convex-mutation";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps, ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";

const mocks = vi.hoisted(() => ({
  mutations: new Map<string, Mock<(args: unknown) => Promise<unknown>>>(),
  queries: new Map<string, unknown>(),
  queryArgs: new Map<string, unknown>(),
  permissions: [
    "masterData.customer.read",
    "masterData.customer.manage",
  ] as string[],
  replace: vi.fn(),
  readiness: { kind: "READY_TO_QUERY" } as { kind: string; requestId?: string },
  // The imperative duplicate check a fast Save runs before creating.
  convexQuery: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useMutation: getTestMutation,
  useConvex: () => ({ query: mocks.convexQuery }),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(ref);
    mocks.queryArgs.set(name, args);
    // The server's own answer to "may this member manage customers?".
    if (name === "customers/catalogue:viewer")
      return {
        ok: true,
        value: {
          canManage: mocks.permissions.includes("masterData.customer.manage"),
        },
      };
    return mocks.queries.get(name);
  },
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ userId: "user-a", orgId: "org-a" }),
}));
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  useWorkspace: () => ({
    readiness: mocks.readiness,
    permissionsReady: mocks.readiness.kind === "READY_TO_QUERY",
    navigationPermissions:
      mocks.readiness.kind === "READY_TO_QUERY" ? mocks.permissions : [],
    warehouses: [],
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace }),
}));

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { api } from "../../../convex/_generated/api";
import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { trackAppHistory } from "@/lib/browser/appHistory";
import {
  CustomerCatalogue,
  CustomerDetail,
  EditCustomerForm,
  NewCustomerForm,
} from "./CustomerScreens";

const READ = "masterData.customer.read";
const MANAGE = "masterData.customer.manage";
const LIST = "customers/catalogue:listCustomersPage";
const GET = "customers/catalogue:getCustomer";
const SIMILAR = "customers/catalogue:findSimilarCustomers";
const SUGGEST = "customers/catalogue:suggestCustomerCode";
const CREATE = api.customers.writes.createCustomer;
const UPDATE = api.customers.writes.updateCustomer;
const ARCHIVE = api.customers.writes.archiveCustomer;
const RESTORE = api.customers.writes.restoreCustomer;
type WriteReference =
  typeof CREATE | typeof UPDATE | typeof ARCHIVE | typeof RESTORE;

/**
 * Registers exactly the customer write a case expects with the strict
 * registry; any other write the screen attempts fails the test.
 */
const mutationFor = (reference: WriteReference) => {
  const name = getFunctionName(reference);
  let fn = mocks.mutations.get(name);
  if (!fn) {
    fn = vi.fn<(args: unknown) => Promise<unknown>>().mockResolvedValue({
      ok: true,
      value: { ok: true, customerId: "customer-new", replayed: false },
    });
    mocks.mutations.set(name, fn);
    registerTestMutation(reference, fn);
  }
  return fn;
};

const LIST_ORIGIN = "/en/master-data/customers?search=thai#list";
const DETAIL_URL = "/en/master-data/customers/customer-a?tab=1#top";

const base = {
  _id: "customer-a",
  _creationTime: 1,
  customerId: "customer-a",
  orgId: "org-a",
  code: "C-0007",
  name: "บริษัท ไทยรุ่งเรืองบรรจุภัณฑ์ จำกัด",
  normalizedName: "บริษัท ไทยรุ่งเรืองบรรจุภัณฑ์ จำกัด",
  status: "ACTIVE" as const,
  version: 3,
  createdAt: 1,
  createdByUserId: "user-a",
  updatedAt: 1,
  updatedByUserId: "user-a",
};
const full = {
  ...base,
  legalNameTh: "บริษัท ไทยรุ่งเรืองบรรจุภัณฑ์ จำกัด",
  taxId: "0105553012341",
  taxIdChecksumValid: true,
  establishment: { kind: "BRANCH" as const, code: "00001" },
  deliveryAddress: {
    label: "Bang Phli plant",
    line: "99/1 Moo 5",
    district: "Bang Phli",
    province: "Samut Prakan",
    postcode: "10540",
  },
  contact: { name: "Somchai", role: "Purchasing", phone: "081-234-5678" },
};
/** The list's summary row: never contact, address lines, tax ID or notes. */
const summary = {
  customerId: "customer-a",
  code: "C-0007",
  name: full.name,
  status: "ACTIVE" as const,
  province: "Samut Prakan",
};
const page = (rows: readonly object[], isDone = true) => ({
  ok: true,
  value: {
    status: "ready",
    page: rows,
    isDone,
    continueCursor: "next",
    scanned: rows.length,
  },
});

let stopHistory: (() => void) | undefined;
beforeEach(() => {
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  mocks.mutations.clear();
  mocks.queries.clear();
  mocks.queryArgs.clear();
  mocks.permissions = [READ, MANAGE];
  mocks.replace.mockReset();
  mocks.queries.set(SUGGEST, { ok: true, value: "C-0031" });
  mocks.queries.set(SIMILAR, { ok: true, value: [] });
  mocks.readiness = { kind: "READY_TO_QUERY" };
  mocks.convexQuery.mockReset();
  mocks.convexQuery.mockImplementation(async () => mocks.queries.get(SIMILAR));
});
afterEach(() => {
  cleanup();
  stopHistory?.();
  stopHistory = undefined;
});

const render = (ui: ReactNode) =>
  renderWithIntl(<DraftGuardProvider>{ui}</DraftGuardProvider>, {
    locale: "en",
    workspace: false,
    preserveProviders: true,
  });
const href = () =>
  window.location.pathname + window.location.search + window.location.hash;
/** An app history: the given origin, then the page under test pushed on it. */
function openFrom(origin: string, current: string) {
  window.history.replaceState({ appNavigationIndex: 0 }, "", origin);
  stopHistory = trackAppHistory();
  window.history.pushState({}, "", current);
}
async function nativeBack() {
  await act(async () => {
    window.history.back();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
  });
}
const type = (name: RegExp | string, value: string) =>
  fireEvent.change(screen.getByRole("textbox", { name }), {
    target: { value },
  });

describe("customer list", () => {
  it("lists active customers with code and delivery province, each linking to its page", () => {
    mocks.queries.set(
      LIST,
      page([
        summary,
        {
          customerId: "b",
          code: "C-0030",
          name: "Somboon Engineering",
          status: "ACTIVE",
        },
      ]),
    );
    render(<CustomerCatalogue />);
    expect(mocks.queryArgs.get(LIST)).toMatchObject({
      status: "ACTIVE",
      pageSize: 20,
    });
    const table = screen.getByTestId("customer-table");
    const link = within(table).getByRole("link", { name: full.name });
    expect(link).toHaveAttribute("href", "/master-data/customers/customer-a");
    expect(within(table).getByText("C-0007")).toBeVisible();
    expect(within(table).getByText("Samut Prakan")).toBeVisible();
    // A customer without an address reads as a dash, never as blank.
    expect(within(table).getByText("—")).toBeVisible();
    expect(within(table).queryByText("Archived")).toBeNull();
    expect(screen.getByTestId("customer-cards")).toBeInTheDocument();
  });

  it("asks for archived customers only through the status filter and badges them", async () => {
    mocks.queries.set(LIST, page([{ ...summary, status: "ARCHIVED" }]));
    render(<CustomerCatalogue />);
    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Archived" }));
    await waitFor(() =>
      expect(mocks.queryArgs.get(LIST)).toMatchObject({ status: "ARCHIVED" }),
    );
    expect(
      within(screen.getByTestId("customer-table")).getByText("Archived"),
    ).toBeVisible();
    // The filter lives in the URL, so Back to the list restores it.
    expect(
      new URLSearchParams(window.location.search).get("customers"),
    ).toContain("ARCHIVED");
  });

  it("sends All as no status filter", async () => {
    mocks.queries.set(LIST, page([summary]));
    render(<CustomerCatalogue />);
    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "All" }));
    await waitFor(() =>
      expect(mocks.queryArgs.get(LIST)).not.toHaveProperty("status"),
    );
  });

  it("offers New customer only to members who may manage customers", () => {
    mocks.queries.set(LIST, page([summary]));
    const { unmount } = render(<CustomerCatalogue />);
    expect(screen.getByTestId("new-customer-action")).toHaveAttribute(
      "href",
      "/master-data/customers/new",
    );
    unmount();
    mocks.permissions = [READ];
    render(<CustomerCatalogue />);
    expect(screen.queryByTestId("new-customer-action")).toBeNull();
  });

  it("guides first use when the organization has no customers yet", () => {
    mocks.queries.set(LIST, page([]));
    render(<CustomerCatalogue />);
    expect(screen.getByText("No customers yet")).toBeVisible();
    expect(
      screen.getByText(
        "Add the customers you make and deliver for. Only the name is required.",
      ),
    ).toBeVisible();
  });

  it("explains a search with no matches and clears it", async () => {
    window.history.replaceState(
      {},
      "",
      `/en/master-data/customers?customers=${encodeURIComponent(JSON.stringify({ search: "zz", status: "ACTIVE" }))}`,
    );
    mocks.queries.set(LIST, page([]));
    render(<CustomerCatalogue />);
    expect(await screen.findByText("No customers match")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() =>
      expect(
        screen.getByRole("searchbox", { name: "Search name, code or tax ID" }),
      ).toHaveValue(""),
    );
  });

  it("typing a search is one history entry: Back leaves the search, not one keystroke", async () => {
    openFrom("/en/master-data/customers", "/en/master-data/customers");
    mocks.queries.set(LIST, page([summary]));
    render(<CustomerCatalogue />);
    const search = screen.getByRole("searchbox", {
      name: "Search name, code or tax ID",
    });
    for (const value of ["A", "Ac", "Acm", "Acme"])
      fireEvent.change(search, { target: { value } });
    await waitFor(() => expect(search).toHaveValue("Acme"));
    await nativeBack();
    await waitFor(() => expect(search).toHaveValue(""));
  });

  it("remembers only the status filter between visits, never the search", async () => {
    mocks.queries.set(LIST, page([summary]));
    render(<CustomerCatalogue />);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search name, code or tax ID" }),
      { target: { value: "0105553012341" } },
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Archived" }));
    await waitFor(() =>
      expect(JSON.stringify({ ...window.localStorage })).toContain("ARCHIVED"),
    );
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(
      "0105553012341",
    );
  });

  it("a member without warehouse access still reaches the customers they may manage", () => {
    mocks.readiness = { kind: "DENIED", requestId: "warehouse-denied" };
    mocks.queries.set(LIST, page([summary]));
    render(<CustomerCatalogue />);
    expect(
      within(screen.getByTestId("customer-table")).getByRole("link", {
        name: full.name,
      }),
    ).toBeVisible();
    expect(screen.getByTestId("new-customer-action")).toBeVisible();
  });

  it("waits for sign-in without querying customers", () => {
    mocks.readiness = { kind: "LOADING" };
    render(<CustomerCatalogue />);
    expect(mocks.queryArgs.has(LIST)).toBe(false);
    expect(screen.getByText("Loading customers…")).toBeInTheDocument();
  });

  it("reports a failed load as an alert", () => {
    mocks.queries.set(LIST, {
      ok: false,
      denial: { code: "DENIED", requestId: "r" },
    });
    render(<CustomerCatalogue />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Customers could not be loaded",
    );
  });
});

describe("new customer", () => {
  it("Cancel returns to the real customer list origin with its query and hash, consuming the task entry", async () => {
    openFrom(LIST_ORIGIN, "/en/master-data/customers/new");
    render(<NewCustomerForm />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(href()).toBe(LIST_ORIGIN));
    expect(window.history.state.appNavigationIndex).toBe(0);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("Cancel on a directly opened new-customer form replaces it with the list", async () => {
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/en/master-data/customers/new",
    );
    stopHistory = trackAppHistory();
    render(<NewCustomerForm />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
        "/master-data/customers",
      ),
    );
  });

  it("saves a name-only customer and completes by replacing the form entry with the new customer", async () => {
    openFrom(LIST_ORIGIN, "/en/master-data/customers/new");
    const create = mutationFor(CREATE);
    render(<NewCustomerForm />);
    expect(screen.getByText("Leave blank to use C-0031.")).toBeVisible();
    type(/Customer name/, "  บริษัท สมบูรณ์การช่าง  ");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(create).toHaveBeenCalledExactlyOnceWith({
      requestId: expect.any(String),
      name: "บริษัท สมบูรณ์การช่าง",
    });
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
        "/master-data/customers/customer-new",
      ),
    );
    // The new customer replaces the form's own entry, right after the list.
    expect(window.history.state.appNavigationIndex).toBe(1);
  });

  it("Save then native Back returns to the list with its actual customer filter", async () => {
    const origin = `/en/master-data/customers?customers=${encodeURIComponent(
      JSON.stringify({ search: "สม", status: "ALL" }),
    )}#list`;
    openFrom(origin, "/en/master-data/customers/new");
    mutationFor(CREATE);
    mocks.replace.mockImplementation((destination: string) =>
      window.history.replaceState(
        window.history.state,
        "",
        `/en${destination}`,
      ),
    );
    render(<NewCustomerForm />);
    type(/Customer name/, "บริษัท สมบูรณ์การช่าง");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    await waitFor(() =>
      expect(href()).toBe("/en/master-data/customers/customer-new"),
    );
    await nativeBack();
    expect(href()).toBe(origin);
  });

  it("two create forms with the same draft send different request IDs; a transport retry reuses its own", async () => {
    const create = mutationFor(CREATE);
    create.mockRejectedValueOnce(new Error("offline"));
    const first = render(<NewCustomerForm />);
    type(/Customer name/, "Same name");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    const [failed, retried] = create.mock.calls.map(
      ([args]) => (args as { requestId: string }).requestId,
    );
    expect(retried).toBe(failed);
    first.unmount();
    render(<NewCustomerForm />);
    type(/Customer name/, "Same name");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    const other = (create.mock.calls[2]![0] as { requestId: string }).requestId;
    expect(other).not.toBe(failed);
  });

  it("keeps no customer field values in browser storage after a refused save", async () => {
    mutationFor(CREATE).mockResolvedValue({
      ok: true,
      value: { ok: false, code: "FIELD_INVALID", field: "contact.email" },
    });
    render(<NewCustomerForm />);
    type(/Customer name/, "Private Co");
    fireEvent.click(screen.getByRole("button", { name: /Tax details/ }));
    type("Tax ID", "0105553012341");
    fireEvent.click(screen.getByRole("button", { name: /^Contact/ }));
    type(/Contact name/, "Somchai Secret");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    const stored = JSON.stringify({
      ...window.localStorage,
      ...window.sessionStorage,
    });
    for (const value of ["Private Co", "0105553012341", "Somchai Secret"])
      expect(stored).not.toContain(value);
  });

  it("checks for a likely duplicate when Save is pressed before the hint appears", async () => {
    const create = mutationFor(CREATE);
    mocks.convexQuery.mockResolvedValue({
      ok: true,
      value: [
        {
          customerId: "customer-a",
          code: "C-0007",
          name: full.name,
          status: "ACTIVE",
        },
      ],
    });
    render(<NewCustomerForm />);
    type(/Customer name/, full.name);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(create).not.toHaveBeenCalled();
    expect(await screen.findByTestId("customer-similar")).toHaveTextContent(
      "C-0007",
    );
    // Seen and saved again on purpose: a duplicate name is allowed.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it("refuses an empty name without calling the server", async () => {
    render(<NewCustomerForm />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(mutationFor(CREATE)).not.toHaveBeenCalled();
    expect(
      screen.getByRole("textbox", { name: /Customer name/ }),
    ).toHaveAttribute("aria-invalid", "true");
  });

  it("shows a likely duplicate before saving and links to the existing customer", async () => {
    mocks.queries.set(SIMILAR, {
      ok: true,
      value: [
        {
          customerId: "customer-a",
          code: "C-0007",
          name: full.name,
          status: "ACTIVE",
        },
      ],
    });
    render(<NewCustomerForm />);
    type(/Customer name/, "บริษัท ไทยรุ่งเรือง");
    const hint = await screen.findByTestId("customer-similar");
    expect(hint).toHaveTextContent("A customer with this name already exists");
    expect(
      within(hint).getByRole("link", { name: "Use this customer" }),
    ).toHaveAttribute("href", "/master-data/customers/customer-a");
    expect(mocks.queryArgs.get(SIMILAR)).toEqual({
      name: "บริษัท ไทยรุ่งเรือง",
    });
  });

  it("warns on a failed tax ID check digit and still saves the digits with leading zeros", async () => {
    mutationFor(CREATE);
    render(<NewCustomerForm />);
    type(/Customer name/, "Sakura Precision (Thailand) Co., Ltd.");
    fireEvent.click(screen.getByRole("button", { name: /Tax details/ }));
    type("Tax ID", "0105 553 012 340");
    expect(screen.getByText(/This tax ID fails the check digit/)).toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: "Head office" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(mutationFor(CREATE)).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Sakura Precision (Thailand) Co., Ltd.",
        taxId: "0105 553 012 340",
        establishment: { kind: "HEAD_OFFICE" },
      }),
    );
  });

  it("opens the section of a refused field, marks it, and keeps the draft", async () => {
    mutationFor(CREATE).mockResolvedValue({
      ok: true,
      value: { ok: false, code: "FIELD_INVALID", field: "establishment" },
    });
    render(<NewCustomerForm />);
    type(/Customer name/, "Branch customer");
    fireEvent.click(screen.getByRole("button", { name: /Tax details/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Branch" }));
    type(/Branch number/, "00000");
    fireEvent.click(screen.getByRole("button", { name: /Tax details/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(
      await screen.findByText(
        "Enter a 5-digit branch number other than 00000.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: /Branch number/ })).toHaveValue(
      "00000",
    );
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("shows a duplicate code on the code field", async () => {
    mutationFor(CREATE).mockResolvedValue({
      ok: true,
      value: { ok: false, code: "DUPLICATE_KEY", field: "code" },
    });
    render(<NewCustomerForm />);
    type(/Customer name/, "Acme");
    type(/Customer code/, "C-0007");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(mutationFor(CREATE)).toHaveBeenCalledWith(
      expect.objectContaining({ code: "C-0007" }),
    );
    expect(
      await screen.findByText("Another customer already uses this code."),
    ).toBeVisible();
  });

  it("a dirty new-customer draft asks before native Back leaves it", async () => {
    openFrom(LIST_ORIGIN, "/en/master-data/customers/new");
    render(<NewCustomerForm />);
    type(/Customer name/, "Unsaved");
    await nativeBack();
    expect(
      await screen.findByRole("dialog", { name: "Discard changes?" }),
    ).toBeVisible();
    expect(href()).toBe("/en/master-data/customers/new");
    expect(screen.getByDisplayValue("Unsaved")).toBeInTheDocument();
  });

  it("view-only members get no form, only a way back", () => {
    mocks.permissions = [READ];
    render(<NewCustomerForm />);
    expect(screen.queryByTestId("customer-form")).toBeNull();
    expect(
      screen.getByText(
        "View only. An administrator can add and edit customers.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Back to customers" }),
    ).toBeVisible();
  });
});

describe("customer detail", () => {
  it("shows code, status, delivery, contact and tax details, with dashes for empty values", () => {
    mocks.queries.set(GET, { ok: true, value: full });
    render(<CustomerDetail customerId="customer-a" />);
    expect(
      screen.getByRole("heading", { level: 1, name: full.name }),
    ).toBeVisible();
    expect(screen.getByText("C-0007")).toBeVisible();
    expect(screen.getByText("Active")).toBeVisible();
    expect(screen.getByText("Bang Phli plant")).toBeVisible();
    expect(screen.getByRole("link", { name: "081-234-5678" })).toHaveAttribute(
      "href",
      "tel:0812345678",
    );
    expect(screen.getByText("0105553012341")).toBeVisible();
    expect(screen.getByText("Branch 00001")).toBeVisible();
    expect(screen.getByText("—")).toBeVisible(); // no English registered name
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/master-data/customers/customer-a/edit",
    );
    expect(screen.queryByTestId("customer-tax-id-warning")).toBeNull();
  });

  it("shows a contact role even without a contact name", () => {
    mocks.queries.set(GET, {
      ok: true,
      value: { ...base, contact: { role: "Purchasing" } },
    });
    render(<CustomerDetail customerId="customer-a" />);
    expect(screen.getByText("Purchasing")).toBeVisible();
    expect(screen.queryByText("No contact yet")).toBeNull();
  });

  it("keeps its header and Back while sign-in settles", () => {
    mocks.readiness = { kind: "LOADING" };
    render(<CustomerDetail customerId="customer-a" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Customer details" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Customers" })).toBeVisible();
    expect(mocks.queryArgs.has(GET)).toBe(false);
  });

  it("flags a stored tax ID that fails the check digit", () => {
    mocks.queries.set(GET, {
      ok: true,
      value: { ...full, taxId: "0105553012340", taxIdChecksumValid: false },
    });
    render(<CustomerDetail customerId="customer-a" />);
    expect(screen.getByTestId("customer-tax-id-warning")).toBeVisible();
  });

  it("a missing or foreign customer keeps a page frame with Back to the list", () => {
    mocks.queries.set(GET, { ok: true, value: null });
    render(<CustomerDetail customerId="nope" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Customer not found" }),
    ).toBeVisible();
    expect(screen.getByTestId("customer-not-found")).toBeVisible();
    expect(screen.getByRole("link", { name: "Customers" })).toHaveAttribute(
      "href",
      "/master-data/customers",
    );
  });

  it("view-only members see no edit or archive actions", () => {
    mocks.permissions = [READ];
    mocks.queries.set(GET, { ok: true, value: full });
    render(<CustomerDetail customerId="customer-a" />);
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });

  it("native Back closes the archive confirmation before leaving the customer", async () => {
    openFrom(LIST_ORIGIN, DETAIL_URL);
    mocks.queries.set(GET, { ok: true, value: full });
    render(<CustomerDetail customerId="customer-a" />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(
      await screen.findByRole("dialog", { name: `Archive ${full.name}?` }),
    ).toBeVisible();
    await nativeBack();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(href()).toBe(DETAIL_URL);
    await nativeBack();
    expect(href()).toBe(LIST_ORIGIN);
    expect(mutationFor(ARCHIVE)).not.toHaveBeenCalled();
  });

  it("archive sends the shown version and consumes its confirmation on success", async () => {
    openFrom(LIST_ORIGIN, DETAIL_URL);
    mocks.queries.set(GET, { ok: true, value: full });
    mutationFor(ARCHIVE).mockResolvedValue({
      ok: true,
      value: { ok: true, customerId: "customer-a", replayed: false },
    });
    render(<CustomerDetail customerId="customer-a" />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    });
    expect(mutationFor(ARCHIVE)).toHaveBeenCalledExactlyOnceWith({
      customerId: "customer-a",
      expectedVersion: 3,
      requestId: expect.any(String),
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(href()).toBe(DETAIL_URL));
    await nativeBack();
    expect(href()).toBe(LIST_ORIGIN);
  });

  it("a refused archive keeps its confirmation open with the reason", async () => {
    mocks.queries.set(GET, { ok: true, value: full });
    mutationFor(ARCHIVE).mockResolvedValue({
      ok: true,
      value: { ok: false, code: "VERSION_CONFLICT" },
    });
    render(<CustomerDetail customerId="customer-a" />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    });
    expect(
      await within(dialog).findByText(
        "Someone else changed this customer while you were editing",
      ),
    ).toBeVisible();
  });

  it("an archived customer offers Restore instead of Edit", async () => {
    mocks.queries.set(GET, {
      ok: true,
      value: { ...full, status: "ARCHIVED" },
    });
    mutationFor(RESTORE);
    render(<CustomerDetail customerId="customer-a" />);
    expect(screen.getByText("This customer is archived")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
    });
    expect(mutationFor(RESTORE)).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "customer-a", expectedVersion: 3 }),
    );
  });
});

describe("edit customer", () => {
  const EDIT_URL = "/en/master-data/customers/customer-a/edit";

  it("Cancel on the editor returns to the customer it was opened from", async () => {
    openFrom(DETAIL_URL, EDIT_URL);
    mocks.queries.set(GET, { ok: true, value: full });
    render(<EditCustomerForm customerId="customer-a" />);
    expect(screen.getByRole("textbox", { name: /Customer name/ })).toHaveValue(
      full.name,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(href()).toBe(DETAIL_URL));
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("Cancel on a directly opened editor replaces it with the customer", async () => {
    window.history.replaceState({ appNavigationIndex: 0 }, "", EDIT_URL);
    stopHistory = trackAppHistory();
    mocks.queries.set(GET, { ok: true, value: full });
    render(<EditCustomerForm customerId="customer-a" />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
        "/master-data/customers/customer-a",
      ),
    );
  });

  it("saves the full edited record at the opened version and completes to the customer", async () => {
    openFrom(DETAIL_URL, EDIT_URL);
    mocks.queries.set(GET, { ok: true, value: full });
    mutationFor(UPDATE).mockResolvedValue({
      ok: true,
      value: { ok: true, customerId: "customer-a", replayed: false },
    });
    render(<EditCustomerForm customerId="customer-a" />);
    expect(
      screen.getByRole("textbox", { name: /Customer code/ }),
    ).toHaveAttribute("readonly");
    type(/Contact name/, "");
    type(/Phone/, "");
    type(/Role/, "");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    const call = mutationFor(UPDATE).mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(call).toMatchObject({
      customerId: "customer-a",
      expectedVersion: 3,
      name: full.name,
      taxId: "0105553012341",
      establishment: { kind: "BRANCH", code: "00001" },
    });
    // A cleared section is cleared, not kept: the update replaces the record.
    expect(call).not.toHaveProperty("contact");
    expect(call).not.toHaveProperty("code");
    // Opened from the customer itself, completion traverses back to that
    // entry, keeping its query and hash, instead of stacking a copy.
    await waitFor(() => expect(href()).toBe(DETAIL_URL));
    expect(window.history.state.appNavigationIndex).toBe(0);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("a version conflict keeps the draft and offers to load the latest version", async () => {
    mocks.queries.set(GET, { ok: true, value: full });
    mutationFor(UPDATE).mockResolvedValue({
      ok: true,
      value: { ok: false, code: "VERSION_CONFLICT" },
    });
    const view = render(<EditCustomerForm customerId="customer-a" />);
    type(/Customer name/, "My rename");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    expect(
      await screen.findByTestId("customer-version-conflict"),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: /Customer name/ })).toHaveValue(
      "My rename",
    );
    mocks.queries.set(GET, {
      ok: true,
      value: { ...full, name: "Their rename", version: 4 },
    });
    view.rerender(
      <DraftGuardProvider>
        <EditCustomerForm customerId="customer-a" />
      </DraftGuardProvider>,
    );
    // A newer saved version does not overwrite the open draft by itself.
    expect(screen.getByRole("textbox", { name: /Customer name/ })).toHaveValue(
      "My rename",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Discard my edits and load the latest",
      }),
    );
    expect(screen.getByRole("textbox", { name: /Customer name/ })).toHaveValue(
      "Their rename",
    );
    mutationFor(UPDATE).mockResolvedValue({
      ok: true,
      value: { ok: true, customerId: "customer-a", replayed: false },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    expect(mutationFor(UPDATE)).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedVersion: 4 }),
    );
  });

  it("an archived customer cannot be saved from the editor", () => {
    mocks.queries.set(GET, {
      ok: true,
      value: { ...full, status: "ARCHIVED" },
    });
    render(<EditCustomerForm customerId="customer-a" />);
    expect(screen.getByTestId("customer-archived-edit")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("a live archive while editing keeps the unsaved draft and blocks saving", async () => {
    mocks.queries.set(GET, { ok: true, value: full });
    const view = render(<EditCustomerForm customerId="customer-a" />);
    type(/Contact name/, "Somchai Jaidee");
    mocks.queries.set(GET, {
      ok: true,
      value: { ...full, status: "ARCHIVED", version: 4 },
    });
    view.rerender(
      <DraftGuardProvider>
        <EditCustomerForm customerId="customer-a" />
      </DraftGuardProvider>,
    );
    expect(screen.getByTestId("customer-archived-edit")).toBeVisible();
    expect(screen.getByRole("textbox", { name: /Contact name/ })).toHaveValue(
      "Somchai Jaidee",
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    // Restored elsewhere: the same draft can now be saved.
    mocks.queries.set(GET, { ok: true, value: { ...full, version: 5 } });
    view.rerender(
      <DraftGuardProvider>
        <EditCustomerForm customerId="customer-a" />
      </DraftGuardProvider>,
    );
    expect(screen.getByRole("textbox", { name: /Contact name/ })).toHaveValue(
      "Somchai Jaidee",
    );
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("freezes the fields while a save is pending, so a later edit cannot look saved", async () => {
    let finish!: (value: unknown) => void;
    mocks.queries.set(GET, { ok: true, value: full });
    mutationFor(UPDATE).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<EditCustomerForm customerId="customer-a" />);
    type(/Customer name/, "First rename");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    expect(
      screen.getByRole("textbox", { name: /Customer name/ }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await act(async () => {
      finish({ ok: true, value: { ok: false, code: "VERSION_CONFLICT" } });
    });
    expect(
      screen.getByRole("textbox", { name: /Customer name/ }),
    ).toBeEnabled();
    expect(mutationFor(UPDATE)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "First rename" }),
    );
  });

  it("Back after a refused edit on a phone keeps the draft behind a discard prompt", async () => {
    window.innerWidth = 390;
    openFrom(DETAIL_URL, EDIT_URL);
    mocks.queries.set(GET, { ok: true, value: full });
    mutationFor(UPDATE).mockResolvedValue({
      ok: true,
      value: { ok: false, code: "VERSION_CONFLICT" },
    });
    render(<EditCustomerForm customerId="customer-a" />);
    type(/Customer name/, "Rename on the road");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    expect(
      await screen.findByTestId("customer-version-conflict"),
    ).toBeVisible();
    await nativeBack();
    expect(
      await screen.findByRole("dialog", { name: "Discard changes?" }),
    ).toBeVisible();
    expect(href()).toBe(EDIT_URL);
    expect(screen.getByDisplayValue("Rename on the road")).toBeInTheDocument();
  });
});
