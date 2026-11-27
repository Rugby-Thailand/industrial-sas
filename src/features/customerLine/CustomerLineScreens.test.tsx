import {
  getTestMutation,
  registerTestMutation,
} from "@tests/fixtures/convex-mutation";
import {
  configuredEnvironment,
  renderWithIntl,
} from "@tests/fixtures/intl-render";
import { chooseOption } from "@tests/fixtures/select-control";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
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
import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { CustomerLineGroup } from "./CustomerLineGroup";
import { CustomerLineInbox } from "./CustomerLineInbox";
import { CustomerLineSettings } from "./CustomerLineSettings";
import {
  customerLineRefs,
  type LineContact,
  type LineGroup,
  type LinePrimaryConnection,
  type LineQuestion,
  type LineViewer,
} from "./lineApi";

const mocks = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  queryArgs: new Map<string, unknown>(),
  queryResolvers: new Map<string, (args: Record<string, unknown>) => unknown>(),
  actions: new Map<string, Mock<(args: unknown) => Promise<unknown>>>(),
  permissions: ["masterData.customer.read"] as string[],
  authenticated: true,
  readiness: { kind: "READY_TO_QUERY" } as { kind: string },
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: getTestMutation,
  useAction: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    return (args: unknown) => {
      const handler = mocks.actions.get(name);
      if (!handler) {
        return Promise.reject(new Error(`Unexpected test action: ${name}`));
      }
      return handler(args);
    };
  },
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(ref);
    mocks.queryArgs.set(name, args);
    const resolver = mocks.queryResolvers.get(name);
    if (resolver) return resolver((args ?? {}) as Record<string, unknown>);
    return mocks.queries.get(name);
  },
}));

vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceModule>()),
  useWorkspace: () => ({
    readiness: mocks.readiness,
    authenticated: mocks.authenticated,
    failed: false,
    permissionsReady: mocks.readiness.kind === "READY_TO_QUERY",
    navigationPermissions: mocks.permissions,
    warehouses: [],
    selectWarehouse: vi.fn(),
  }),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
    back: () => window.history.back(),
  }),
}));

const FULL_VIEWER: LineViewer = {
  canRead: true,
  canManageGroups: true,
  canSend: true,
  canManageConnection: true,
};

const ACTIVE_OA: LinePrimaryConnection = {
  _id: "conn-primary",
  name: "Yongkit Customer Care",
  basicId: "@yongkit-care",
  state: "active",
  webhookPath: "/webhooks/customer-line/00000000-0000-4000-8000-000000000001",
  identityVerifiedAt: Date.UTC(2026, 10, 20, 3, 0),
  webhookVerifiedAt: Date.UTC(2026, 10, 20, 3, 5),
  testSentAt: Date.UTC(2026, 10, 20, 3, 10),
};

const ACTIVE_GROUP: LineGroup = {
  _id: "grp-dispatch",
  name: "Thairungruang · Dispatch",
  state: "active",
  customerId: "cust-7",
  customerName: "C-0007 · Thairungruang Packaging",
  version: 3,
  lastActivityAt: Date.UTC(2026, 10, 27, 3, 30),
};

const PENDING_GROUP: LineGroup = {
  _id: "grp-receiving",
  name: "Thairungruang · Receiving",
  state: "pending",
  version: 1,
  lastActivityAt: Date.UTC(2026, 10, 27, 4, 0),
};

const TWO_SENDER_QUESTIONS: readonly LineQuestion[] = [
  {
    _id: "q-1",
    text: "@Yongkit What stage is JO-2511-0423 in?",
    senderLabel: "Wipa S.",
    createdAt: Date.UTC(2026, 10, 27, 3, 24),
    state: "open",
  },
  {
    _id: "q-2",
    text: "@Yongkit Can we schedule pickup tomorrow morning?",
    senderLabel: "Nattaphon C.",
    createdAt: Date.UTC(2026, 10, 27, 3, 31),
    state: "open",
  },
];

const GROUP_CONTACTS: readonly LineContact[] = [
  { _id: "contact-1", name: "Wipa Srisuk", state: "verified" },
  { _id: "contact-2", name: "Nattaphon (LINE)", state: "observed" },
];

function setQuery(
  ref: Parameters<typeof getFunctionName>[0],
  value: unknown,
): void {
  mocks.queries.set(getFunctionName(ref), value);
}

function setAction(
  ref: Parameters<typeof getFunctionName>[0],
  handler: Mock<(args: unknown) => Promise<unknown>>,
): Mock<(args: unknown) => Promise<unknown>> {
  mocks.actions.set(getFunctionName(ref), handler);
  return handler;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderScreen(ui: React.ReactElement) {
  return renderWithIntl(<DraftGuardProvider>{ui}</DraftGuardProvider>, {
    locale: "en",
    environment: configuredEnvironment,
    workspace: false,
    preserveProviders: true,
  });
}

let stopHistory: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.replace.mockReset();
  mocks.queries.clear();
  mocks.queryArgs.clear();
  mocks.queryResolvers.clear();
  mocks.actions.clear();
  mocks.permissions = ["masterData.customer.read"];
  mocks.authenticated = true;
  mocks.readiness = { kind: "READY_TO_QUERY" };

  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/master-data/customers/line",
  );
  stopHistory = trackAppHistory();

  setQuery(customerLineRefs.viewer, { ok: true, value: FULL_VIEWER });
  setQuery(customerLineRefs.getPrimaryConnectionSummary, {
    ok: true,
    value: {
      name: ACTIVE_OA.name,
      basicId: ACTIVE_OA.basicId,
      state: ACTIVE_OA.state,
    },
  });
  setQuery(customerLineRefs.getPrimaryConnection, {
    ok: true,
    value: ACTIVE_OA,
  });
  setQuery(customerLineRefs.listGroups, {
    ok: true,
    value: { page: [ACTIVE_GROUP, PENDING_GROUP], continueCursor: null },
  });
  setQuery(customerLineRefs.getGroup, { ok: true, value: ACTIVE_GROUP });
  setQuery(customerLineRefs.listQuestions, {
    ok: true,
    value: { page: TWO_SENDER_QUESTIONS, continueCursor: null },
  });
  setQuery(customerLineRefs.listContacts, {
    ok: true,
    value: { page: GROUP_CONTACTS, continueCursor: null },
  });
  mocks.queries.set("customers/linking:searchCustomerOptions", {
    ok: true,
    value: {
      items: [
        {
          customerId: "cust-7",
          code: "C-0007",
          name: "Thairungruang Packaging",
        },
      ],
      hasMore: false,
    },
  });
});

afterEach(() => {
  stopHistory?.();
  stopHistory = undefined;
});

describe("CustomerLineInbox", () => {
  it("direct entry on CustomerLineInbox falls back to /master-data/customers on header Back", async () => {
    renderScreen(<CustomerLineInbox />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    });
    expect(mocks.replace).toHaveBeenCalledWith("/master-data/customers");
  });

  it("header Back on CustomerLineInbox restores the actual caller locale, query, and hash", async () => {
    stopHistory?.();
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/th/master-data/customers?status=ACTIVE#row-7",
    );
    stopHistory = trackAppHistory();
    window.history.pushState({}, "", "/en/master-data/customers/line");

    renderScreen(<CustomerLineInbox />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    });
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/th/master-data/customers?status=ACTIVE#row-7"),
    );
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("denies CustomerLineInbox when viewer lacks canRead and hides settings link without canManageConnection", () => {
    setQuery(customerLineRefs.viewer, {
      ok: true,
      value: {
        canRead: false,
        canManageGroups: false,
        canSend: false,
        canManageConnection: false,
      },
    });
    const { unmount } = renderScreen(<CustomerLineInbox />);
    expect(screen.getByTestId("customer-line-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("line-open-settings")).toBeNull();
    unmount();

    setQuery(customerLineRefs.viewer, {
      ok: true,
      value: {
        canRead: true,
        canManageGroups: false,
        canSend: true,
        canManageConnection: false,
      },
    });
    renderScreen(<CustomerLineInbox />);
    expect(screen.getByTestId("line-groups-list")).toBeInTheDocument();
    expect(screen.queryByTestId("line-open-settings")).toBeNull();
  });

  it("links directly to group detail and pages forward and backward in unfiltered inbox", () => {
    mocks.queryResolvers.set(
      getFunctionName(customerLineRefs.listGroups),
      (args) =>
        args.cursor === "cursor-2"
          ? { ok: true, value: { page: [PENDING_GROUP], continueCursor: null } }
          : {
              ok: true,
              value: { page: [ACTIVE_GROUP], continueCursor: "cursor-2" },
            },
    );

    renderScreen(<CustomerLineInbox />);
    expect(screen.getByTestId("line-primary-oa-summary")).toHaveTextContent(
      "@yongkit-care",
    );
    const groupLink = screen.getByTestId("line-group-link-grp-dispatch");
    expect(groupLink).toHaveAttribute(
      "href",
      "/master-data/customers/line/grp-dispatch",
    );
    expect(screen.getByTestId("line-open-settings")).toHaveAttribute(
      "href",
      "/master-data/customers/line/settings",
    );

    fireEvent.click(screen.getByTestId("line-groups-next"));
    expect(screen.getByTestId("line-group-link-grp-receiving")).toHaveAttribute(
      "href",
      "/master-data/customers/line/grp-receiving",
    );
    expect(
      mocks.queryArgs.get(getFunctionName(customerLineRefs.listGroups)),
    ).toEqual({ cursor: "cursor-2" });

    fireEvent.click(screen.getByTestId("line-groups-previous"));
    expect(
      screen.getByTestId("line-group-link-grp-dispatch"),
    ).toBeInTheDocument();
  });

  it("filtered CustomerLineInbox forwards customerId, shows copyable invite instructions with OA basicId, unfiltered pending link, and reply audience notice", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderScreen(<CustomerLineInbox customerId="cust-7" />);
    expect(
      mocks.queryArgs.get(getFunctionName(customerLineRefs.listGroups)),
    ).toEqual({ customerId: "cust-7" });
    expect(screen.getByTestId("line-filtered-inbox-notice")).toBeVisible();
    expect(screen.getByTestId("line-view-all-groups")).toHaveAttribute(
      "href",
      "/master-data/customers/line",
    );
    expect(screen.getByTestId("line-audience-notice")).toHaveTextContent(
      "Visible to everyone in the LINE group",
    );
    const inviteBox = screen.getByLabelText(
      "Bot invitation instructions",
    ) as HTMLTextAreaElement;
    expect(inviteBox.value).toContain("@yongkit-care");

    fireEvent.click(screen.getByTestId("copy-invite-button"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]?.[0]).toContain("@yongkit-care");
  });
});

describe("CustomerLineGroup", () => {
  it("direct entry on CustomerLineGroup falls back to /master-data/customers/line on header Back", async () => {
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/en/master-data/customers/line/grp-dispatch",
    );
    renderScreen(<CustomerLineGroup groupId="grp-dispatch" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    });
    expect(mocks.replace).toHaveBeenCalledWith("/master-data/customers/line");
  });

  it("pending group hides conversation content and approves verified company link with CustomerPicker", async () => {
    setQuery(customerLineRefs.getGroup, { ok: true, value: PENDING_GROUP });
    const approveSpy = vi.fn().mockResolvedValue({ ok: true, value: null });
    registerTestMutation(customerLineRefs.approveGroup, approveSpy);

    renderScreen(<CustomerLineGroup groupId="grp-receiving" />);
    expect(screen.getByTestId("line-group-pending-notice")).toBeVisible();
    expect(screen.queryByTestId("line-questions-list")).toBeNull();
    expect(screen.queryByTestId("line-contacts-list")).toBeNull();
    expect(
      mocks.queryArgs.has(getFunctionName(customerLineRefs.listQuestions)),
    ).toBe(false);

    chooseOption("Customer company", "Thairungruang Packaging (C-0007)");
    fireEvent.click(screen.getByTestId("line-approve-confirm-checkbox"));
    fireEvent.click(screen.getByTestId("line-approve-submit"));

    await waitFor(() =>
      expect(approveSpy).toHaveBeenCalledWith({
        groupId: "grp-receiving",
        customerId: "cust-7",
        expectedVersion: 1,
        confirmed: true,
      }),
    );
  });

  it("connected group links to customer workspace, receives two independent sender requests, preserves drafts, requires explicit audience confirmation, and handles nested error codes", async () => {
    const queueReplySpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { code: "VERSION_CONFLICT" } })
      .mockResolvedValueOnce({ ok: true, value: null });
    registerTestMutation(customerLineRefs.queueReply, queueReplySpy);

    renderScreen(<CustomerLineGroup groupId="grp-dispatch" />);

    expect(screen.getByTestId("line-group-open-customer")).toHaveAttribute(
      "href",
      "/master-data/customers/cust-7",
    );
    expect(screen.getByTestId("line-question-select-q-1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("line-question-select-q-2")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("line-replying-to")).toHaveTextContent("Wipa S.");
    expect(screen.getByTestId("line-reply-audience-warning")).toHaveTextContent(
      "Visible to everyone in this LINE group",
    );

    const textarea = screen.getByLabelText(/Reply message/i);
    fireEvent.change(textarea, {
      target: { value: "JO-2511-0423 is in finishing today." },
    });

    // Switch to the second independent sender and draft separately.
    fireEvent.click(screen.getByTestId("line-question-select-q-2"));
    expect(screen.getByTestId("line-replying-to")).toHaveTextContent(
      "Nattaphon C.",
    );
    expect(textarea).toHaveValue("");
    fireEvent.change(textarea, {
      target: { value: "Pickup tomorrow at 09:00 is confirmed." },
    });

    // Switch back to verify first sender's draft was preserved.
    fireEvent.click(screen.getByTestId("line-question-select-q-1"));
    expect(textarea).toHaveValue("JO-2511-0423 is in finishing today.");

    // Switch back to second sender and submit; first verify audience checkbox is enforced.
    fireEvent.click(screen.getByTestId("line-question-select-q-2"));
    fireEvent.click(screen.getByTestId("line-reply-submit"));
    expect(queueReplySpy).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Confirm the group audience before sending.",
    );

    // Check explicit audience confirmation; first attempt returns { code: "VERSION_CONFLICT" }.
    fireEvent.click(screen.getByTestId("line-reply-audience-checkbox"));
    fireEvent.click(screen.getByTestId("line-reply-submit"));
    await waitFor(() => expect(queueReplySpy).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(
        /This group changed before your request completed/,
      ),
    ).toBeVisible();
    expect(textarea).toHaveValue("Pickup tomorrow at 09:00 is confirmed.");

    // Second attempt succeeds with null outcome.value.
    fireEvent.click(screen.getByTestId("line-reply-submit"));
    await waitFor(() => expect(queueReplySpy).toHaveBeenCalledTimes(2));
    expect(queueReplySpy).toHaveBeenLastCalledWith({
      groupId: "grp-dispatch",
      questionId: "q-2",
      text: "Pickup tomorrow at 09:00 is confirmed.",
      confirmedAudience: true,
    });
    await waitFor(() => expect(textarea).toHaveValue(""));
  });

  it("supports pause, resume, and paused reapproval while showing local disconnect without implying LINE leave", async () => {
    const stateSpy = vi.fn().mockResolvedValue({ ok: true, value: null });
    registerTestMutation(customerLineRefs.setGroupState, stateSpy);

    const { unmount } = renderScreen(
      <CustomerLineGroup groupId="grp-dispatch" />,
    );
    fireEvent.click(screen.getByTestId("line-group-pause"));
    await waitFor(() =>
      expect(stateSpy).toHaveBeenCalledWith({
        groupId: "grp-dispatch",
        expectedVersion: 3,
        state: "paused",
      }),
    );
    unmount();

    setQuery(customerLineRefs.getGroup, {
      ok: true,
      value: { ...ACTIVE_GROUP, state: "paused", version: 4 },
    });
    const pausedView = renderScreen(
      <CustomerLineGroup groupId="grp-dispatch" />,
    );
    await act(async () =>
      fireEvent.click(screen.getByTestId("line-group-resume")),
    );
    await waitFor(() =>
      expect(stateSpy).toHaveBeenCalledWith({
        groupId: "grp-dispatch",
        expectedVersion: 4,
        state: "active",
      }),
    );
    fireEvent.click(screen.getByTestId("line-group-reapprove"));
    await waitFor(() =>
      expect(stateSpy).toHaveBeenCalledWith({
        groupId: "grp-dispatch",
        expectedVersion: 4,
        state: "pending",
      }),
    );
    pausedView.unmount();

    setQuery(customerLineRefs.getGroup, {
      ok: true,
      value: {
        ...ACTIVE_GROUP,
        state: "paused",
        providerDeparture: "left",
        version: 5,
      },
    });
    const leftPausedView = renderScreen(
      <CustomerLineGroup groupId="grp-dispatch" />,
    );
    expect(screen.getByTestId("line-group-reapprove")).toBeDisabled();
    leftPausedView.unmount();

    setQuery(customerLineRefs.getGroup, {
      ok: true,
      value: { ...ACTIVE_GROUP, state: "disconnected", version: 6 },
    });
    renderScreen(<CustomerLineGroup groupId="grp-dispatch" />);
    expect(
      screen.getByTestId("line-group-disconnected-notice"),
    ).toHaveTextContent("does not imply the bot left the LINE chat");
    expect(screen.getByTestId("line-group-reapprove")).toBeEnabled();
  });

  it("reopens a locally disconnected LINE group and Back restores the filtered inbox", async () => {
    stopHistory?.();
    const origin = "/th/master-data/customers/line?customerId=cust-7#groups";
    const freshHref = "/master-data/customers/line/fresh-group";
    window.history.replaceState({ appNavigationIndex: 0 }, "", origin);
    stopHistory = trackAppHistory();
    window.history.pushState(
      {},
      "",
      "/th/master-data/customers/line/grp-dispatch",
    );
    mocks.replace.mockImplementation((href: string) => {
      window.history.replaceState(window.history.state, "", `/th${href}`);
    });

    setQuery(customerLineRefs.getGroup, {
      ok: true,
      value: { ...ACTIVE_GROUP, state: "disconnected", version: 6 },
    });
    let finishReapproval: (result: unknown) => void = () => {};
    const stateSpy = vi.fn(
      () =>
        new Promise((resolve) => {
          finishReapproval = resolve;
        }),
    );
    registerTestMutation(customerLineRefs.setGroupState, stateSpy);
    const view = renderScreen(<CustomerLineGroup groupId="grp-dispatch" />);
    fireEvent.click(screen.getByTestId("line-group-reapprove"));
    expect(stateSpy).toHaveBeenCalledWith({
      groupId: "grp-dispatch",
      expectedVersion: 6,
      state: "pending",
    });

    setQuery(customerLineRefs.getGroup, { ok: true, value: null });
    view.rerender(
      <DraftGuardProvider>
        <CustomerLineGroup groupId="grp-dispatch" />
      </DraftGuardProvider>,
    );
    await act(async () => {
      finishReapproval({ ok: true, value: { groupId: "fresh-group" } });
    });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(freshHref));
    expect(window.location.pathname).toBe(`/th${freshHref}`);

    act(() => window.history.back());
    await waitFor(() =>
      expect(window.location.href.endsWith(origin)).toBe(true),
    );
  });

  it("group disconnect confirmation cancels cleanly so the next native Back leaves the group", async () => {
    stopHistory?.();
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/en/master-data/customers/line",
    );
    stopHistory = trackAppHistory();
    window.history.pushState(
      {},
      "",
      "/en/master-data/customers/line/grp-dispatch",
    );

    renderScreen(<CustomerLineGroup groupId="grp-dispatch" />);
    fireEvent.click(screen.getByTestId("line-group-disconnect"));
    const dialog = screen.getByTestId("line-group-disconnect-dialog");
    expect(dialog).toBeVisible();

    // First verify native Back dismisses the open confirmation before leaving.
    act(() => window.history.back());
    await waitFor(() =>
      expect(
        screen.queryByTestId("line-group-disconnect-dialog"),
      ).not.toBeInTheDocument(),
    );
    expect(window.location.pathname).toBe(
      "/en/master-data/customers/line/grp-dispatch",
    );

    // Reopen, explicitly Cancel, wait for overlay history entry consumption, then verify the next Back leaves the group.
    fireEvent.click(screen.getByTestId("line-group-disconnect"));
    const reopened = screen.getByTestId("line-group-disconnect-dialog");
    fireEvent.click(within(reopened).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByTestId("line-group-disconnect-dialog"),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(window.location.search).toBe(""));

    act(() => window.history.back());
    await waitFor(() =>
      expect(window.location.pathname).toBe("/en/master-data/customers/line"),
    );
  });

  it("group disconnect confirmation blocks dismissal while pending and consumes its entry on success", async () => {
    stopHistory?.();
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/en/master-data/customers/line",
    );
    stopHistory = trackAppHistory();
    window.history.pushState(
      {},
      "",
      "/en/master-data/customers/line/grp-dispatch",
    );

    const pendingWrite = deferred<{ ok: true; value: null }>();
    const stateSpy = vi.fn().mockReturnValue(pendingWrite.promise);
    registerTestMutation(customerLineRefs.setGroupState, stateSpy);

    renderScreen(<CustomerLineGroup groupId="grp-dispatch" />);
    fireEvent.click(screen.getByTestId("line-group-disconnect"));
    const dialog = screen.getByTestId("line-group-disconnect-dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Disconnect group" }),
    );

    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ).toBeDisabled(),
    );

    // Native Back cannot close while pending.
    act(() => window.history.back());
    expect(screen.getByTestId("line-group-disconnect-dialog")).toBeVisible();

    await act(async () => {
      pendingWrite.resolve({ ok: true, value: null });
    });

    await waitFor(() =>
      expect(
        screen.queryByTestId("line-group-disconnect-dialog"),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(stateSpy).toHaveBeenCalledWith({
      groupId: "grp-dispatch",
      expectedVersion: 3,
      state: "disconnected",
    });

    // Entry was consumed on success, so the next Back leaves directly to inbox.
    act(() => window.history.back());
    await waitFor(() =>
      expect(window.location.pathname).toBe("/en/master-data/customers/line"),
    );
  });

  it("contact verification edits verified business name, confirms with setContact, and Cancel consumes Back before leaving", async () => {
    stopHistory?.();
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/en/master-data/customers/line",
    );
    stopHistory = trackAppHistory();
    window.history.pushState(
      {},
      "",
      "/en/master-data/customers/line/grp-dispatch",
    );

    const setContactSpy = vi.fn().mockResolvedValue({ ok: true, value: null });
    registerTestMutation(customerLineRefs.setContact, setContactSpy);

    renderScreen(<CustomerLineGroup groupId="grp-dispatch" />);
    fireEvent.click(screen.getByTestId("line-contact-action-contact-2"));
    const dialog = screen.getByTestId("line-contact-dialog");
    const nameInput = within(dialog).getByTestId(
      "line-contact-verified-name-input",
    );
    expect(nameInput).toHaveValue("Nattaphon (LINE)");

    // Cancel consumes its entry; wait for overlay query cleanup before reopening.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByTestId("line-contact-dialog"),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(window.location.search).toBe(""));

    // Reopen, edit to verified business name, and submit.
    fireEvent.click(screen.getByTestId("line-contact-action-contact-2"));
    const reopened = screen.getByTestId("line-contact-dialog");
    fireEvent.change(
      within(reopened).getByTestId("line-contact-verified-name-input"),
      { target: { value: "Nattaphon Chankit" } },
    );
    fireEvent.click(
      within(reopened).getByRole("button", { name: "Verify contact" }),
    );

    await waitFor(() =>
      expect(setContactSpy).toHaveBeenCalledWith({
        groupId: "grp-dispatch",
        contactId: "contact-2",
        verified: true,
        name: "Nattaphon Chankit",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("line-contact-dialog"),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(window.location.search).toBe(""));

    act(() => window.history.back());
    await waitFor(() =>
      expect(window.location.pathname).toBe("/en/master-data/customers/line"),
    );
  });

  it("pages group questions and contacts forward and backward", () => {
    mocks.queryResolvers.set(
      getFunctionName(customerLineRefs.listQuestions),
      (args) =>
        args.cursor === "q-cursor-2"
          ? {
              ok: true,
              value: {
                page: [TWO_SENDER_QUESTIONS[1]!],
                continueCursor: null,
              },
            }
          : {
              ok: true,
              value: {
                page: [TWO_SENDER_QUESTIONS[0]!],
                continueCursor: "q-cursor-2",
              },
            },
    );
    mocks.queryResolvers.set(
      getFunctionName(customerLineRefs.listContacts),
      (args) =>
        args.cursor === "c-cursor-2"
          ? {
              ok: true,
              value: {
                page: [GROUP_CONTACTS[1]!],
                continueCursor: null,
              },
            }
          : {
              ok: true,
              value: {
                page: [GROUP_CONTACTS[0]!],
                continueCursor: "c-cursor-2",
              },
            },
    );

    renderScreen(<CustomerLineGroup groupId="grp-dispatch" />);
    const nextButtons = screen.getAllByRole("button", { name: "Next page" });
    expect(nextButtons).toHaveLength(2);

    fireEvent.click(nextButtons[0]!);
    expect(screen.getByTestId("line-question-select-q-2")).toBeInTheDocument();
    fireEvent.click(nextButtons[1]!);
    expect(
      screen.getByTestId("line-contact-action-contact-2"),
    ).toBeInTheDocument();

    const prevButtons = screen.getAllByRole("button", {
      name: "Previous page",
    });
    expect(prevButtons).toHaveLength(2);
    fireEvent.click(prevButtons[0]!);
    expect(screen.getByTestId("line-question-select-q-1")).toBeInTheDocument();
    fireEvent.click(prevButtons[1]!);
    expect(
      screen.getByTestId("line-contact-action-contact-1"),
    ).toBeInTheDocument();
  });

  it("contact revocation blocks dismissal while pending and revokes verified role without disconnecting group", async () => {
    const pendingWrite = deferred<{ ok: true; value: null }>();
    const setContactSpy = vi.fn().mockReturnValue(pendingWrite.promise);
    registerTestMutation(customerLineRefs.setContact, setContactSpy);

    renderScreen(<CustomerLineGroup groupId="grp-dispatch" />);
    fireEvent.click(screen.getByTestId("line-contact-action-contact-1"));
    const dialog = screen.getByTestId("line-contact-dialog");
    expect(dialog).toHaveTextContent("This group stays connected");
    expect(
      within(dialog).queryByTestId("line-contact-verified-name-input"),
    ).toBeNull();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Revoke role" }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ).toBeDisabled(),
    );

    await act(async () => {
      pendingWrite.resolve({ ok: true, value: null });
    });

    await waitFor(() =>
      expect(
        screen.queryByTestId("line-contact-dialog"),
      ).not.toBeInTheDocument(),
    );
    expect(setContactSpy).toHaveBeenCalledWith({
      groupId: "grp-dispatch",
      contactId: "contact-1",
      verified: false,
    });
  });
});

describe("CustomerLineSettings", () => {
  it("direct entry on CustomerLineSettings falls back to /master-data/customers/line on header Back", async () => {
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/en/master-data/customers/line/settings",
    );
    renderScreen(<CustomerLineSettings />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    });
    expect(mocks.replace).toHaveBeenCalledWith("/master-data/customers/line");
  });

  it("denies CustomerLineSettings when viewer lacks canManageConnection", () => {
    setQuery(customerLineRefs.viewer, {
      ok: true,
      value: {
        canRead: true,
        canManageGroups: true,
        canSend: true,
        canManageConnection: false,
      },
    });
    renderScreen(<CustomerLineSettings />);
    expect(
      screen.getByTestId("customer-line-settings-denied"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("line-connect-oa-form")).toBeNull();
  });

  it("connects primary OA credentials, reports transport error codes, and clears inputs on success", async () => {
    setQuery(customerLineRefs.getPrimaryConnection, { ok: true, value: null });
    const connectSpy = setAction(
      customerLineRefs.connectPrimary,
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          value: { code: "LINE_CREDENTIALS_INVALID" },
        })
        .mockResolvedValueOnce({ ok: true, value: ACTIVE_OA }),
    );

    renderScreen(<CustomerLineSettings />);
    const secretInput = screen.getByLabelText(/Channel secret/i);
    const tokenInput = screen.getByLabelText(/Channel access token/i);

    fireEvent.change(secretInput, { target: { value: "secret-fixture-1" } });
    fireEvent.change(tokenInput, { target: { value: "token-fixture-1" } });
    fireEvent.click(screen.getByTestId("line-connect-oa-submit"));

    await waitFor(() => expect(connectSpy).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/LINE rejected those channel credentials/),
    ).toBeVisible();
    expect(secretInput).toHaveValue("secret-fixture-1");

    fireEvent.click(screen.getByTestId("line-connect-oa-submit"));
    await waitFor(() => expect(connectSpy).toHaveBeenCalledTimes(2));
    expect(connectSpy).toHaveBeenLastCalledWith({
      channelSecret: "secret-fixture-1",
      accessToken: "token-fixture-1",
    });
    await waitFor(() => {
      expect(secretInput).toHaveValue("");
      expect(tokenInput).toHaveValue("");
    });
  });

  it("shows derived webhook URL, three readiness checks, and sends neutral test ping to selected pending group", async () => {
    setQuery(customerLineRefs.getPrimaryConnection, {
      ok: true,
      value: {
        ...ACTIVE_OA,
        state: "setup",
        testSentAt: undefined,
      },
    });
    const testSpy = setAction(
      customerLineRefs.testConnection,
      vi.fn().mockResolvedValue({ ok: true, value: null }),
    );

    renderScreen(<CustomerLineSettings />);
    expect(screen.getByTestId("line-webhook-url")).toHaveTextContent(
      "https://example.convex.site/webhooks/customer-line/00000000-0000-4000-8000-000000000001",
    );
    const checks = screen.getByTestId("line-readiness-checks");
    expect(checks).toHaveTextContent("OA identity verified");
    expect(checks).toHaveTextContent("Signed webhook received");
    expect(checks).toHaveTextContent("Neutral group test ping passed");

    fireEvent.click(screen.getByTestId("line-send-test-ping"));
    await waitFor(() =>
      expect(testSpy).toHaveBeenCalledWith({
        connectionId: "conn-primary",
        groupId: "grp-receiving",
      }),
    );
    expect(
      await screen.findByText("Neutral test ping accepted by LINE."),
    ).toBeVisible();
  });

  it("primary OA disconnect confirmation cancels cleanly before next Back and blocks dismissal while pending", async () => {
    stopHistory?.();
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/en/master-data/customers/line",
    );
    stopHistory = trackAppHistory();
    window.history.pushState({}, "", "/en/master-data/customers/line/settings");

    const pendingWrite = deferred<{ ok: true; value: null }>();
    const disconnectSpy = vi.fn().mockReturnValue(pendingWrite.promise);
    registerTestMutation(customerLineRefs.disconnectConnection, disconnectSpy);

    renderScreen(<CustomerLineSettings />);

    // Open -> Cancel -> wait for overlay entry cleanup before reopening.
    fireEvent.click(screen.getByTestId("line-disconnect-oa"));
    const dialog = screen.getByTestId("line-oa-disconnect-dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByTestId("line-oa-disconnect-dialog"),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(window.location.search).toBe(""));

    // Reopen -> Confirm -> pending blocks Back -> success consumes entry -> next Back leaves settings.
    fireEvent.click(screen.getByTestId("line-disconnect-oa"));
    const reopened = screen.getByTestId("line-oa-disconnect-dialog");
    fireEvent.click(
      within(reopened).getByRole("button", { name: "Disconnect primary OA" }),
    );
    await waitFor(() =>
      expect(
        within(reopened).getByRole("button", { name: "Cancel" }),
      ).toBeDisabled(),
    );

    act(() => window.history.back());
    expect(screen.getByTestId("line-oa-disconnect-dialog")).toBeVisible();

    await act(async () => {
      pendingWrite.resolve({ ok: true, value: null });
    });
    await waitFor(() =>
      expect(
        screen.queryByTestId("line-oa-disconnect-dialog"),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(disconnectSpy).toHaveBeenCalledWith({
      connectionId: "conn-primary",
    });

    act(() => window.history.back());
    await waitFor(() =>
      expect(window.location.pathname).toBe("/en/master-data/customers/line"),
    );
  });
});
