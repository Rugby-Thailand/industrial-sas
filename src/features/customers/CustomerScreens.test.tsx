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
import {
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
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
  push: vi.fn(),
  replace: vi.fn(),
  linkNavigation: undefined as ((href: string) => void) | undefined,
  availableWarehouses: [] as { id: string; name: string; code: string }[],
  selectWarehouse: vi.fn(),
  readiness: { kind: "READY_TO_QUERY" } as {
    kind: string;
    requestId?: string;
    code?: string;
  },
  viewerPending: false,
  authenticated: true,
  // The live duplicate hint fails with a query error (it never throws).
  hintError: undefined as Error | undefined,
  // The optional code suggestion fails the same way.
  suggestError: undefined as Error | undefined,
  // Optional per-args list answers, for continuation scenarios.
  listResolver: undefined as
    ((args: Record<string, unknown>) => unknown) | undefined,
  // The imperative duplicate check a fast Save runs before creating.
  convexQuery: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useMutation: getTestMutation,
  useConvex: () => ({ query: mocks.convexQuery }),
  useQueries: (
    queries: Record<
      string,
      { query: Parameters<typeof getFunctionName>[0]; args: unknown }
    >,
  ) =>
    Object.fromEntries(
      Object.entries(queries).map(([key, { query, args }]) => {
        const name = getFunctionName(query);
        mocks.queryArgs.set(name, args);
        const error =
          name === "customers/catalogue:suggestCustomerCode"
            ? mocks.suggestError
            : mocks.hintError;
        return [key, error ?? mocks.queries.get(name)];
      }),
    ),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(ref);
    mocks.queryArgs.set(name, args);
    // The server's own answer to "may this member manage customers?".
    if (name === "customers/catalogue:viewer")
      return mocks.viewerPending
        ? undefined
        : {
            ok: true,
            value: {
              canManage: mocks.permissions.includes(
                "masterData.customer.manage",
              ),
            },
          };
    if (name === "customers/catalogue:listCustomersPage" && mocks.listResolver)
      return mocks.listResolver(args as Record<string, unknown>);
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
    // Sign-in settles independently of the warehouse workspace read.
    authenticated: mocks.authenticated,
    failed: mocks.readiness.kind === "ERROR",
    permissionsReady: mocks.readiness.kind === "READY_TO_QUERY",
    navigationPermissions:
      mocks.readiness.kind === "READY_TO_QUERY" ? mocks.permissions : [],
    warehouses: mocks.availableWarehouses,
    selectWarehouse: mocks.selectWarehouse,
  }),
}));
function subscribeToTestUrl(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener("test-url-navigation", listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener("test-url-navigation", listener);
  };
}
vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(
      useSyncExternalStore(
        subscribeToTestUrl,
        () => window.location.search,
        () => "",
      ),
    ),
  usePathname: () => window.location.pathname,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    children,
    onNavigate,
    prefetch: _prefetch,
    ...props
  }: ComponentProps<"a"> & {
    onNavigate?: () => void;
    prefetch?: boolean;
  }) => (
    <a
      {...props}
      onClick={(event) => {
        props.onClick?.(event);
        if (mocks.linkNavigation && props.href?.startsWith("/")) {
          event.preventDefault();
          onNavigate?.();
          mocks.linkNavigation(props.href);
        }
      }}
    >
      {children}
    </a>
  ),
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
    back: () => window.history.back(),
  }),
}));

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { api } from "../../../convex/_generated/api";
import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { WorkspaceAccessBoundary } from "@/components/providers/WorkspaceAccessBoundary";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { CustomerCatalogue } from "./CustomerList";
import { EditCustomerForm } from "./CustomerDetail";
import { CustomerWorkspace as CustomerDetail } from "./CustomerWorkspace";
import { NewCustomerForm } from "./CustomerForm";
import { CustomerPicker } from "./CustomerPicker";
import { CustomerReviewQueue } from "./CustomerReviewQueue";

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
const ADD_ALIAS_REF = api.customers.linking.addCustomerAlias;
const REMOVE_ALIAS_REF = api.customers.linking.removeCustomerAlias;
const RESOLVE_REF = api.customers.linking.resolveUnresolvedScans;
type WriteReference =
  | typeof CREATE
  | typeof UPDATE
  | typeof ARCHIVE
  | typeof RESTORE
  | typeof ADD_ALIAS_REF
  | typeof REMOVE_ALIAS_REF
  | typeof RESOLVE_REF;

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

const SHELL = getFunctionName(api.customers.workspace.getCustomerWorkspace);
const WORKSPACE_JOBS = getFunctionName(
  api.customers.workspace.listCustomerWorkspaceJobs,
);
const WORKSPACE_PRODUCTS = getFunctionName(
  api.customers.workspace.listCustomerWorkspaceProducts,
);
const WORKSPACE_ALIASES = getFunctionName(
  api.customers.linking.listCustomerAliasesPage,
);
const WAREHOUSE_READ = "masterData.storageLayout.read";
const job = {
  jobScanId: "scan-1",
  factoryOrder: "FO-2511-0423",
  partName: "กล่องลูกฟูก 5 ชั้น",
  productCode: "TRR-BX5",
  warehouseId: "wh-1",
  warehouseName: "Bang Phli",
  createdAt: 1_763_380_800_000,
  source: "AI",
  mapped: false,
  locationText: "A12",
  customerLinkSource: "AUTO",
};
const product = {
  productId: "prod-1",
  sku: "TRR-BX5",
  name: "กล่องลูกฟูก 5 ชั้น",
  unit: "pcs",
  status: "ACTIVE",
  warehouseId: "wh-1",
  warehouseName: "Bang Phli",
  storedCount: 2,
  pallets: [
    {
      palletId: "pallet-1",
      code: "PLT-1",
      quantity: 25,
      positionCode: "B-02",
      zoneLabel: "North",
    },
  ],
  zones: ["North"],
  hasMorePallets: true,
};
const bounded = (count: number, complete = true) => ({ count, complete });
const shell = (override: Record<string, unknown> = {}) => ({
  ok: true,
  value: {
    access: {
      canManage: mocks.permissions.includes(MANAGE),
      canViewWarehouseData: mocks.permissions.includes(WAREHOUSE_READ),
      canReview: false,
      canScan: false,
    },
    warehouses: [{ warehouseId: "wh-1", name: "Bang Phli", code: "BP" }],
    scopeAvailable: true,
    warehousesComplete: true,
    rollup: {
      linkedJobs: bounded(1),
      linkedProducts: bounded(1),
      storedPallets: bounded(2),
      unmappedJobs: bounded(1),
    },
    latestJobs: [job],
    ...override,
  },
});
const workspacePage = (items: readonly object[], continueCursor = "") => ({
  ok: true,
  value: {
    canViewWarehouseData: true,
    items,
    isDone: !continueCursor,
    continueCursor,
  },
});
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
  window.sessionStorage.clear();
  mocks.mutations.clear();
  mocks.queries.clear();
  mocks.queryArgs.clear();
  mocks.permissions = [READ, MANAGE];
  mocks.linkNavigation = undefined;
  mocks.availableWarehouses = [];
  mocks.selectWarehouse.mockReset();
  mocks.queries.set(SHELL, shell());
  mocks.push.mockReset();
  mocks.replace.mockReset();
  mocks.queries.set(SUGGEST, { ok: true, value: "C-0031" });
  mocks.queries.set(SIMILAR, { ok: true, value: [] });
  mocks.readiness = { kind: "READY_TO_QUERY" };
  mocks.viewerPending = false;
  mocks.authenticated = true;
  mocks.hintError = undefined;
  mocks.suggestError = undefined;
  mocks.listResolver = undefined;
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
/** Chooses the listed existing customer, confirming the draft discard. */
async function chooseExisting(expectedPath: string) {
  fireEvent.click(
    within(screen.getByTestId("customer-similar")).getByRole("button", {
      name: "Use this customer",
    }),
  );
  const prompt = await screen.findByRole("dialog", {
    name: "Discard changes?",
  });
  fireEvent.click(
    within(prompt).getByRole("button", { name: "Discard changes" }),
  );
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(expectedPath));
}
function configureWorkspaceTestRouter() {
  function change(path: string, replace: boolean) {
    const next = path.startsWith("/en/") ? path : `/en${path}`;
    if (replace) window.history.replaceState(window.history.state, "", next);
    else window.history.pushState({}, "", next);
    window.dispatchEvent(new Event("test-url-navigation"));
  }
  mocks.push.mockImplementation((path: string) => change(path, false));
  mocks.replace.mockImplementation((path: string) => change(path, true));
  mocks.linkNavigation = (path: string) => change(path, false);
}

function directSection(section: string) {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    `/en/master-data/customers/customer-a?section=${section}`,
  );
}
function enableWarehouseWorkspace() {
  mocks.permissions = [READ, MANAGE, WAREHOUSE_READ];
  mocks.queries.set(SHELL, shell());
  mocks.queries.set(WORKSPACE_PRODUCTS, workspacePage([product]));
}
function chooseWorkspaceSection(name: string) {
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: "Customer workspace sections" }),
    ).getByRole("button", { name }),
  );
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
        screen.getByRole("searchbox", {
          name: "Search name, code, alias or tax ID",
        }),
      ).toHaveValue(""),
    );
  });

  it("typing a search is one history entry: Back leaves the search, not one keystroke", async () => {
    openFrom("/en/master-data/customers", "/en/master-data/customers");
    mocks.queries.set(LIST, page([summary]));
    render(<CustomerCatalogue />);
    const search = screen.getByRole("searchbox", {
      name: "Search name, code, alias or tax ID",
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
      screen.getByRole("searchbox", {
        name: "Search name, code, alias or tax ID",
      }),
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
    mocks.authenticated = false;
    render(<CustomerCatalogue />);
    expect(mocks.queryArgs.has(LIST)).toBe(false);
    expect(screen.getByText("Loading customers…")).toBeInTheDocument();
  });

  it("ignores a search remembered by an earlier build", () => {
    window.localStorage.setItem(
      "customers:org-a:user-a",
      JSON.stringify({ search: "0105553012341", status: "ARCHIVED" }),
    );
    window.history.replaceState({}, "", "/en/master-data/customers");
    mocks.queries.set(LIST, page([summary]));
    render(<CustomerCatalogue />);
    expect(
      screen.getByRole("searchbox", {
        name: "Search name, code, alias or tax ID",
      }),
    ).toHaveValue("");
    expect(mocks.queryArgs.get(LIST)).toMatchObject({
      search: "",
      status: "ARCHIVED",
    });
  });

  it("shows a refused list read as an access decision, not a connection problem", () => {
    mocks.queries.set(LIST, {
      ok: false,
      denial: { code: "AUTHORIZATION_DENIED", requestId: "req-7" },
    });
    render(<CustomerCatalogue />);
    expect(screen.queryByText("Customers could not be loaded")).toBeNull();
    expect(screen.getByText(/req-7/)).toBeInTheDocument();
  });

  it("a list that changed under its cursor offers to load it again", async () => {
    // Every scan continuation is stale. A first-page read starts a scan;
    // only the third fresh start (after the person's Load again) finishes.
    let starts = 0;
    let previous = "";
    mocks.listResolver = (args) => {
      const key = JSON.stringify(args);
      if (key !== previous && !args.scanCursor) starts += 1;
      previous = key;
      if (args.scanCursor)
        return {
          ok: true,
          value: {
            status: "reset",
            page: [],
            isDone: false,
            continueCursor: "",
            scanned: 0,
          },
        };
      return starts >= 3
        ? page([summary])
        : {
            ok: true,
            value: {
              status: "scanning",
              page: [],
              isDone: false,
              continueCursor: "",
              scanCursor: "stale",
              scanned: 20,
            },
          };
    };
    render(<CustomerCatalogue />);
    // One automatic reset, then the list stops and asks.
    expect(
      await screen.findByTestId("customer-list-changed"),
    ).toHaveTextContent("The customer list changed while it was loading");
    expect(starts).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Load again" }));
    expect(
      await within(await screen.findByTestId("customer-table")).findByRole(
        "link",
        { name: full.name },
      ),
    ).toBeVisible();
    expect(screen.queryByTestId("customer-list-changed")).toBeNull();
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
    await waitFor(() => expect(href()).toBe(origin));
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

  it("a failing code suggestion keeps the form and falls back to the generic hint", () => {
    mocks.suggestError = new Error("query failed");
    render(<NewCustomerForm />);
    type(/Customer name/, "Suggestion Down Co");
    expect(screen.getByTestId("customer-form")).toBeInTheDocument();
    expect(
      screen.getByText("Leave blank to number it automatically."),
    ).toBeVisible();
    expect(screen.getByDisplayValue("Suggestion Down Co")).toBeInTheDocument();
  });

  it("a duplicate check failing synchronously offers an explicit save without checking", async () => {
    const create = mutationFor(CREATE);
    mocks.convexQuery.mockImplementation(() => {
      throw new Error("cached failure");
    });
    render(<NewCustomerForm />);
    type(/Customer name/, "Cached Failure Co");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByTestId("customer-save-error")).toHaveTextContent(
      "Couldn't check for a customer with this name",
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Save without checking" }),
      );
    });
    expect(create).toHaveBeenCalledExactlyOnceWith({
      requestId: expect.any(String),
      name: "Cached Failure Co",
    });
  });

  it("a failed check for one name never lets another name skip its check", async () => {
    const create = mutationFor(CREATE);
    mocks.convexQuery.mockImplementationOnce(() => {
      throw new Error("cached failure");
    });
    render(<NewCustomerForm />);
    type(/Customer name/, "Name A");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(
      screen.getByRole("button", { name: "Save without checking" }),
    ).toBeVisible();
    type(/Customer name/, full.name);
    // The override belonged to Name A: it disappears for the new name.
    expect(
      screen.queryByRole("button", { name: "Save without checking" }),
    ).toBeNull();
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
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(create).not.toHaveBeenCalled();
    expect(await screen.findByTestId("customer-similar")).toHaveTextContent(
      "C-0007",
    );
  });

  it("a newer live duplicate answer replaces the one found at Save, including an empty one", async () => {
    const match = (customerId: string, code: string) => ({
      customerId,
      code,
      name: "Acme",
      status: "ACTIVE",
    });
    mutationFor(CREATE);
    mocks.convexQuery.mockResolvedValue({
      ok: true,
      value: [match("old", "OLD-1")],
    });
    mocks.queries.set(SIMILAR, {
      ok: true,
      value: [match("customer-b", "NEW-2")],
    });
    const view = render(<NewCustomerForm />);
    type(/Customer name/, "Acme");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(screen.getByTestId("customer-similar")).toHaveTextContent("OLD-1");
    // The live hint settles on the current name: it is authoritative.
    await waitFor(() =>
      expect(screen.getByTestId("customer-similar")).toHaveTextContent("NEW-2"),
    );
    // An empty live answer is authoritative too: nothing to choose.
    mocks.queries.set(SIMILAR, { ok: true, value: [] });
    view.rerender(
      <DraftGuardProvider>
        <NewCustomerForm />
      </DraftGuardProvider>,
    );
    expect(screen.queryByTestId("customer-similar")).toBeNull();
    // When it lists the newer record again, choosing it opens that record.
    mocks.queries.set(SIMILAR, {
      ok: true,
      value: [match("customer-b", "NEW-2")],
    });
    view.rerender(
      <DraftGuardProvider>
        <NewCustomerForm />
      </DraftGuardProvider>,
    );
    await chooseExisting("/master-data/customers/customer-b");
  });

  it("choosing an existing customer replaces the form: Back restores the filtered list, Forward the customer", async () => {
    const origin = `/en/master-data/customers?customers=${encodeURIComponent(
      JSON.stringify({ search: "acm", status: "ALL" }),
    )}#list`;
    openFrom(origin, "/en/master-data/customers/new");
    mocks.replace.mockImplementation((destination: string) =>
      window.history.replaceState(
        window.history.state,
        "",
        `/en${destination}`,
      ),
    );
    mocks.queries.set(SIMILAR, {
      ok: true,
      value: [
        {
          customerId: "customer-a",
          code: "C-0007",
          name: "Acme",
          status: "ACTIVE",
        },
      ],
    });
    render(<NewCustomerForm />);
    type(/Customer name/, "Acme");
    await screen.findByTestId("customer-similar");
    await chooseExisting("/master-data/customers/customer-a");
    await waitFor(() =>
      expect(href()).toBe("/en/master-data/customers/customer-a"),
    );
    await nativeBack();
    await waitFor(() => expect(href()).toBe(origin));
    await act(async () => {
      window.history.forward();
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
    });
    await waitFor(() =>
      expect(href()).toBe("/en/master-data/customers/customer-a"),
    );
  });

  it("a superseded Save-time match never returns after the name goes away and back", async () => {
    const create = mutationFor(CREATE);
    const match = (customerId: string, code: string) => ({
      customerId,
      code,
      name: "Acme",
      status: "ACTIVE",
    });
    mocks.convexQuery.mockResolvedValueOnce({
      ok: true,
      value: [match("customer-a", "OLD-1")],
    });
    mocks.queries.set(SIMILAR, { ok: true, value: [] });
    render(<NewCustomerForm />);
    type(/Customer name/, "Acme");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(screen.getByTestId("customer-similar")).toHaveTextContent("OLD-1");
    // The live answer (empty) supersedes it.
    await waitFor(() =>
      expect(screen.queryByTestId("customer-similar")).toBeNull(),
    );
    type(/Customer name/, "Other");
    await waitFor(() =>
      expect(mocks.queryArgs.get(SIMILAR)).toEqual({ name: "Other" }),
    );
    // Back to Acme, before its live answer settles: the old match stays
    // gone, and Save asks again instead of creating blind.
    type(/Customer name/, "Acme");
    expect(screen.queryByTestId("customer-similar")).toBeNull();
    mocks.convexQuery.mockResolvedValueOnce({
      ok: true,
      value: [match("customer-b", "NEW-2")],
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(mocks.convexQuery).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
    await chooseExisting("/master-data/customers/customer-b");
  });

  it("editing the name retires a Save-time match even while the live hint never answers", async () => {
    const create = mutationFor(CREATE);
    const match = (customerId: string, code: string) => ({
      customerId,
      code,
      name: "Acme",
      status: "ACTIVE",
    });
    // The live hint stays unavailable throughout, so only the name edit
    // can retire the Save-time answer.
    mocks.queries.delete(SIMILAR);
    mocks.convexQuery
      .mockResolvedValueOnce({
        ok: true,
        value: [match("customer-a", "OLD-1")],
      })
      .mockResolvedValueOnce({
        ok: true,
        value: [match("customer-b", "NEW-2")],
      });
    render(<NewCustomerForm />);
    type(/Customer name/, "Acme");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(screen.getByTestId("customer-similar")).toHaveTextContent("OLD-1");
    type(/Customer name/, "Beta");
    type(/Customer name/, "Acme");
    expect(screen.queryByTestId("customer-similar")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(mocks.convexQuery).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
    await chooseExisting("/master-data/customers/customer-b");
  });

  it("a live error after a live match does not bring back the Save-time match", async () => {
    const match = (customerId: string, code: string) => ({
      customerId,
      code,
      name: "Acme",
      status: "ACTIVE",
    });
    mocks.convexQuery.mockResolvedValueOnce({
      ok: true,
      value: [match("customer-a", "OLD-1")],
    });
    mocks.queries.set(SIMILAR, {
      ok: true,
      value: [match("customer-b", "NEW-2")],
    });
    const view = render(<NewCustomerForm />);
    type(/Customer name/, "Acme");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    await waitFor(() =>
      expect(screen.getByTestId("customer-similar")).toHaveTextContent("NEW-2"),
    );
    mocks.hintError = new Error("live query failed");
    view.rerender(
      <DraftGuardProvider>
        <NewCustomerForm />
      </DraftGuardProvider>,
    );
    expect(screen.queryByText("OLD-1")).toBeNull();
  });

  it("a retry that sends the same trimmed command keeps its request ID", async () => {
    const create = mutationFor(CREATE);
    create.mockRejectedValueOnce(new Error("reply lost"));
    render(<NewCustomerForm />);
    type(/Customer name/, "Example Co ");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    type(/Customer name/, "Example Co");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    const [first, retry] = create.mock.calls.map(
      ([args]) => args as { requestId: string; name: string },
    );
    expect(retry!.name).toBe(first!.name);
    expect(retry!.requestId).toBe(first!.requestId);
  });

  it("a failing live duplicate hint keeps the form and its draft", async () => {
    mocks.hintError = new Error("query failed");
    const create = mutationFor(CREATE);
    render(<NewCustomerForm />);
    type(/Customer name/, "Hint Down Co");
    await waitFor(() =>
      expect(mocks.queryArgs.get(SIMILAR)).toEqual({ name: "Hint Down Co" }),
    );
    expect(screen.getByTestId("customer-form")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Hint Down Co")).toBeInTheDocument();
    // Save still checks for duplicates itself before creating.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(mocks.convexQuery).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
  });

  it("a failed duplicate check keeps the draft and creates nothing until a retry succeeds", async () => {
    const create = mutationFor(CREATE);
    mocks.convexQuery.mockRejectedValueOnce(new Error("offline"));
    render(<NewCustomerForm />);
    type(/Customer name/, "Offline Co");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByTestId("customer-save-error")).toHaveTextContent(
      "Couldn't check for a customer with this name",
    );
    expect(screen.getByDisplayValue("Offline Co")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it("a form closed while its duplicate check runs never starts a write", async () => {
    const create = mutationFor(CREATE);
    let answer!: (value: unknown) => void;
    mocks.convexQuery.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const view = render(<NewCustomerForm />);
    type(/Customer name/, "Closing Co");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    view.unmount();
    await act(async () => {
      answer({ ok: true, value: [] });
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("waits for the server's manage answer before showing an editable form", () => {
    mocks.viewerPending = true;
    render(<NewCustomerForm />);
    expect(screen.queryByTestId("customer-form")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save customer" })).toBeNull();
  });

  it("Forward after saving and going Back reaches the customer, never the closed form", async () => {
    openFrom(LIST_ORIGIN, "/en/master-data/customers/new");
    mutationFor(CREATE);
    mocks.replace.mockImplementation((destination: string) =>
      window.history.replaceState(
        window.history.state,
        "",
        `/en${destination}`,
      ),
    );
    render(<NewCustomerForm />);
    type(/Customer name/, "Forward Co");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    await waitFor(() =>
      expect(href()).toBe("/en/master-data/customers/customer-new"),
    );
    await nativeBack();
    await waitFor(() => expect(href()).toBe(LIST_ORIGIN));
    await act(async () => {
      window.history.forward();
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
    });
    await waitFor(() =>
      expect(href()).toBe("/en/master-data/customers/customer-new"),
    );
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
    await chooseExisting("/master-data/customers/customer-a");
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
    configureWorkspaceTestRouter();
    mocks.queries.set(GET, { ok: true, value: full });
    render(<CustomerDetail customerId="customer-a" />);
    expect(
      screen.getByRole("heading", { level: 1, name: full.name }),
    ).toBeVisible();
    expect(screen.getByText("C-0007")).toBeVisible();
    expect(
      within(screen.getByRole("banner")).getByText("Active"),
    ).toBeVisible();
    expect(screen.getByText("Bang Phli plant")).toBeVisible();
    expect(screen.getByRole("link", { name: "081-234-5678" })).toHaveAttribute(
      "href",
      "tel:0812345678",
    );
    chooseWorkspaceSection("Details");
    expect(screen.getByText("0105553012341")).toBeVisible();
    expect(screen.getByText("Branch 00001")).toBeVisible();
    expect(screen.getByText("—")).toBeVisible(); // no English registered name
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/master-data/customers/customer-a/edit",
    );
    expect(screen.queryByTestId("customer-tax-id-warning")).toBeNull();
  });

  it.each([
    ["sales@example.org", "mailto:sales@example.org"],
    ["sales+th@example.org", "mailto:sales%2Bth@example.org"],
  ])("links the contact email %s with a literal @", (email, expected) => {
    mocks.queries.set(GET, {
      ok: true,
      value: { ...base, contact: { name: "Sales", email } },
    });
    render(<CustomerDetail customerId="customer-a" />);
    expect(screen.getByRole("link", { name: email })).toHaveAttribute(
      "href",
      expected,
    );
  });

  it("shows a switchboard label with an extension as dialable base digits", () => {
    mocks.queries.set(GET, {
      ok: true,
      value: {
        ...base,
        contact: { name: "Desk", phone: "PBX 02-123-4567 ext 89" },
      },
    });
    render(<CustomerDetail customerId="customer-a" />);
    expect(
      screen.getByRole("link", { name: "PBX 02-123-4567 ext 89" }),
    ).toHaveAttribute("href", "tel:021234567");
  });

  it.each([
    ["ติดต่อ 02-123-4567", "tel:021234567"],
    ["Call/text 081-234-5678", "tel:0812345678"],
  ])("keeps tap-to-call for the labelled number %s", (phone, expected) => {
    mocks.queries.set(GET, {
      ok: true,
      value: { ...base, contact: { name: "Desk", phone } },
    });
    render(<CustomerDetail customerId="customer-a" />);
    expect(screen.getByRole("link", { name: phone })).toHaveAttribute(
      "href",
      expected,
    );
  });

  it("dials the phone number, not the digits in a label before it", () => {
    mocks.queries.set(GET, {
      ok: true,
      value: {
        ...base,
        contact: { name: "Desk", phone: "24h hotline: 02-123-4567" },
      },
    });
    render(<CustomerDetail customerId="customer-a" />);
    expect(
      screen.getByRole("link", { name: "24h hotline: 02-123-4567" }),
    ).toHaveAttribute("href", "tel:021234567");
  });

  it("shows an extension with no base number as plain text", () => {
    mocks.queries.set(GET, {
      ok: true,
      value: { ...base, contact: { name: "Desk", phone: "PBX ext. 89" } },
    });
    render(<CustomerDetail customerId="customer-a" />);
    expect(screen.getByText("PBX ext. 89")).toBeVisible();
    expect(screen.queryByRole("link", { name: "PBX ext. 89" })).toBeNull();
  });

  it("shows a phone with nothing dialable as plain text", () => {
    mocks.queries.set(GET, {
      ok: true,
      value: { ...base, contact: { name: "Desk", phone: "ask reception" } },
    });
    render(<CustomerDetail customerId="customer-a" />);
    expect(screen.getByText("ask reception")).toBeVisible();
    expect(screen.queryByRole("link", { name: "ask reception" })).toBeNull();
  });

  it("dials the base number when a phone has an extension", () => {
    mocks.queries.set(GET, {
      ok: true,
      value: {
        ...base,
        contact: { name: "Desk", phone: "02-123-4567 ต่อ 89" },
      },
    });
    render(<CustomerDetail customerId="customer-a" />);
    expect(
      screen.getByRole("link", { name: "02-123-4567 ต่อ 89" }),
    ).toHaveAttribute("href", "tel:021234567");
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
    mocks.authenticated = false;
    render(<CustomerDetail customerId="customer-a" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Customer details" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Back" })).toBeVisible();
    expect(mocks.queryArgs.has(GET)).toBe(false);
  });

  it("flags a stored tax ID that fails the check digit", () => {
    directSection("details");
    mocks.queries.set(GET, {
      ok: true,
      value: { ...full, taxId: "0105553012340", taxIdChecksumValid: false },
    });
    render(<CustomerDetail customerId="customer-a" />);
    expect(screen.getByTestId("customer-tax-id-warning")).toBeVisible();
  });

  it("a missing or foreign customer keeps a page frame with Back to the list", () => {
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/en/master-data/customers/nope",
    );
    mocks.queries.set(GET, { ok: true, value: null });
    render(<CustomerDetail customerId="nope" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Customer not found" }),
    ).toBeVisible();
    expect(screen.getByTestId("customer-not-found")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(mocks.replace).toHaveBeenCalledWith("/master-data/customers");
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
    await waitFor(() => expect(href()).toBe(LIST_ORIGIN));
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
    await waitFor(() => expect(href()).toBe(LIST_ORIGIN));
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
    // Nothing newer has arrived yet, so there is nothing to load.
    expect(
      screen.queryByRole("button", {
        name: "Discard my edits and load the latest",
      }),
    ).toBeNull();
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

  it("a retry after a lost reply resends the first command, not one rebased on a newer version", async () => {
    mocks.queries.set(GET, { ok: true, value: full });
    mutationFor(UPDATE).mockRejectedValueOnce(new Error("reply lost"));
    const view = render(<EditCustomerForm customerId="customer-a" />);
    // A save with nothing changed: the landed write leaves every editable
    // field identical, so the editor's expected version moves to 4.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    mocks.queries.set(GET, { ok: true, value: { ...full, version: 4 } });
    view.rerender(
      <DraftGuardProvider>
        <EditCustomerForm customerId="customer-a" />
      </DraftGuardProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    const [first, retry] = mutationFor(UPDATE).mock.calls.map(
      ([args]) => args as { requestId: string; expectedVersion: number },
    );
    expect(first!.expectedVersion).toBe(3);
    expect(retry!.requestId).toBe(first!.requestId);
    expect(retry!.expectedVersion).toBe(3);
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

  it("a failing warehouse workspace read never unmounts an open customer editor", () => {
    // Under the real desktop access boundary, as the app mounts it.
    window.history.replaceState(
      {},
      "",
      "/en/master-data/customers/customer-a/edit",
    );
    mocks.queries.set(GET, { ok: true, value: full });
    const editor = () => (
      <WorkspaceAccessBoundary>
        <EditCustomerForm customerId="customer-a" />
      </WorkspaceAccessBoundary>
    );
    const view = render(editor());
    type(/Contact name/, "Unsaved contact");
    mocks.readiness = { kind: "ERROR", code: "WORKSPACE_UNAVAILABLE" };
    view.rerender(<DraftGuardProvider>{editor()}</DraftGuardProvider>);
    expect(screen.getByTestId("customer-form")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-query-error")).toBeNull();
    expect(screen.getByDisplayValue("Unsaved contact")).toBeInTheDocument();
    mocks.readiness = { kind: "LOADING" };
    view.rerender(<DraftGuardProvider>{editor()}</DraftGuardProvider>);
    expect(screen.getByDisplayValue("Unsaved contact")).toBeInTheDocument();
    // Recovery: the very same input still holds the edit, never remounted.
    const input = screen.getByRole("textbox", { name: /Contact name/ });
    mocks.readiness = { kind: "READY_TO_QUERY" };
    view.rerender(<DraftGuardProvider>{editor()}</DraftGuardProvider>);
    expect(screen.getByRole("textbox", { name: /Contact name/ })).toBe(input);
    expect(input).toHaveValue("Unsaved contact");
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
    // Archive and restore changed no editable field: the draft saves
    // against the restored version, with the edit intact.
    mutationFor(UPDATE).mockResolvedValue({
      ok: true,
      value: { ok: true, customerId: "customer-a", replayed: false },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    expect(mutationFor(UPDATE)).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 5,
        contact: expect.objectContaining({ name: "Somchai Jaidee" }),
      }),
    );
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

describe("customer v2 linking, detail activity and review queue", () => {
  const REVIEW_SUMMARY = getFunctionName(api.customers.linking.reviewSummary);
  const ACTIVITY_SUMMARIES = getFunctionName(
    api.customers.linking.listCustomerActivitySummaries,
  );
  const UNRESOLVED = getFunctionName(api.customers.linking.listUnresolvedNames);
  const OPTIONS = getFunctionName(api.customers.linking.searchCustomerOptions);
  const ADD_ALIAS = ADD_ALIAS_REF;
  const REMOVE_ALIAS = REMOVE_ALIAS_REF;
  const RESOLVE = RESOLVE_REF;
  const REVIEW_URL = "/en/master-data/customers/review";
  const LIST_URL = "/en/master-data/customers";

  it("shows the unresolved-names review banner and linked activity columns on the list", () => {
    mocks.queries.set(REVIEW_SUMMARY, {
      ok: true,
      value: {
        canViewWarehouseData: true,
        canReview: true,
        unresolvedNameCount: 2,
        unresolvedScanCount: 5,
        hasMore: false,
      },
    });
    mocks.queries.set(LIST, {
      ok: true,
      value: {
        status: "ready",
        page: [
          {
            customerId: "customer-a",
            code: "C-0007",
            name: "บริษัท ไทยรุ่งเรืองบรรจุภัณฑ์ จำกัด",
            status: "ACTIVE",
            province: "ชลบุรี",
          },
        ],
        isDone: true,
        continueCursor: "",
        scanned: 1,
      },
    });
    mocks.queries.set(ACTIVITY_SUMMARIES, {
      ok: true,
      value: {
        canViewWarehouseData: true,
        summaries: [
          {
            customerId: "customer-a",
            linkedProductCount: 4,
            latestJob: {
              jobScanId: "scan-1",
              factoryOrder: "FO-2511-0423",
              createdAt: 1_763_380_800_000,
              warehouseId: "wh-1",
            },
          },
        ],
      },
    });
    render(<CustomerCatalogue />);
    const banner = screen.getByTestId("customer-review-banner");
    expect(banner).toHaveTextContent("2 names from 5 job tickets");
    expect(
      within(banner).getByRole("link", { name: "Review" }),
    ).toHaveAttribute("href", "/master-data/customers/review");
    const table = screen.getByTestId("customer-table");
    expect(within(table).getByText("Products")).toBeInTheDocument();
    expect(within(table).getByText("Latest job")).toBeInTheDocument();
    expect(within(table).getByText("4")).toBeInTheDocument();
    expect(within(table).getByText("FO-2511-0423")).toBeInTheDocument();
  });

  it("shows partial review banner counts when reviewSummary reports hasMore", () => {
    mocks.queries.set(REVIEW_SUMMARY, {
      ok: true,
      value: {
        canViewWarehouseData: true,
        canReview: true,
        unresolvedNameCount: 12,
        unresolvedScanCount: 300,
        hasMore: true,
      },
    });
    mocks.queries.set(LIST, {
      ok: true,
      value: {
        status: "ready",
        page: [],
        isDone: true,
        continueCursor: "",
        scanned: 0,
      },
    });
    render(<CustomerCatalogue />);
    expect(screen.getByTestId("customer-review-banner")).toHaveTextContent(
      "12+ names from 300+ job tickets not linked to a customer",
    );
  });

  it("renders linked jobs, linked products, and manages job-ticket aliases on customer detail", async () => {
    configureWorkspaceTestRouter();
    enableWarehouseWorkspace();
    mocks.queries.set(GET, { ok: true, value: full });
    mocks.queries.set(
      WORKSPACE_ALIASES,
      workspacePage([
        { aliasId: "alias-1", alias: "บจก.ไทยรุ่งเรือง", approvedAt: 1 },
      ]),
    );
    mutationFor(ADD_ALIAS).mockResolvedValue({
      ok: true,
      value: { ok: false, code: "DUPLICATE_KEY", field: "alias" },
    });
    mutationFor(REMOVE_ALIAS).mockResolvedValue({
      ok: true,
      value: { ok: true, aliasId: "alias-1", replayed: false },
    });

    render(<CustomerDetail customerId="customer-a" />);
    expect(screen.getByTestId("customer-recent-jobs")).toHaveTextContent(
      "FO-2511-0423",
    );
    expect(screen.getByTestId("customer-linked-products")).toHaveTextContent(
      "TRR-BX5",
    );
    expect(
      within(screen.getByTestId("customer-linked-products")).getByRole("link"),
    ).toHaveAttribute(
      "href",
      "/finished-goods/products/prod-1?warehouseId=wh-1",
    );
    chooseWorkspaceSection("Details");
    expect(screen.getByTestId("customer-aliases-list")).toHaveTextContent(
      "บจก.ไทยรุ่งเรือง",
    );

    const aliasInput = screen.getByRole("textbox", {
      name: "Add a name seen on job tickets",
    });
    fireEvent.change(aliasInput, { target: { value: "บจก.ไทยรุ่งเรือง" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add name" }));
    });
    expect(mutationFor(ADD_ALIAS)).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "customer-a",
        alias: "บจก.ไทยรุ่งเรือง",
      }),
    );
    expect(
      await screen.findByText("This name is already saved for this customer."),
    ).toBeVisible();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Remove บจก.ไทยรุ่งเรือง" }),
      );
    });
    expect(mutationFor(REMOVE_ALIAS)).toHaveBeenCalledWith(
      expect.objectContaining({ aliasId: "alias-1" }),
    );
  });

  it("loads linked jobs inline across customer-scoped continuation pages", () => {
    enableWarehouseWorkspace();
    directSection("jobs");
    mocks.queries.set(GET, { ok: true, value: full });
    mocks.queries.set(WORKSPACE_JOBS, workspacePage([], "next-warehouse"));
    render(<CustomerDetail customerId="customer-a" />);
    expect(mocks.queryArgs.get(WORKSPACE_JOBS)).toEqual({
      customerId: "customer-a",
      filter: "all",
    });
    mocks.queries.set(
      WORKSPACE_JOBS,
      workspacePage([{ ...job, factoryOrder: "OLDER-LINKED-JOB" }]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(mocks.queryArgs.get(WORKSPACE_JOBS)).toEqual({
      customerId: "customer-a",
      filter: "all",
      cursor: "next-warehouse",
    });
    expect(screen.getByTestId("customer-recent-jobs")).toHaveTextContent(
      "OLDER-LINKED-JOB",
    );
    mocks.queries.set(WORKSPACE_JOBS, workspacePage([job]));
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(mocks.queryArgs.get(WORKSPACE_JOBS)).toEqual({
      customerId: "customer-a",
      filter: "all",
    });
    expect(screen.getByTestId("customer-recent-jobs")).toHaveTextContent(
      job.factoryOrder,
    );
  });

  it("revisits live product pages after a deletion and clears rows on authorization denial", () => {
    enableWarehouseWorkspace();
    directSection("products");
    mocks.queries.set(GET, { ok: true, value: full });
    mocks.queries.set(WORKSPACE_PRODUCTS, workspacePage([product], "cursor-1"));
    render(<CustomerDetail customerId="customer-a" />);
    expect(screen.getByTestId("customer-linked-products")).toHaveTextContent(
      product.sku,
    );
    mocks.queries.set(
      WORKSPACE_PRODUCTS,
      workspacePage([{ ...product, sku: "SKU-2" }]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(mocks.queryArgs.get(WORKSPACE_PRODUCTS)).toEqual({
      customerId: "customer-a",
      cursor: "cursor-1",
    });
    expect(screen.getByTestId("customer-linked-products")).toHaveTextContent(
      "SKU-2",
    );
    mocks.queries.set(WORKSPACE_PRODUCTS, workspacePage([], "cursor-new"));
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(mocks.queryArgs.get(WORKSPACE_PRODUCTS)).toEqual({
      customerId: "customer-a",
    });
    expect(screen.getByText("No linked products in this scope.")).toBeVisible();
    mocks.queries.set(WORKSPACE_PRODUCTS, {
      ok: false,
      denial: { code: "AUTHORIZATION_DENIED", requestId: "revoked-products" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText(/revoked-products/)).toBeVisible();
    expect(screen.queryByTestId("customer-linked-products")).toBeNull();
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
  });

  it("paginates customer detail aliases, shows alias transport errors, and guards dirty alias drafts", async () => {
    const detailsUrl = DETAIL_URL.replace("?tab=1", "?tab=1&section=details");
    openFrom(LIST_ORIGIN, detailsUrl);
    enableWarehouseWorkspace();
    mocks.queries.set(GET, { ok: true, value: full });
    mocks.queries.set(
      WORKSPACE_ALIASES,
      workspacePage(
        [{ aliasId: "alias-1", alias: "Alias One", approvedAt: 1 }],
        "next-alias",
      ),
    );
    mutationFor(ADD_ALIAS).mockRejectedValueOnce(new Error("offline"));
    render(<CustomerDetail customerId="customer-a" />);
    mocks.queries.set(
      WORKSPACE_ALIASES,
      workspacePage([
        { aliasId: "alias-2", alias: "Alias Two", approvedAt: 2 },
      ]),
    );
    fireEvent.click(screen.getByTestId("customer-aliases-next"));
    expect(mocks.queryArgs.get(WORKSPACE_ALIASES)).toEqual({
      customerId: "customer-a",
      cursor: "next-alias",
    });
    expect(screen.getByTestId("customer-aliases-list")).toHaveTextContent(
      "Alias Two",
    );

    const aliasInput = screen.getByRole("textbox", {
      name: "Add a name seen on job tickets",
    });
    fireEvent.change(aliasInput, { target: { value: "Unsaved Alias" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add name" }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Check your connection/,
    );
    expect(aliasInput).toHaveValue("Unsaved Alias");
    await nativeBack();
    expect(
      await screen.findByRole("dialog", { name: "Discard changes?" }),
    ).toBeVisible();
    expect(href()).toBe(detailsUrl);
  });

  it("links and skips unresolved names on the review queue with remember-alias off by default", async () => {
    openFrom(LIST_URL, REVIEW_URL);
    mocks.queries.set(UNRESOLVED, {
      ok: true,
      value: {
        canViewWarehouseData: true,
        canReview: true,
        hasMore: false,
        groups: [
          {
            normalizedName: "บจก.ไทยรุ่งเรือง",
            displayName: "บจก.ไทยรุ่งเรือง",
            scanCount: 2,
            latestAt: 1_763_380_800_000,
            warehouses: [{ warehouseId: "wh-1", name: "บางพลี" }],
            scans: [
              {
                jobScanId: "scan-1",
                warehouseId: "wh-1",
                warehouseName: "บางพลี",
                factoryOrder: "FO-101",
                capturedName: "บจก.ไทยรุ่งเรือง",
                createdAt: 1_763_380_800_000,
                version: 1,
              },
              {
                jobScanId: "scan-2",
                warehouseId: "wh-1",
                warehouseName: "บางพลี",
                factoryOrder: "FO-102",
                capturedName: "บจก.ไทยรุ่งเรือง",
                createdAt: 1_763_370_000_000,
                version: 2,
              },
            ],
            matchKind: "SIMILAR",
            candidates: [
              {
                customerId: "customer-a",
                code: "C-0007",
                name: "บริษัท ไทยรุ่งเรืองบรรจุภัณฑ์ จำกัด",
                province: "ชลบุรี",
                status: "ACTIVE",
              },
            ],
          },
        ],
      },
    });
    mutationFor(RESOLVE).mockResolvedValue({
      ok: true,
      value: { ok: false, code: "STALE_REVISION" },
    });

    render(<CustomerReviewQueue />);
    const rememberBox = screen.getByRole("checkbox", {
      name: "Remember this name for future job tickets",
    });
    expect(rememberBox).not.toBeChecked();

    await act(async () => {
      fireEvent.click(screen.getByTestId("review-link-button"));
    });
    expect(mutationFor(RESOLVE)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LINK",
        customerId: "customer-a",
        rememberAlias: false,
        scans: [
          { jobScanId: "scan-1", expectedVersion: 1 },
          { jobScanId: "scan-2", expectedVersion: 2 },
        ],
      }),
    );
    expect(
      await screen.findByText(/One of these tickets changed/),
    ).toBeVisible();

    fireEvent.click(rememberBox);
    expect(rememberBox).toBeChecked();
    await act(async () => {
      fireEvent.click(screen.getByTestId("review-skip-button"));
    });
    expect(mutationFor(RESOLVE)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "SKIP",
        scans: [
          { jobScanId: "scan-1", expectedVersion: 1 },
          { jobScanId: "scan-2", expectedVersion: 2 },
        ],
      }),
    );
  });

  it("opens the review customer picker in a shared Dialog dismissed by native Back and selects a custom customer", async () => {
    openFrom(LIST_URL, REVIEW_URL);
    mocks.queries.set(UNRESOLVED, {
      ok: true,
      value: {
        canViewWarehouseData: true,
        canReview: true,
        hasMore: false,
        groups: [
          {
            normalizedName: "สยามเมทัลชีท",
            displayName: "สยามเมทัลชีท",
            scanCount: 1,
            latestAt: 1_763_380_800_000,
            warehouses: [{ warehouseId: "wh-1", name: "อมตะ" }],
            scans: [
              {
                jobScanId: "scan-9",
                warehouseId: "wh-1",
                warehouseName: "อมตะ",
                factoryOrder: "FO-900",
                capturedName: "สยามเมทัลชีท",
                createdAt: 1_763_380_800_000,
                version: 1,
              },
            ],
            matchKind: "NONE",
            candidates: [],
          },
        ],
      },
    });
    mocks.queries.set(OPTIONS, {
      ok: true,
      value: {
        items: [
          {
            customerId: "customer-b",
            code: "C-0012",
            name: "บริษัท อีสเทิร์นออโต้พาร์ท จำกัด",
            province: "ระยอง",
            status: "ACTIVE",
          },
        ],
        hasMore: true,
        scanCursor: "cursor-page-2",
      },
    });

    render(<CustomerReviewQueue />);
    expect(
      screen.getByRole("button", { name: "Create new customer" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Create new customer" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Choose customer" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Choose a customer",
    });
    expect(dialog).toBeVisible();

    // Native Back closes the picker dialog before leaving the review queue.
    await nativeBack();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Choose a customer" }),
      ).toBeNull(),
    );
    expect(href()).toBe(REVIEW_URL);

    // Reopen, search, page forward and back, and pick a customer.
    fireEvent.click(screen.getByRole("button", { name: "Choose customer" }));
    const reopened = await screen.findByRole("dialog", {
      name: "Choose a customer",
    });
    fireEvent.change(
      within(reopened).getByRole("textbox", {
        name: "Search customer name or code",
      }),
      { target: { value: "C-0012" } },
    );
    expect(mocks.queryArgs.get(OPTIONS)).toEqual({ search: "C-0012" });
    fireEvent.click(
      within(reopened).getByRole("button", { name: "Next page" }),
    );
    expect(mocks.queryArgs.get(OPTIONS)).toEqual({
      search: "C-0012",
      scanCursor: "cursor-page-2",
    });
    fireEvent.click(
      within(reopened).getByRole("button", { name: "Previous page" }),
    );
    expect(mocks.queryArgs.get(OPTIONS)).toEqual({ search: "C-0012" });
    fireEvent.click(
      within(reopened).getByRole("button", {
        name: /บริษัท อีสเทิร์นออโต้พาร์ท จำกัด/,
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Choose a customer" }),
      ).toBeNull(),
    );
    expect(screen.getByTestId("review-link-button")).toHaveTextContent(
      "Link 1 ticket",
    );
  });

  it("overrides a preselected review candidate with another customer chosen from CustomerPickerDialog and submits the new customer", async () => {
    openFrom(LIST_URL, REVIEW_URL);
    mocks.queries.set(UNRESOLVED, {
      ok: true,
      value: {
        canViewWarehouseData: true,
        canReview: true,
        hasMore: false,
        groups: [
          {
            normalizedName: "siam box",
            displayName: "Siam Box",
            scanCount: 1,
            latestAt: 1_763_380_800_000,
            warehouses: [{ warehouseId: "wh-1", name: "Bang Phli" }],
            scans: [
              {
                jobScanId: "scan-5",
                warehouseId: "wh-1",
                warehouseName: "Bang Phli",
                factoryOrder: "FO-500",
                capturedName: "Siam Box",
                createdAt: 1_763_380_800_000,
                version: 1,
              },
            ],
            matchKind: "SIMILAR",
            candidates: [
              {
                customerId: "customer-a",
                code: "C-0001",
                name: "Siam Box A",
                status: "ACTIVE",
              },
            ],
          },
        ],
      },
    });
    mocks.queries.set(OPTIONS, {
      ok: true,
      value: {
        items: [
          {
            customerId: "customer-b",
            code: "C-0002",
            name: "Siam Box B",
            status: "ACTIVE",
          },
        ],
        hasMore: false,
      },
    });
    mutationFor(RESOLVE).mockResolvedValue({
      ok: true,
      value: { ok: true, updatedCount: 1, replayed: false },
    });

    render(<CustomerReviewQueue />);
    expect(screen.getByRole("radio", { name: /Siam Box A/ })).toBeChecked();

    fireEvent.click(
      screen.getByRole("button", { name: "Choose another customer" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Choose a customer",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /Siam Box B/ }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Choose a customer" }),
      ).toBeNull(),
    );
    expect(screen.getByRole("radio", { name: /Siam Box B/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Siam Box A/ })).not.toBeChecked();

    await act(async () => {
      fireEvent.click(screen.getByTestId("review-link-button"));
    });
    expect(mutationFor(RESOLVE)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LINK",
        customerId: "customer-b",
      }),
    );
  });

  it("paginates review queue batches with scanCursor and keeps the queue open while hasMore is true", () => {
    openFrom(LIST_URL, REVIEW_URL);
    mocks.queries.set(UNRESOLVED, {
      ok: true,
      value: {
        canViewWarehouseData: true,
        canReview: true,
        hasMore: true,
        scanCursor: '{"w":1}',
        groups: [],
      },
    });

    render(<CustomerReviewQueue />);
    expect(screen.queryByText("No names awaiting review")).toBeNull();
    expect(screen.getByTestId("review-empty-batch")).toBeVisible();
    fireEvent.click(screen.getByTestId("review-load-more"));
    expect(mocks.queryArgs.get(UNRESOLVED)).toEqual({ scanCursor: '{"w":1}' });
    fireEvent.click(
      screen.getByRole("button", { name: "Back to first batch" }),
    );
    expect(mocks.queryArgs.get(UNRESOLVED)).toEqual({});
  });

  it("empty review queue Back to list restores the filtered customer list origin and consumes the task entry", async () => {
    openFrom(LIST_ORIGIN, REVIEW_URL);
    mocks.queries.set(UNRESOLVED, {
      ok: true,
      value: {
        canViewWarehouseData: true,
        canReview: true,
        hasMore: false,
        groups: [],
      },
    });
    render(<CustomerReviewQueue />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Back to customers" }),
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
    });
    await waitFor(() => expect(href()).toBe(LIST_ORIGIN));
    expect(mocks.replace).not.toHaveBeenCalled();

    // Direct entry falls back to /master-data/customers via replace.
    cleanup();
    window.history.replaceState(null, "", REVIEW_URL);
    render(<CustomerReviewQueue />);
    fireEvent.click(screen.getByRole("button", { name: "Back to customers" }));
    expect(mocks.replace).toHaveBeenCalledWith("/master-data/customers");
  });

  it("review queue Back policy covers explicit picker close followed by next Back, pending write protection, and Forward", async () => {
    openFrom(LIST_ORIGIN, REVIEW_URL);
    mocks.queries.set(UNRESOLVED, {
      ok: true,
      value: {
        canViewWarehouseData: true,
        canReview: true,
        hasMore: false,
        groups: [
          {
            normalizedName: "pending co",
            displayName: "Pending Co",
            scanCount: 1,
            latestAt: 1_763_380_800_000,
            warehouses: [{ warehouseId: "wh-1", name: "Bang Phli" }],
            scans: [
              {
                jobScanId: "scan-p",
                warehouseId: "wh-1",
                warehouseName: "Bang Phli",
                factoryOrder: "FO-700",
                capturedName: "Pending Co",
                createdAt: 1_763_380_800_000,
                version: 1,
              },
            ],
            matchKind: "SIMILAR",
            candidates: [
              {
                customerId: "customer-a",
                code: "C-0001",
                name: "Pending Co Ltd",
                status: "ACTIVE",
              },
            ],
          },
        ],
      },
    });
    mocks.queries.set(OPTIONS, {
      ok: true,
      value: { items: [], hasMore: false },
    });
    let resolveWrite!: (value: unknown) => void;
    mutationFor(RESOLVE).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveWrite = resolve;
      }),
    );

    render(<CustomerReviewQueue />);
    // Explicit Cancel button closes dialog; next native Back returns to filtered list origin.
    fireEvent.click(
      screen.getByRole("button", { name: "Choose another customer" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Choose a customer",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Choose a customer" }),
      ).toBeNull(),
    );
    await nativeBack();
    await waitFor(() => expect(href()).toBe(LIST_ORIGIN));
    // Forward returns to the review queue.
    await act(async () => {
      window.history.forward();
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
    });
    await waitFor(() => expect(href()).toBe(REVIEW_URL));

    // Pending write keeps the review queue open on native Back.
    fireEvent.click(screen.getByTestId("review-link-button"));
    await nativeBack();
    expect(href()).toBe(REVIEW_URL);
    await act(async () => {
      resolveWrite({
        ok: true,
        value: { ok: true, updatedCount: 1, replayed: false },
      });
    });
  });

  it("searchable CustomerPicker filters options and loads more customers past the first page", () => {
    mocks.queries.set(OPTIONS, {
      ok: true,
      value: {
        items: [
          {
            customerId: "customer-a",
            code: "C-0001",
            name: "Acme Packaging",
            status: "ACTIVE",
          },
        ],
        hasMore: true,
        scanCursor: "picker-cursor-2",
      },
    });
    const onChange = vi.fn();
    render(
      <CustomerPicker
        label="Customer"
        value=""
        onChange={onChange}
        unlinkedLabel="Not linked"
        searchPlaceholder="Search customer name or code"
        loadMoreLabel="Load more customers"
        testId="standalone-customer-picker"
      />,
    );
    fireEvent.change(screen.getByTestId("standalone-customer-picker-search"), {
      target: { value: "C-0105" },
    });
    expect(mocks.queryArgs.get(OPTIONS)).toEqual({ search: "C-0105" });
    fireEvent.click(
      screen.getByRole("button", { name: "Load more customers" }),
    );
    expect(mocks.queryArgs.get(OPTIONS)).toEqual({
      search: "C-0105",
      scanCursor: "picker-cursor-2",
    });
  });

  it("creates a new customer from review using an opaque session prefill token without putting the raw name in the URL", async () => {
    const rawName = "บริษัท สยามเมทัลชีท จำกัด (สาขา 2)";
    openFrom(LIST_URL, REVIEW_URL);
    mocks.queries.set(UNRESOLVED, {
      ok: true,
      value: {
        canViewWarehouseData: true,
        canReview: true,
        hasMore: false,
        groups: [
          {
            normalizedName: rawName,
            displayName: rawName,
            scanCount: 1,
            latestAt: 1_763_380_800_000,
            warehouses: [{ warehouseId: "wh-1", name: "อมตะ" }],
            scans: [
              {
                jobScanId: "scan-prefill",
                warehouseId: "wh-1",
                warehouseName: "อมตะ",
                factoryOrder: "FO-901",
                capturedName: rawName,
                createdAt: 1_763_380_800_000,
                version: 1,
              },
            ],
            matchKind: "NONE",
            candidates: [],
          },
        ],
      },
    });

    const queue = render(<CustomerReviewQueue />);
    expect(
      screen.queryByRole("link", { name: "Create new customer" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Create new customer" }),
    );
    expect(mocks.push).toHaveBeenCalledTimes(1);
    const pushedUrl = mocks.push.mock.calls[0]![0] as string;
    const match =
      /^\/master-data\/customers\/new\?prefill=([A-Za-z0-9_-]{8,64})$/.exec(
        pushedUrl,
      );
    expect(match).not.toBeNull();
    expect(pushedUrl).not.toContain(rawName);
    expect(pushedUrl).not.toContain(encodeURIComponent(rawName));
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(rawName);

    const token = match![1]!;
    const prefillKey = 'customer-review-prefill:["org-a","user-a"]:';
    expect(window.sessionStorage.getItem(`${prefillKey}${token}`)).toContain(
      rawName,
    );
    queue.unmount();

    const create = mutationFor(CREATE);
    const form = render(<NewCustomerForm prefillToken={token} />);
    expect(screen.getByRole("textbox", { name: /Customer name/ })).toHaveValue(
      rawName,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save customer" }));
    });
    expect(create).toHaveBeenCalledExactlyOnceWith({
      requestId: expect.any(String),
      name: rawName,
    });
    expect(window.sessionStorage.getItem(`${prefillKey}${token}`)).toBeNull();
    form.unmount();

    // Cancel also clears the session prefill token; an invalid token leaves the name empty.
    window.sessionStorage.setItem(
      `${prefillKey}cancel-token-1234`,
      JSON.stringify({ name: rawName }),
    );
    openFrom(
      REVIEW_URL,
      "/en/master-data/customers/new?prefill=cancel-token-1234",
    );
    const cancelView = render(
      <NewCustomerForm prefillToken="cancel-token-1234" />,
    );
    expect(screen.getByRole("textbox", { name: /Customer name/ })).toHaveValue(
      rawName,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      window.sessionStorage.getItem(`${prefillKey}cancel-token-1234`),
    ).toBeNull();
    await waitFor(() => expect(href()).toBe(REVIEW_URL));
    cancelView.unmount();

    render(<NewCustomerForm prefillToken="bad!" />);
    expect(screen.getByRole("textbox", { name: /Customer name/ })).toHaveValue(
      "",
    );
  });

  it("freezes review link payload and requestId across live subscription updates until retry succeeds", async () => {
    openFrom(LIST_URL, REVIEW_URL);
    const initialGroup = {
      normalizedName: "บจก.ไทยรุ่งเรือง",
      displayName: "บจก.ไทยรุ่งเรือง",
      scanCount: 2,
      latestAt: 1_763_380_800_000,
      warehouses: [{ warehouseId: "wh-1", name: "บางพลี" }],
      scans: [
        {
          jobScanId: "scan-1",
          warehouseId: "wh-1",
          warehouseName: "บางพลี",
          factoryOrder: "FO-101",
          capturedName: "บจก.ไทยรุ่งเรือง",
          createdAt: 1_763_380_800_000,
          version: 1,
        },
        {
          jobScanId: "scan-2",
          warehouseId: "wh-1",
          warehouseName: "บางพลี",
          factoryOrder: "FO-102",
          capturedName: "บจก.ไทยรุ่งเรือง",
          createdAt: 1_763_370_000_000,
          version: 2,
        },
      ],
      matchKind: "SIMILAR" as const,
      candidates: [
        {
          customerId: "customer-a",
          code: "C-0007",
          name: "บริษัท ไทยรุ่งเรืองบรรจุภัณฑ์ จำกัด",
          province: "ชลบุรี",
          status: "ACTIVE" as const,
        },
      ],
    };
    mocks.queries.set(UNRESOLVED, {
      ok: true,
      value: {
        canViewWarehouseData: true,
        canReview: true,
        hasMore: false,
        groups: [initialGroup],
      },
    });
    const resolve = mutationFor(RESOLVE);
    resolve
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce({
        ok: true,
        value: { ok: true, updatedCount: 2, replayed: false },
      });

    const view = render(<CustomerReviewQueue />);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Remember this name for future job tickets",
      }),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("review-link-button"));
    });
    expect(resolve).toHaveBeenCalledTimes(1);
    const firstPayload = resolve.mock.calls[0]![0];
    expect(firstPayload).toEqual({
      requestId: expect.any(String),
      action: "LINK",
      customerId: "customer-a",
      rememberAlias: true,
      aliasText: "บจก.ไทยรุ่งเรือง",
      scans: [
        { jobScanId: "scan-1", expectedVersion: 1 },
        { jobScanId: "scan-2", expectedVersion: 2 },
      ],
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't confirm whether this decision was saved. Retry to send the exact same request safely.",
    );
    expect(screen.getByTestId("review-link-button")).toHaveTextContent(
      "Retry link",
    );
    expect(screen.getByTestId("review-skip-button")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Create new customer" }),
    ).toBeDisabled();

    // Live subscription updates scans, versions, and removes candidates before retry.
    mocks.queries.set(UNRESOLVED, {
      ok: true,
      value: {
        canViewWarehouseData: true,
        canReview: true,
        hasMore: false,
        groups: [
          {
            ...initialGroup,
            scanCount: 2,
            scans: [
              {
                ...initialGroup.scans[0]!,
                version: 5,
              },
              {
                jobScanId: "scan-3",
                warehouseId: "wh-1",
                warehouseName: "บางพลี",
                factoryOrder: "FO-103",
                capturedName: "บจก.ไทยรุ่งเรือง",
                createdAt: 1_763_390_000_000,
                version: 1,
              },
            ],
            matchKind: "NONE",
            candidates: [],
          },
        ],
      },
    });
    view.rerender(
      <DraftGuardProvider>
        <CustomerReviewQueue />
      </DraftGuardProvider>,
    );
    expect(screen.getByTestId("review-link-button")).toHaveTextContent(
      "Retry link",
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("review-link-button"));
    });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve.mock.calls[1]![0]).toEqual(firstPayload);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("review-skip-button")).toBeEnabled();

    // Definite refusal clears retry state and surfaces the specific refusal reason.
    resolve.mockResolvedValueOnce({
      ok: true,
      value: { ok: false, code: "CUSTOMER_ARCHIVED" },
    });
    mocks.queries.set(UNRESOLVED, {
      ok: true,
      value: {
        canViewWarehouseData: true,
        canReview: true,
        hasMore: false,
        groups: [initialGroup],
      },
    });
    view.rerender(
      <DraftGuardProvider>
        <CustomerReviewQueue />
      </DraftGuardProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("review-link-button"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This customer is archived. Choose an active customer or restore it first.",
    );
    expect(screen.getByTestId("review-skip-button")).toBeEnabled();
  });

  it("pages CustomerPicker and CustomerPickerDialog forward and backward across empty intermediate pages and resets on search", async () => {
    mocks.queries.set(OPTIONS, {
      ok: true,
      value: {
        items: [
          {
            customerId: "customer-1",
            code: "C-0001",
            name: "Page One Co",
            status: "ACTIVE",
          },
        ],
        hasMore: true,
        scanCursor: "cursor-2",
      },
    });
    const standalone = render(
      <CustomerPicker
        label="Customer"
        value=""
        onChange={vi.fn()}
        unlinkedLabel="Not linked"
        searchPlaceholder="Search customer name or code"
        testId="paged-picker"
      />,
    );
    expect(screen.queryByTestId("paged-picker-previous")).toBeNull();
    expect(screen.getByTestId("paged-picker-next")).toHaveTextContent(
      "Next page",
    );

    // Page 2 is an empty intermediate slice with another page after it.
    mocks.queries.set(OPTIONS, {
      ok: true,
      value: {
        items: [],
        hasMore: true,
        scanCursor: "cursor-3",
      },
    });
    fireEvent.click(screen.getByTestId("paged-picker-next"));
    expect(mocks.queryArgs.get(OPTIONS)).toEqual({ scanCursor: "cursor-2" });
    expect(screen.getByTestId("paged-picker-empty-page")).toHaveTextContent(
      "No matching active customers on this page.",
    );
    expect(screen.getByTestId("paged-picker-previous")).toBeVisible();
    expect(screen.getByTestId("paged-picker-next")).toBeVisible();

    // Advance to page 3, then step back to page 2 and page 1.
    mocks.queries.set(OPTIONS, {
      ok: true,
      value: {
        items: [
          {
            customerId: "customer-3",
            code: "C-0003",
            name: "Page Three Co",
            status: "ACTIVE",
          },
        ],
        hasMore: false,
      },
    });
    fireEvent.click(screen.getByTestId("paged-picker-next"));
    expect(mocks.queryArgs.get(OPTIONS)).toEqual({ scanCursor: "cursor-3" });
    expect(screen.queryByTestId("paged-picker-next")).toBeNull();
    fireEvent.click(screen.getByTestId("paged-picker-previous"));
    expect(mocks.queryArgs.get(OPTIONS)).toEqual({ scanCursor: "cursor-2" });
    fireEvent.change(screen.getByTestId("paged-picker-search"), {
      target: { value: "Page" },
    });
    expect(mocks.queryArgs.get(OPTIONS)).toEqual({ search: "Page" });
    expect(screen.queryByTestId("paged-picker-previous")).toBeNull();
    standalone.unmount();

    // CustomerPickerDialog handles empty intermediate pages, backward paging, and denied reads.
    openFrom(LIST_URL, REVIEW_URL);
    mocks.queries.set(UNRESOLVED, {
      ok: true,
      value: {
        canViewWarehouseData: true,
        canReview: true,
        hasMore: false,
        groups: [
          {
            normalizedName: "dialog paging",
            displayName: "Dialog Paging",
            scanCount: 1,
            latestAt: 1_763_380_800_000,
            warehouses: [{ warehouseId: "wh-1", name: "Bang Phli" }],
            scans: [
              {
                jobScanId: "scan-dp",
                warehouseId: "wh-1",
                warehouseName: "Bang Phli",
                factoryOrder: "FO-801",
                capturedName: "Dialog Paging",
                createdAt: 1_763_380_800_000,
                version: 1,
              },
            ],
            matchKind: "NONE",
            candidates: [],
          },
        ],
      },
    });
    mocks.queries.set(OPTIONS, {
      ok: true,
      value: {
        items: [
          {
            customerId: "customer-1",
            code: "C-0001",
            name: "Page One Co",
            status: "ACTIVE",
          },
        ],
        hasMore: true,
        scanCursor: "dlg-cursor-2",
      },
    });
    const queueView = render(<CustomerReviewQueue />);
    fireEvent.click(screen.getByRole("button", { name: "Choose customer" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Choose a customer",
    });

    mocks.queries.set(OPTIONS, {
      ok: true,
      value: {
        items: [],
        hasMore: true,
        scanCursor: "dlg-cursor-3",
      },
    });
    fireEvent.click(within(dialog).getByTestId("review-picker-next"));
    expect(mocks.queryArgs.get(OPTIONS)).toEqual({
      search: "",
      scanCursor: "dlg-cursor-2",
    });
    expect(
      within(dialog).getByTestId("review-picker-empty-page"),
    ).toHaveTextContent("No matching active customers on this page.");
    expect(within(dialog).getByTestId("review-picker-previous")).toBeVisible();
    expect(within(dialog).getByTestId("review-picker-next")).toBeVisible();

    mocks.queries.set(OPTIONS, {
      ok: false,
      denial: { code: "AUTHORIZATION_DENIED", requestId: "req-picker-denied" },
    });
    fireEvent.click(within(dialog).getByTestId("review-picker-previous"));
    expect(within(dialog).getByText(/req-picker-denied/)).toBeInTheDocument();
    queueView.unmount();
  });

  it("pages customer aliases forward and backward, handles empty and denied pages, and steps review batches backward", async () => {
    enableWarehouseWorkspace();
    directSection("details");
    mocks.queries.set(GET, { ok: true, value: full });
    mocks.queries.set(
      WORKSPACE_ALIASES,
      workspacePage(
        [{ aliasId: "alias-1", alias: "Alias One", approvedAt: 1 }],
        "alias-cursor-2",
      ),
    );
    mutationFor(ADD_ALIAS).mockResolvedValueOnce({
      ok: true,
      value: { ok: false, code: "ALIAS_CAPACITY" },
    });

    const detail = render(<CustomerDetail customerId="customer-a" />);
    // Aliases forward to empty intermediate page, then back, then capacity error.
    expect(screen.getByTestId("customer-aliases-next")).toBeVisible();
    mocks.queries.set(WORKSPACE_ALIASES, {
      ok: true,
      value: {
        items: [],
        isDone: false,
        continueCursor: "alias-cursor-3",
      },
    });
    fireEvent.click(screen.getByTestId("customer-aliases-next"));
    expect(mocks.queryArgs.get(WORKSPACE_ALIASES)).toEqual({
      customerId: "customer-a",
      cursor: "alias-cursor-2",
    });
    expect(screen.getByTestId("customer-aliases-empty-page")).toHaveTextContent(
      "No saved job-ticket names on this page.",
    );
    mocks.queries.set(WORKSPACE_ALIASES, {
      ok: false,
      denial: { code: "AUTHORIZATION_DENIED", requestId: "req-alias-page" },
    });
    fireEvent.click(screen.getByTestId("customer-aliases-previous"));
    expect(mocks.queryArgs.get(WORKSPACE_ALIASES)).toEqual({
      customerId: "customer-a",
    });
    expect(screen.getByText(/req-alias-page/)).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Add a name seen on job tickets" }),
      { target: { value: "Overflow Alias" } },
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add name" }));
    });
    expect(
      await screen.findByText(/This customer has reached the saved-name limit/),
    ).toBeVisible();
    detail.unmount();

    // Review queue steps backward one batch via Previous page and shows hasMore-only banner on list.
    openFrom(LIST_URL, REVIEW_URL);
    mocks.queries.set(UNRESOLVED, {
      ok: true,
      value: {
        canViewWarehouseData: true,
        canReview: true,
        hasMore: true,
        scanCursor: '{"w":1}',
        groups: [],
      },
    });
    const queue = render(<CustomerReviewQueue />);
    mocks.queries.set(UNRESOLVED, {
      ok: true,
      value: {
        canViewWarehouseData: true,
        canReview: true,
        hasMore: true,
        scanCursor: '{"w":2}',
        groups: [],
      },
    });
    fireEvent.click(screen.getByTestId("review-load-more"));
    expect(mocks.queryArgs.get(UNRESOLVED)).toEqual({ scanCursor: '{"w":1}' });
    fireEvent.click(screen.getByTestId("review-load-more"));
    expect(mocks.queryArgs.get(UNRESOLVED)).toEqual({ scanCursor: '{"w":2}' });
    fireEvent.click(screen.getByTestId("review-previous-batch"));
    expect(mocks.queryArgs.get(UNRESOLVED)).toEqual({ scanCursor: '{"w":1}' });
    queue.unmount();

    mocks.queries.set(REVIEW_SUMMARY, {
      ok: true,
      value: {
        canViewWarehouseData: true,
        canReview: true,
        unresolvedNameCount: 0,
        unresolvedScanCount: 0,
        hasMore: true,
      },
    });
    mocks.queries.set(LIST, page([]));
    render(<CustomerCatalogue />);
    expect(screen.getByTestId("customer-review-banner")).toHaveTextContent(
      "Names to review",
    );
  });
});

describe("customer workspace navigation", () => {
  const WORKSPACE_URL = "/en/master-data/customers/customer-a";
  const withWorkspace = (
    current = WORKSPACE_URL,
    override?: Record<string, unknown>,
  ) => {
    openFrom(LIST_ORIGIN, current);
    configureWorkspaceTestRouter();
    enableWarehouseWorkspace();
    if (override) mocks.queries.set(SHELL, shell(override));
    mocks.queries.set(GET, { ok: true, value: full });
    mocks.queries.set(WORKSPACE_JOBS, workspacePage([job]));
    return render(<CustomerDetail customerId="customer-a" />);
  };
  const sectionTab = (name: string) =>
    within(
      screen.getByRole("navigation", { name: "Customer workspace sections" }),
    ).getByRole("button", { name });
  async function pick(control: HTMLElement, name: string) {
    fireEvent.click(control);
    fireEvent.click(await screen.findByRole("option", { name }));
  }
  const warehouse = () => screen.getByRole("combobox", { name: "Warehouse" });
  const filter = () =>
    screen.getByRole("combobox", { name: "Location status" });

  it("pushes a workspace section, then native Back and Forward restore the section before leaving for the localized origin", async () => {
    withWorkspace(DETAIL_URL);
    fireEvent.click(sectionTab("Job tickets"));
    expect(href()).toBe(`${WORKSPACE_URL}?tab=1&section=jobs#top`);
    expect(sectionTab("Job tickets")).toHaveAttribute("aria-current", "page");
    await nativeBack();
    await waitFor(() => expect(href()).toBe(DETAIL_URL));
    expect(sectionTab("Overview")).toHaveAttribute("aria-current", "page");
    await act(async () => {
      window.history.forward();
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
    });
    expect(sectionTab("Job tickets")).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(href()).toBe(DETAIL_URL));
    await nativeBack();
    await waitFor(() => expect(href()).toBe(LIST_ORIGIN));
  });

  it("waits for the section URL commit before opening its scope, filters or destinations", () => {
    withWorkspace();
    mocks.push.mockImplementation(() => {});
    fireEvent.click(sectionTab("Job tickets"));
    expect(href()).toBe(WORKSPACE_URL);
    expect(sectionTab("Overview")).toHaveAttribute("aria-current", "page");
    expect(sectionTab("Job tickets")).not.toHaveAttribute("aria-current");
    expect(
      screen.queryByRole("combobox", { name: "Location status" }),
    ).toBeNull();
    expect(warehouse().closest("[inert]")).not.toBeNull();

    act(() => {
      window.history.pushState({}, "", `${WORKSPACE_URL}?section=jobs`);
      window.dispatchEvent(new Event("test-url-navigation"));
    });
    expect(sectionTab("Job tickets")).toHaveAttribute("aria-current", "page");
    expect(filter()).toBeVisible();
    expect(warehouse().closest("[inert]")).toBeNull();
  });

  it("replaces workspace scope without a Back step and pushes the jobs filter with a fresh cursor", async () => {
    withWorkspace();
    await pick(warehouse(), "BP · Bang Phli");
    expect(href()).toBe(`${WORKSPACE_URL}?warehouse=wh-1`);
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    mocks.queries.set(WORKSPACE_JOBS, workspacePage([job], "jobs-next"));
    fireEvent.click(sectionTab("Job tickets"));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(mocks.queryArgs.get(WORKSPACE_JOBS)).toEqual({
      customerId: "customer-a",
      warehouseId: "wh-1",
      filter: "all",
      cursor: "jobs-next",
    });
    await pick(filter(), "Awaiting location");
    expect(mocks.queryArgs.get(WORKSPACE_JOBS)).toEqual({
      customerId: "customer-a",
      warehouseId: "wh-1",
      filter: "unmapped",
    });
    await nativeBack();
    expect(filter()).toHaveTextContent("All tickets");
    await nativeBack();
    expect(href()).toBe(`${WORKSPACE_URL}?warehouse=wh-1`);
    await nativeBack();
    expect(href()).toBe(LIST_ORIGIN);
  });

  it("opens and remounts a direct jobs deep link with its warehouse and filter", () => {
    const url = `${WORKSPACE_URL}?section=jobs&warehouse=wh-1&filter=mapped#history`;
    window.history.replaceState({ appNavigationIndex: 0 }, "", url);
    enableWarehouseWorkspace();
    mocks.queries.set(GET, { ok: true, value: full });
    mocks.queries.set(WORKSPACE_JOBS, workspacePage([job]));
    const view = render(<CustomerDetail customerId="customer-a" />);
    expect(filter()).toHaveTextContent("Location mapped");
    expect(warehouse()).toHaveTextContent("BP · Bang Phli");
    expect(mocks.queryArgs.get(WORKSPACE_JOBS)).toEqual({
      customerId: "customer-a",
      warehouseId: "wh-1",
      filter: "mapped",
    });
    view.unmount();
    render(<CustomerDetail customerId="customer-a" />);
    expect(filter()).toHaveTextContent("Location mapped");
    expect(warehouse()).toHaveTextContent("BP · Bang Phli");
    expect(href()).toBe(url);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("normalizes a catalogue-only deep link by replacement and hides the warehouse data without an error", async () => {
    openFrom(
      LIST_ORIGIN,
      `${WORKSPACE_URL}?section=jobs&tab=1&warehouse=wh-1&filter=unmapped#profile`,
    );
    configureWorkspaceTestRouter();
    mocks.permissions = [READ];
    mocks.queries.set(SHELL, shell());
    mocks.queries.set(GET, { ok: true, value: full });
    render(<CustomerDetail customerId="customer-a" />);
    await waitFor(() => expect(href()).toBe(`${WORKSPACE_URL}?tab=1#profile`));
    expect(sectionTab("Overview")).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: "Job tickets" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Warehouse" })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Needs attention" }),
    ).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.queryArgs.has(WORKSPACE_JOBS)).toBe(false);
    fireEvent.click(sectionTab("Details"));
    expect(screen.queryByText("0105553012341")).toBeNull();
    expect(mocks.queryArgs.has(WORKSPACE_ALIASES)).toBe(false);
    await nativeBack();
    await nativeBack();
    expect(href()).toBe(LIST_ORIGIN);
  });

  it("opens warehouse sections and approved aliases for a warehouse viewer without publishing manager controls", () => {
    directSection("details");
    mocks.permissions = [READ, WAREHOUSE_READ];
    mocks.queries.set(SHELL, shell());
    mocks.queries.set(GET, { ok: true, value: full });
    mocks.queries.set(
      WORKSPACE_ALIASES,
      workspacePage([
        { aliasId: "alias-1", alias: "Approved customer name", approvedAt: 1 },
      ]),
    );
    render(<CustomerDetail customerId="customer-a" />);
    expect(sectionTab("Products")).toBeVisible();
    expect(warehouse()).toBeVisible();
    expect(screen.getByText("Approved customer name")).toBeVisible();
    expect(screen.queryByText("0105553012341")).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "Add a name seen on job tickets" }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: "Scan job ticket" })).toBeNull();
  });

  it("keeps search and status local and returns from a rail customer to the prior scoped section", async () => {
    const media = vi
      .spyOn(window, "matchMedia")
      .mockImplementation((query) => ({
        matches: query === "(min-width: 64rem)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
    try {
      window.localStorage.setItem(
        "customers:org-a:user-a",
        JSON.stringify({ search: "", status: "ARCHIVED" }),
      );
      mocks.queries.set(
        LIST,
        page([
          {
            ...summary,
            customerId: "customer-b",
            name: "Other customer",
            status: "ARCHIVED",
          },
        ]),
      );
      const scoped = `${WORKSPACE_URL}?section=products&warehouse=wh-1`;
      withWorkspace(scoped);
      const rail = screen.getByRole("complementary", { name: "Customers" });
      const search = within(rail).getByRole("searchbox", {
        name: "Find a customer",
      });
      const status = within(rail).getByRole("combobox", {
        name: "Status",
      });
      expect(status).toHaveTextContent("Archived");
      await pick(status, "All");
      expect(mocks.queryArgs.get(LIST)).not.toHaveProperty("status");
      await pick(status, "Archived");
      fireEvent.change(search, { target: { value: "other" } });
      await waitFor(() =>
        expect(mocks.queryArgs.get(LIST)).toEqual(
          expect.objectContaining({ search: "other", status: "ARCHIVED" }),
        ),
      );
      expect(href()).toBe(scoped);
      expect(mocks.push).not.toHaveBeenCalled();
      expect(mocks.replace).not.toHaveBeenCalled();
      fireEvent.click(
        within(rail).getByRole("link", { name: /Other customer/ }),
      );
      expect(href()).toBe(
        "/en/master-data/customers/customer-b?warehouse=wh-1",
      );
      await nativeBack();
      expect(href()).toBe(scoped);
      expect(sectionTab("Products")).toHaveAttribute("aria-current", "page");
    } finally {
      media.mockRestore();
    }
  });

  it("opens stock from products and Back from a destination restores the exact stock view, then products", async () => {
    const scoped = `${WORKSPACE_URL}?section=products&warehouse=wh-1#product`;
    withWorkspace(scoped);
    fireEvent.click(
      screen.getByRole("button", { name: "View pallets and storage zones" }),
    );
    expect(href()).toBe(
      `${WORKSPACE_URL}?section=stock&warehouse=wh-1#product`,
    );
    expect(sectionTab("Products")).toHaveAttribute("aria-current", "page");
    const pallet = screen.getByRole("link", { name: /PLT-1/ });
    const destination = pallet.getAttribute("href");
    fireEvent.click(pallet);
    expect(href()).toBe(`/en${destination}`);
    await nativeBack();
    expect(href()).toBe(
      `${WORKSPACE_URL}?section=stock&warehouse=wh-1#product`,
    );
    expect(
      screen.getByRole("heading", { name: "Stored pallets" }),
    ).toBeVisible();
    await nativeBack();
    expect(href()).toBe(scoped);
  });

  it("waits for activity beyond the warehouse selector before presenting totals and latest jobs", () => {
    const continuation = getFunctionName(
      api.customers.workspace.continueCustomerOverview,
    );
    const view = withWorkspace(WORKSPACE_URL, { overviewCursor: "next" });
    expect(
      screen.queryByRole("heading", { name: "Latest job tickets" }),
    ).toBeNull();
    mocks.queries.set(continuation, {
      ok: true,
      value: {
        latestJobs: [
          {
            ...job,
            jobScanId: "second",
            factoryOrder: "LAST-WH",
            createdAt: job.createdAt + 1,
          },
        ],
        linkedProductCount: 4,
      },
    });
    view.rerender(
      <DraftGuardProvider>
        <CustomerDetail customerId="customer-a" />
      </DraftGuardProvider>,
    );
    expect(
      screen.getByRole("button", { name: /Linked products\s*5/ }),
    ).toBeVisible();
    expect(
      within(screen.getByTestId("customer-recent-jobs")).getAllByRole(
        "link",
      )[0],
    ).toHaveTextContent("LAST-WH");
  });

  it("shows a recovery action for an unavailable warehouse without querying its records", async () => {
    const current = `${WORKSPACE_URL}?section=jobs&warehouse=wrong`;
    const view = withWorkspace(current, { scopeAvailable: false });
    expect(screen.getByText("Warehouse unavailable")).toBeVisible();
    expect(screen.queryByTestId("customer-recent-jobs")).toBeNull();
    expect(mocks.queryArgs.has(WORKSPACE_JOBS)).toBe(false);
    mocks.queries.set(SHELL, shell());
    fireEvent.click(
      screen.getByRole("button", { name: "All permitted warehouses" }),
    );
    expect(href()).toBe(`${WORKSPACE_URL}?section=jobs`);
    expect(screen.getByTestId("customer-recent-jobs")).toBeVisible();
    expect(mocks.queryArgs.get(WORKSPACE_JOBS)).not.toHaveProperty(
      "warehouseId",
    );
    await nativeBack();
    expect(href()).toBe(LIST_ORIGIN);
    view.unmount();
  });

  it("keeps review and missing-location actions available when a partial read finds no hits", () => {
    withWorkspace(WORKSPACE_URL, {
      access: {
        canReview: true,
        canManage: true,
        canScan: true,
        canViewWarehouseData: true,
      },
      rollup: {
        ...shell().value.rollup,
        unmappedJobs: bounded(0, false),
        pendingReview: { names: 0, scans: 0, complete: false },
      },
    });
    expect(
      screen.getByRole("link", { name: /Only part of the queue was checked/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Check job tickets for missing locations",
      }),
    ).toBeVisible();
  });

  it("shows exact attention actions and selects the in-scope workspace warehouse when starting a scan", () => {
    const view = withWorkspace(`${WORKSPACE_URL}?warehouse=wh-1`);
    mocks.availableWarehouses = [{ id: "wh-1", name: "Bang Phli", code: "BP" }];
    const data = shell().value;
    mocks.queries.set(
      SHELL,
      shell({
        access: { ...data.access, canReview: true, canScan: true },
        rollup: {
          ...data.rollup,
          pendingReview: { names: 1, scans: 2, complete: false },
        },
      }),
    );
    view.rerender(
      <DraftGuardProvider>
        <CustomerDetail customerId="customer-a" />
      </DraftGuardProvider>,
    );
    expect(
      screen.getByRole("link", { name: /Review names from job tickets/ }),
    ).toHaveAttribute("href", "/master-data/customers/review");
    expect(screen.getByText("At least 1 name · 2 tickets")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: /Map storage locations/ }),
    );
    expect(filter()).toHaveTextContent("Awaiting location");
    fireEvent.click(screen.getByRole("link", { name: "Scan job ticket" }));
    expect(mocks.selectWarehouse).toHaveBeenCalledWith("wh-1");
    expect(href()).toBe("/en/finished-goods/scan?customer=customer-a");
  });

  it("copies a multiline delivery address and reports success and failure in place", async () => {
    withWorkspace();
    const clipboard = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("denied"));
    const property = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboard },
    });
    try {
      const copy = screen.getByRole("button", { name: "Copy address" });
      fireEvent.click(copy);
      expect(await screen.findByText("Address copied.")).toBeVisible();
      expect(clipboard).toHaveBeenCalledWith(
        "99/1 Moo 5\nBang Phli\nSamut Prakan 10540",
      );
      fireEvent.click(copy);
      expect(
        await screen.findByText(/Couldn’t copy automatically/),
      ).toBeVisible();
      expect(href()).toBe(WORKSPACE_URL);
    } finally {
      if (property) Object.defineProperty(navigator, "clipboard", property);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });
});
