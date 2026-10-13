import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { guardedNavigate } from "@/lib/navigationGuard";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  access: {
    status: "READY",
    permissions: ["hr.self.access", "hr.admin.manage"],
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    identityKey: "org:user",
    sites: [{ id: "warehouse-1", code: "WH-1", name: "Factory" }],
  },
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    state.query(getFunctionName(ref), args),
  useMutation:
    (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
      state.mutation(getFunctionName(ref), args),
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => state.access,
  useHrCan: (code: string) => state.access.permissions.includes(code),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/hr/announcements",
  Link: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
import {
  HrAnnouncementDetailScreen,
  HrAnnouncementsScreen,
} from "./AnnouncementsScreen";
import { HrAnnouncementManageScreen } from "./AnnouncementManageScreen";
import { HrNotificationsScreen, notificationHref } from "./NotificationsScreen";
const envelope = (value: unknown) => ({ ok: true, value });
const announcement = () => ({
  _id: "notice-1",
  title: "Safety briefing",
  body: "Read <script>unsafe()</script> as text",
  status: "PUBLISHED",
  version: 5,
  publishedVersion: 2,
  publishedAt: Date.UTC(2026, 9, 12, 4),
  pinned: false,
  acknowledgmentRequired: true,
  audience: { mode: "SITES", warehouseIds: ["warehouse-1"] },
});
const detail = () => ({
  ok: true,
  announcement: announcement(),
  receipt: { _id: "receipt-1", contentVersion: 2 },
  authorName: "HR Manager",
});
const manage = (items: unknown[] = [], active = true) => ({
  ok: true,
  items,
  nextCursor: null,
  policy: active
    ? {
        config: {
          announcementAudience: "SITE",
          announcementAcknowledgment: false,
        },
      }
    : null,
});
beforeEach(() => {
  window.history.replaceState({ appNavigationIndex: 0 }, "", "/en/hr/leave");
  state.query.mockReset();
  state.mutation.mockReset();
  state.access.permissions = ["hr.self.access", "hr.admin.manage"];
  state.mutation.mockResolvedValue(
    envelope({ written: true, documentId: "notice-new", version: 1 }),
  );
  sessionStorage.clear();
});
afterEach(cleanup);
it("loads plain text without recording a receipt, then acknowledges the exact published version", async () => {
  state.query.mockReturnValue(envelope(detail()));
  const { container } = renderWithIntl(
    <HrAnnouncementDetailScreen announcementId="notice-1" />,
    { locale: "en" },
  );
  expect(screen.getByText(announcement().body)).toBeInTheDocument();
  expect(container.querySelector("script")).toBeNull();
  expect(state.mutation).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Acknowledge this version" }),
  );
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(1));
  expect(state.mutation.mock.calls[0]).toEqual([
    "hr/announcements:recordReceipt",
    expect.objectContaining({
      announcementId: "notice-1",
      contentVersion: 2,
      action: "ACKNOWLEDGE",
    }),
  ]);
});
it("archives retain readable history while formal acknowledgment is unavailable", () => {
  state.query.mockReturnValue(
    envelope({
      ...detail(),
      announcement: { ...announcement(), status: "ARCHIVED" },
    }),
  );
  renderWithIntl(<HrAnnouncementDetailScreen announcementId="notice-1" />, {
    locale: "en",
  });
  expect(screen.getByText(announcement().body)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Acknowledge this version" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mark read" })).toBeEnabled();
});
it("pinned filtering resets the server cursor and retains loaded notices when the policy is inactive", () => {
  state.query.mockReturnValue(
    envelope({
      ok: true,
      items: [
        {
          announcement: announcement(),
          receipt: { _id: "receipt-1", contentVersion: 2 },
          authorName: "HR",
        },
      ],
      nextCursor: "next-page",
      gate: "POLICY_NOT_ACTIVE",
    }),
  );
  renderWithIntl(<HrAnnouncementsScreen />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(state.query).toHaveBeenLastCalledWith(
    "hr/announcements:self",
    expect.objectContaining({ cursor: "next-page" }),
  );
  fireEvent.click(screen.getByLabelText("Pinned announcements only"));
  expect(state.query).toHaveBeenLastCalledWith("hr/announcements:self", {
    limit: 20,
    pinnedOnly: true,
  });
  expect(screen.getByText("Safety briefing")).toBeInTheDocument();
});
it("allows drafts without policy activation but refuses publication", async () => {
  state.query.mockReturnValue(envelope(manage([], false)));
  renderWithIntl(<HrAnnouncementManageScreen />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "New draft" }));
  fireEvent.change(screen.getByLabelText("Title", { exact: false }), {
    target: { value: "Holiday notice" },
  });
  fireEvent.change(screen.getByLabelText("Message", { exact: false }), {
    target: { value: "Office will close." },
  });
  fireEvent.click(screen.getByLabelText("WH-1 · Factory"));
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(1));
  expect(state.mutation.mock.calls[0]?.[0]).toBe("hr/announcements:saveDraft");
  expect(
    screen.getByRole("button", { name: "Publish saved draft" }),
  ).toBeDisabled();
});
it("revising published content creates another draft and preserves the original identifier", async () => {
  state.query.mockReturnValue(envelope(manage([announcement()])));
  renderWithIntl(<HrAnnouncementManageScreen />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "Create revised draft" }));
  fireEvent.change(screen.getByLabelText("Title", { exact: false }), {
    target: { value: "Updated safety briefing" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(1));
  expect(state.mutation.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({
      replacesId: "notice-1",
      expectedVersion: 0,
      title: "Updated safety briefing",
    }),
  );
  expect(state.mutation.mock.calls[0]?.[1]).not.toHaveProperty(
    "announcementId",
  );
});
it("retries an uncertain publish verbatim and closes the draft only after confirmation", async () => {
  state.query.mockReturnValue(
    envelope(manage([{ ...announcement(), status: "DRAFT", version: 3 }])),
  );
  state.mutation
    .mockRejectedValueOnce(new Error("connection lost"))
    .mockResolvedValueOnce(
      envelope({ written: true, documentId: "notice-1", version: 4 }),
    );
  renderWithIntl(<HrAnnouncementManageScreen />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Publish saved draft" }));
  await screen.findByTestId("hr-write-uncertain");
  expect(screen.getByLabelText("Title", { exact: false })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Try again safely" }));
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(2));
  expect(state.mutation.mock.calls[1]).toEqual(state.mutation.mock.calls[0]);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Publish saved draft" }),
    ).not.toBeInTheDocument(),
  );
});
it("shows bounded unread counts and offers another explicit batch without acknowledging notices", async () => {
  state.query.mockReturnValue(
    envelope({
      ok: true,
      items: [],
      nextCursor: null,
      unreadCount: 500,
      unreadCountComplete: false,
    }),
  );
  state.mutation.mockResolvedValue(
    envelope({ written: true, moreUnread: true, markedCount: 500 }),
  );
  renderWithIntl(<HrNotificationsScreen />, { locale: "en" });
  expect(screen.getByText("500+ unread")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Mark up to 500 read" }));
  await screen.findByText("More unread notifications remain");
  expect(state.mutation.mock.calls[0]?.[0]).toBe("hr/notifications:markAll");
  expect(state.mutation).toHaveBeenCalledTimes(1);
});
it("notification links stay within known employee records and encode resource identifiers", () => {
  const base = { _id: "n", title: "Update", createdAt: 1, unread: true };
  expect(
    notificationHref({
      ...base,
      event: "ANNOUNCEMENT_PUBLISHED",
      announcementId: "x/y",
    }),
  ).toBe("/hr/announcements/x%2Fy");
  expect(
    notificationHref({
      ...base,
      event: "CORRECTION_DECIDED",
      resourceId: "request-1",
    }),
  ).toBe("/hr/requests/request-1");
  expect(
    notificationHref({
      ...base,
      event: "UNKNOWN",
      resourceId: "https://outside.example",
    }),
  ).toBeUndefined();
});
it("business read refusals remain visible instead of an empty announcement list", () => {
  state.query.mockReturnValue(envelope({ ok: false, code: "HR_NOT_LINKED" }));
  renderWithIntl(<HrAnnouncementsScreen />, { locale: "en" });
  expect(screen.getByTestId("hr-error")).toBeInTheDocument();
  expect(screen.queryByText("No announcements")).not.toBeInTheDocument();
});
it("reading one notification records only notification status and keeps a safe link to its notice", async () => {
  state.query.mockReturnValue(
    envelope({
      ok: true,
      items: [
        {
          _id: "notification-1",
          title: "Safety briefing",
          createdAt: 1,
          unread: true,
          event: "ANNOUNCEMENT_PUBLISHED",
          announcementId: "notice-1",
        },
      ],
      nextCursor: null,
      unreadCount: 1,
      unreadCountComplete: true,
    }),
  );
  renderWithIntl(<HrNotificationsScreen />, { locale: "en" });
  expect(screen.getByRole("link", { name: "Open record" })).toHaveAttribute(
    "href",
    "/hr/announcements/notice-1",
  );
  fireEvent.click(screen.getByRole("button", { name: "Mark read" }));
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(1));
  expect(state.mutation.mock.calls[0]).toEqual([
    "hr/notifications:markOne",
    expect.objectContaining({ notificationId: "notification-1" }),
  ]);
});
it("publication uses the newly saved version and an edited revision keeps its original link", async () => {
  const draft = {
    ...announcement(),
    status: "DRAFT",
    version: 3,
    replacesId: "previous-notice",
  };
  state.query.mockReturnValue(envelope(manage([draft])));
  state.mutation
    .mockResolvedValueOnce(
      envelope({ written: true, documentId: "notice-1", version: 4 }),
    )
    .mockResolvedValueOnce(
      envelope({ written: true, documentId: "notice-1", version: 5 }),
    );
  renderWithIntl(<HrAnnouncementManageScreen />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
  fireEvent.change(screen.getByLabelText("Message", { exact: false }), {
    target: { value: "Please read the updated instructions." },
  });
  expect(
    screen.getByRole("button", { name: "Publish saved draft" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Publish saved draft" }),
    ).toBeEnabled(),
  );
  expect(state.mutation.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({
      announcementId: "notice-1",
      replacesId: "previous-notice",
      expectedVersion: 3,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Publish saved draft" }));
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(2));
  expect(state.mutation.mock.calls[1]).toEqual([
    "hr/announcements:publish",
    expect.objectContaining({ announcementId: "notice-1", expectedVersion: 4 }),
  ]);
});

it("guards an in-flight publication but allows navigation after an uncertain result while preserving retry", async () => {
  state.query.mockReturnValue(
    envelope(manage([{ ...announcement(), status: "DRAFT", version: 3 }])),
  );
  let reject: ((reason: Error) => void) | undefined;
  state.mutation.mockReturnValueOnce(
    new Promise((_resolve, refuse) => {
      reject = refuse;
    }),
  );
  renderWithIntl(
    <DraftGuardProvider>
      <HrAnnouncementManageScreen />
    </DraftGuardProvider>,
    { locale: "en" },
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Publish saved draft" }));
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(1));
  const navigate = vi.fn();
  act(() => guardedNavigate(navigate));
  expect(navigate).not.toHaveBeenCalled();
  expect(await screen.findByTestId("navigation-guard-pending")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await act(async () => {
    reject?.(new Error("connection lost"));
  });
  await screen.findByTestId("hr-write-uncertain");
  expect(screen.getByLabelText("Title", { exact: false })).toBeDisabled();
  act(() => guardedNavigate(navigate));
  act(() => {
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  });
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("button", { name: "Try again safely" }),
  ).toBeEnabled();
});

it("schedules only saved content and sends Bangkok calendar inputs without browser conversion", async () => {
  state.query.mockReturnValue(
    envelope(manage([{ ...announcement(), status: "DRAFT", version: 3 }])),
  );
  renderWithIntl(<HrAnnouncementManageScreen />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
  fireEvent.change(screen.getByLabelText("Publish date (Asia/Bangkok)"), {
    target: { value: "2026-11-03" },
  });
  fireEvent.change(screen.getByLabelText("Publish time (Asia/Bangkok)"), {
    target: { value: "08:45" },
  });
  fireEvent.change(screen.getByLabelText("Message", { exact: false }), {
    target: { value: "Updated message" },
  });
  expect(
    screen.getByRole("button", { name: "Schedule saved draft" }),
  ).toBeDisabled();
  state.mutation.mockResolvedValueOnce(
    envelope({ written: true, documentId: "notice-1", version: 4 }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Schedule saved draft" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Schedule saved draft" }));
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(2));
  expect(state.mutation.mock.calls[1]).toEqual([
    "hr/announcements:schedule",
    expect.objectContaining({
      announcementId: "notice-1",
      expectedVersion: 4,
      publishDate: "2026-11-03",
      publishTime: "08:45",
    }),
  ]);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Schedule saved draft" }),
    ).not.toBeInTheDocument(),
  );
});
it("keeps a failed scheduled notice out of editing and receipts, with explicit return-to-draft recovery", async () => {
  state.query.mockReturnValue(
    envelope(
      manage([
        {
          ...announcement(),
          status: "SCHEDULED",
          version: 6,
          publishAt: Date.UTC(2026, 10, 3, 1, 45),
          scheduleError: "POLICY_NOT_ACTIVE",
          scheduleFailedAt: Date.UTC(2026, 10, 3, 1, 46),
        },
      ]),
    ),
  );
  renderWithIntl(<HrAnnouncementManageScreen />, { locale: "en" });
  expect(
    screen.getByText("Scheduled publication did not complete"),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Create revised draft" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Edit draft" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Recipient receipts" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Cancel schedule and return to draft" }),
  );
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(1));
  expect(state.mutation.mock.calls[0]).toEqual([
    "hr/announcements:cancelSchedule",
    expect.objectContaining({ announcementId: "notice-1", expectedVersion: 6 }),
  ]);
});
it("guards pending scheduling and retries the exact uncertain command before closing the editor", async () => {
  state.query.mockReturnValue(
    envelope(manage([{ ...announcement(), status: "DRAFT", version: 3 }])),
  );
  let reject: ((reason: Error) => void) | undefined;
  state.mutation
    .mockReturnValueOnce(
      new Promise((_resolve, refuse) => {
        reject = refuse;
      }),
    )
    .mockResolvedValueOnce(
      envelope({ written: true, documentId: "notice-1", version: 4 }),
    );
  renderWithIntl(
    <DraftGuardProvider>
      <HrAnnouncementManageScreen />
    </DraftGuardProvider>,
    { locale: "en" },
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit draft" }));
  fireEvent.change(screen.getByLabelText("Publish date (Asia/Bangkok)"), {
    target: { value: "2026-11-03" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Schedule saved draft" }));
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(1));
  const navigate = vi.fn();
  act(() => guardedNavigate(navigate));
  expect(navigate).not.toHaveBeenCalled();
  expect(await screen.findByTestId("navigation-guard-pending")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await act(async () => {
    reject?.(new Error("connection lost"));
  });
  await screen.findByTestId("hr-write-uncertain");
  expect(screen.getByLabelText("Publish date (Asia/Bangkok)")).toBeDisabled();
  act(() => guardedNavigate(navigate));
  act(() =>
    window.dispatchEvent(new PopStateEvent("popstate", { state: null })),
  );
  expect(navigate).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Try again safely" }));
  await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(2));
  expect(state.mutation.mock.calls[1]).toEqual(state.mutation.mock.calls[0]);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Schedule saved draft" }),
    ).not.toBeInTheDocument(),
  );
});
it("does not schedule a new or unsaved draft without an activated policy", () => {
  state.query.mockReturnValue(envelope(manage([], false)));
  renderWithIntl(<HrAnnouncementManageScreen />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: "New draft" }));
  fireEvent.change(screen.getByLabelText("Publish date (Asia/Bangkok)"), {
    target: { value: "2026-11-03" },
  });
  expect(
    screen.getByRole("button", { name: "Schedule saved draft" }),
  ).toBeDisabled();
  expect(state.mutation).not.toHaveBeenCalled();
});

it.each(["native", "explicit"] as const)(
  "%s close consumes announcement editing before the next Back restores the originating page",
  async (method) => {
    state.query.mockReturnValue(envelope(manage()));
    window.history.replaceState(
      { appNavigationIndex: 0 },
      "",
      "/th/hr/today?q=kept#origin",
    );
    const stop = trackAppHistory();
    try {
      window.history.pushState(
        {},
        "",
        "/en/hr/announcements/manage?kept=yes#list",
      );
      renderWithIntl(
        <DraftGuardProvider>
          <HrAnnouncementManageScreen />
        </DraftGuardProvider>,
        { locale: "en" },
      );
      fireEvent.click(screen.getByRole("button", { name: "New draft" }));
      expect(screen.getByLabelText(/Title/)).toBeInTheDocument();
      await act(async () => {
        if (method === "native") window.history.back();
        else
          fireEvent.click(
            screen.getByRole("button", { name: "Cancel editing" }),
          );
      });
      await waitFor(() => expect(screen.queryByLabelText(/Title/)).toBeNull());
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe("/en/hr/announcements/manage?kept=yes#list");
      await act(async () => {
        window.history.back();
      });
      await waitFor(() =>
        expect(
          window.location.pathname +
            window.location.search +
            window.location.hash,
        ).toBe("/th/hr/today?q=kept#origin"),
      );
    } finally {
      stop();
    }
  },
);

it("nested receipt Back retains the announcement draft, while editor Back still requires discard", async () => {
  state.query.mockImplementation((name: string) =>
    name === "hr/announcements:receipts"
      ? envelope({ ok: true, items: [], recipientCount: 0, nextCursor: null })
      : envelope(manage([announcement()])),
  );
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/hr/announcements/manage?kept=yes#list",
  );
  const stop = trackAppHistory();
  try {
    renderWithIntl(
      <DraftGuardProvider>
        <HrAnnouncementManageScreen />
      </DraftGuardProvider>,
      { locale: "en" },
    );
    fireEvent.click(screen.getByRole("button", { name: "New draft" }));
    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: "Unsent safety notice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Recipient receipts" }));
    expect(
      screen.getByRole("button", { name: "Close receipts" }),
    ).toBeInTheDocument();
    await act(async () => {
      window.history.back();
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Close receipts" }),
      ).toBeNull(),
    );
    expect(screen.getByLabelText(/Title/)).toHaveValue("Unsent safety notice");
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {
      window.history.back();
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Keep editing" }),
    );
    expect(screen.getByLabelText(/Title/)).toHaveValue("Unsent safety notice");
  } finally {
    stop();
  }
});
