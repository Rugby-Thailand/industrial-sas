import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { beforeEach, expect, it, vi } from "vitest";

import { getTestMutation } from "@tests/fixtures/convex-mutation";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { trackAppHistory } from "@/lib/browser/appHistory";
import CustomerLinePage from "@/app/[locale]/(desktop)/master-data/customers/line/page";
import CustomerLineGroupPage from "@/app/[locale]/(desktop)/master-data/customers/line/[groupId]/page";
import CustomerLineSettingsPage from "@/app/[locale]/(desktop)/master-data/customers/line/settings/page";

const mocks = vi.hoisted(() => ({
  router: { back: vi.fn(), replace: vi.fn(), push: vi.fn() },
  queries: new Map<string, unknown>(),
}));
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }));
vi.mock("convex/react", () => ({
  useQuery: (
    reference: Parameters<typeof getFunctionName>[0],
    args: unknown,
  ) =>
    args === "skip"
      ? undefined
      : queryFixture(getFunctionName(reference), args),
  useAction: () => vi.fn(),
  useMutation: getTestMutation,
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => ({
    authenticated: true,
    readiness: { kind: "READY_TO_QUERY" },
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => <a {...props} />,
  useRouter: () => mocks.router,
}));

function queryFixture(name: string, args: unknown) {
  const outcome = mocks.queries.get(name);
  return typeof outcome === "function" ? outcome(args) : outcome;
}

function queryValue<T>(value: T) {
  return { ok: true, value };
}

const inbox = "/master-data/customers/line";
const group = `${inbox}/group-a`;
const params = Promise.resolve({ locale: "en" });
const render = (component: Awaited<ReturnType<typeof CustomerLinePage>>) =>
  renderWithIntl(component, { locale: "en", workspace: false });
const openDirect = (path: string) =>
  window.history.replaceState({ appNavigationIndex: 0 }, "", `/en${path}`);
const back = () =>
  fireEvent.click(screen.getByRole("button", { name: "Back" }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queries.clear();
  mocks.queries.set("customerLine/groups:viewer", {
    ok: true,
    value: {
      canRead: true,
      canManageGroups: true,
      canManageConnection: true,
      canSend: true,
    },
  });
});

it("the LINE inbox route opened directly falls back to the customer list", async () => {
  openDirect(inbox);
  render(await CustomerLinePage({ params, searchParams: Promise.resolve({}) }));
  back();
  expect(mocks.router.replace).toHaveBeenCalledWith("/master-data/customers");
});

it("the LINE group route opened directly falls back to the inbox", async () => {
  openDirect(group);
  render(
    await CustomerLineGroupPage({
      params: Promise.resolve({ locale: "en", groupId: "group-a" }),
    }),
  );
  back();
  expect(mocks.router.replace).toHaveBeenCalledWith(inbox);
});

it("the LINE settings route opened directly falls back to the inbox", async () => {
  openDirect(`${inbox}/settings`);
  render(await CustomerLineSettingsPage({ params }));
  back();
  expect(mocks.router.replace).toHaveBeenCalledWith(inbox);
});

it("the LINE group header restores its actual localized inbox filter and hash", async () => {
  const source = `/th${inbox}?customerId=customer-a#groups`;
  window.history.replaceState({ appNavigationIndex: 0 }, "", source);
  const stop = trackAppHistory();
  try {
    window.history.pushState({}, "", `/en${group}`);
    mocks.router.back.mockImplementation(() => window.history.back());
    render(
      await CustomerLineGroupPage({
        params: Promise.resolve({ locale: "en", groupId: "group-a" }),
      }),
    );
    await act(async () => {
      back();
    });
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe(source),
    );
    expect(mocks.router.replace).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

const firstGroup = {
  _id: "group-a",
  name: "Dispatch group",
  customerId: "customer-a",
  customerName: "Customer A",
  state: "active",
  version: 2,
  lastActivityAt: Date.UTC(2026, 10, 27),
};
const firstQuestion = {
  _id: "question-a",
  senderLabel: "Alice",
  text: "Where is job A?",
  createdAt: Date.UTC(2026, 10, 27),
  state: "open",
};
const secondQuestion = {
  ...firstQuestion,
  _id: "question-b",
  senderLabel: "Bob",
  text: "Is job B ready?",
};

function mockGroup() {
  const connection = {
    _id: "connection-a",
    name: "Customer support",
    basicId: "@customer",
    state: "active",
    webhookPath: "/fixture",
    identityVerifiedAt: 1,
  };
  mocks.queries.set(
    "customerLine/groups:getPrimaryConnection",
    queryValue(connection),
  );
  mocks.queries.set(
    "customerLine/groups:getPrimaryConnectionSummary",
    queryValue(connection),
  );
  mocks.queries.set("customerLine/groups:getGroup", queryValue(firstGroup));
  mocks.queries.set(
    "customerLine/groups:listQuestions",
    queryValue({ page: [firstQuestion, secondQuestion], continueCursor: null }),
  );
  mocks.queries.set(
    "customerLine/groups:listContacts",
    queryValue({ page: [], continueCursor: null }),
  );
}

it("paginates the actual customer LINE inbox without changing its filter or browser entry", async () => {
  mockGroup();
  const url = `${inbox}?customerId=customer-a#groups`;
  openDirect(url);
  mocks.queries.set(
    "customerLine/groups:listGroups",
    ({ customerId, cursor }: { customerId?: string; cursor?: string }) => {
      expect(customerId).toBe("customer-a");
      return queryValue(
        cursor
          ? {
              page: [
                { ...firstGroup, _id: "group-b", name: "Receiving group" },
              ],
              continueCursor: null,
            }
          : { page: [firstGroup], continueCursor: "line-groups-page-2" },
      );
    },
  );
  render(
    await CustomerLinePage({
      params,
      searchParams: Promise.resolve({ customerId: "customer-a" }),
    }),
  );
  expect(screen.getByRole("link", { name: /Dispatch group/ })).toBeVisible();
  fireEvent.click(screen.getByTestId("line-groups-next"));
  expect(screen.getByRole("link", { name: /Receiving group/ })).toBeVisible();
  expect(
    window.location.pathname + window.location.search + window.location.hash,
  ).toBe(`/en${url}`);
  fireEvent.click(screen.getByTestId("line-groups-previous"));
  expect(screen.getByRole("link", { name: /Dispatch group/ })).toBeVisible();
});

it("keeps both request drafts when asking staff to review another question in the same LINE group", async () => {
  mockGroup();
  openDirect(group);
  render(
    await CustomerLineGroupPage({
      params: Promise.resolve({ locale: "en", groupId: "group-a" }),
    }),
  );
  const composer = screen.getByTestId("line-reply-composer");
  const field = within(composer).getByRole("textbox");
  fireEvent.change(field, { target: { value: "Draft for Alice" } });
  fireEvent.click(screen.getByTestId("line-question-select-question-b"));
  expect(screen.getByTestId("line-replying-to")).toHaveTextContent("Bob");
  expect(field).toHaveValue("");
  fireEvent.change(field, { target: { value: "Draft for Bob" } });
  fireEvent.click(screen.getByTestId("line-question-select-question-a"));
  expect(field).toHaveValue("Draft for Alice");
  fireEvent.click(screen.getByTestId("line-question-select-question-b"));
  expect(field).toHaveValue("Draft for Bob");
  expect(window.location.pathname).toBe(`/en${group}`);
});

it("pages LINE questions and contacts inline without pushing a browser entry", async () => {
  mockGroup();
  openDirect(group);
  mocks.queries.set(
    "customerLine/groups:listQuestions",
    ({ cursor }: { cursor?: string }) =>
      queryValue(
        cursor
          ? { page: [secondQuestion], continueCursor: null }
          : { page: [firstQuestion], continueCursor: "line-questions-page-2" },
      ),
  );
  mocks.queries.set(
    "customerLine/groups:listContacts",
    ({ cursor }: { cursor?: string }) =>
      queryValue(
        cursor
          ? {
              page: [{ _id: "contact-b", name: "Bob", state: "observed" }],
              continueCursor: null,
            }
          : {
              page: [{ _id: "contact-a", name: "Alice", state: "verified" }],
              continueCursor: "line-contacts-page-2",
            },
      ),
  );
  const historyLength = window.history.length;
  render(
    await CustomerLineGroupPage({
      params: Promise.resolve({ locale: "en", groupId: "group-a" }),
    }),
  );
  const [questionsNext, contactsNext] = screen.getAllByRole("button", {
    name: "Next page",
  });
  if (!questionsNext || !contactsNext)
    throw new Error("Expected both inline pagers");
  fireEvent.click(questionsNext);
  expect(
    within(screen.getByTestId("line-questions-list")).getByText(
      "Is job B ready?",
    ),
  ).toBeVisible();
  fireEvent.click(contactsNext);
  expect(
    within(screen.getByTestId("line-contacts-list")).getByText("Bob"),
  ).toBeVisible();
  expect(window.history.length).toBe(historyLength);
  expect(window.location.pathname).toBe(`/en${group}`);
});
