import { act, fireEvent, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import {
  useSyncExternalStore,
  type ComponentProps,
  type MouseEvent,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { chooseOption } from "@tests/fixtures/select-control";

/**
 * K-UX-HR-03: History period/status and Requests status/page survive the
 * real route change to a day or request and the browser Back that returns.
 * The previous route unmounts (no cacheComponents), so only URL state and
 * the entry's history metadata can bring the earlier view back.
 */

const state = vi.hoisted(() => ({
  query: vi.fn(),
}));
vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) =>
      args === "skip" ? undefined : state.query(name(reference), args),
    useMutation: () => vi.fn(),
  };
});
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: ["hr.self.access"],
    timezoneSupported: true,
    timezone: "Asia/Bangkok",
    today: "2026-10-15",
    identityKey: "list-org:list-user",
    sites: [],
  }),
  useHrCan: () => true,
}));
const subscribe = (listener: () => void) => {
  window.addEventListener("app-query-state", listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener("app-query-state", listener);
    window.removeEventListener("popstate", listener);
  };
};
vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams(
      useSyncExternalStore(subscribe, () => window.location.search),
    ),
}));
vi.mock("@/i18n/navigation", () => {
  const locale = () => window.location.pathname.split("/")[1] ?? "en";
  function navigate(href: string, mode: "pushState" | "replaceState") {
    window.history[mode]({}, "", `/${locale()}${href}`);
    window.dispatchEvent(new Event("app-query-state"));
  }
  const router = {
    push: (href: string) => navigate(href, "pushState"),
    replace: (href: string) => navigate(href, "replaceState"),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
  };
  return {
    // A soft navigation like next-intl's Link: a new entry, same locale.
    Link: ({ href, onClick, ...props }: ComponentProps<"a">) => (
      <a
        {...props}
        href={href}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          onClick?.(event);
          event.preventDefault();
          navigate(String(href), "pushState");
        }}
      />
    ),
    useRouter: () => router,
  };
});

import { hrRefs } from "@/lib/convex/hrApi";
import { HrHistoryScreen } from "./HistoryScreen";
import { HrRequestsScreen } from "./RequestsScreen";

const envelope = (value: unknown) => ({ ok: true, value });
const at = (date: string, hhmm: string) =>
  Date.parse(`${date}T${hhmm}:00+07:00`);
const historyRow = (businessDate: string, status: string) => ({
  businessDate,
  plan: {
    kind: "SCHEDULED",
    startAt: at(businessDate, "08:30"),
    endAt: at(businessDate, "17:30"),
    startTime: "08:30",
    endTime: "17:30",
    endsNextDay: false,
    breakMinutes: 60,
  },
  status,
  ...(status === "EXCEPTION" ? { issue: "MISSING_END" } : {}),
  disposition: null,
  originalStartAt: at(businessDate, "08:30"),
  effectiveStartAt: at(businessDate, "08:30"),
  ...(status === "EXCEPTION"
    ? {}
    : {
        originalEndAt: at(businessDate, "17:30"),
        effectiveEndAt: at(businessDate, "17:30"),
      }),
  workedMinutes: status === "EXCEPTION" ? 0 : 480,
  outsideShiftMinutes: 0,
});

/** The App Router stand-in: each pathname renders (and remounts) its route. */
function App({ list }: { readonly list: () => React.ReactNode }) {
  const path = useSyncExternalStore(subscribe, () => window.location.pathname);
  return /^\/(en|th)\/hr\/(time|requests)$/.test(path) ? (
    <main key="list">{list()}</main>
  ) : (
    <main key={path}>
      <p>Detail {path}</p>
    </main>
  );
}

const lastArgs = (name: string) =>
  state.query.mock.calls.filter(([called]) => called === name).at(-1)?.[1] as
    Record<string, unknown> | undefined;

async function nativeBack() {
  await act(async () => {
    const pop = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.back();
    await pop;
  });
}
async function nativeForward() {
  await act(async () => {
    const pop = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.forward();
    await pop;
  });
}

beforeEach(() => {
  state.query.mockReset();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/en/hr/today");
});
afterEach(() => {
  window.history.replaceState({}, "", "/en/hr/today");
});

describe("History keeps its period and status filter across a day visit", () => {
  const historyName = getFunctionName(hrRefs.history);
  beforeEach(() => {
    state.query.mockImplementation((name: string, args: { from?: string }) =>
      name === historyName
        ? envelope({
            ok: true,
            timezone: "Asia/Bangkok",
            today: "2026-10-15",
            rows: args.from?.startsWith("2026-09")
              ? [
                  historyRow("2026-09-10", "EXCEPTION"),
                  historyRow("2026-09-11", "READY"),
                ]
              : [historyRow("2026-10-14", "READY")],
          })
        : undefined,
    );
  });

  it.each([
    ["en", "Calendar month", "Needs review"],
    ["th", "เดือนตามปฏิทิน", "ต้องตรวจสอบ"],
  ] as const)(
    "History month and status -> Day -> native Back restores the %s view, and Forward returns to the day",
    async (locale, monthLabel, needsReview) => {
      window.history.pushState({}, "", `/${locale}/hr/time?view=1#days`);
      renderWithIntl(<App list={() => <HrHistoryScreen />} />, {
        locale,
        workspace: false,
      });
      expect(lastArgs(historyName)).toMatchObject({
        from: "2026-10-01",
        to: "2026-10-15",
      });
      fireEvent.change(screen.getByLabelText(monthLabel), {
        target: { value: "2026-09" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: new RegExp(needsReview) }),
      );
      // The earlier view is in the URL, with unrelated query and hash kept.
      const params = new URLSearchParams(window.location.search);
      expect(Object.fromEntries(params)).toEqual({
        view: "1",
        from: "2026-09-01",
        to: "2026-09-30",
        status: "EXCEPTION",
      });
      expect(window.location.hash).toBe("#days");
      const listUrl =
        window.location.pathname +
        window.location.search +
        window.location.hash;
      // Only the needing-review September day is listed; open it.
      const links = screen
        .getAllByRole("link")
        .filter((link) => link.getAttribute("href")?.endsWith("/2026-09-10"));
      expect(
        screen
          .queryAllByRole("link")
          .some((link) => link.getAttribute("href")?.endsWith("/2026-09-11")),
      ).toBe(false);
      expect(links.length).toBeGreaterThan(0);
      fireEvent.click(links[0]!);
      expect(window.location.pathname).toBe(`/${locale}/hr/time/2026-09-10`);
      expect(screen.queryByLabelText(monthLabel)).toBeNull();

      await nativeBack();
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe(listUrl);
      expect(screen.getByLabelText(monthLabel)).toHaveValue("2026-09");
      expect(lastArgs(historyName)).toMatchObject({
        from: "2026-09-01",
        to: "2026-09-30",
      });
      expect(
        screen.getByRole("button", { name: new RegExp(needsReview) }),
      ).toHaveAttribute("aria-pressed", "true");

      await nativeForward();
      expect(window.location.pathname).toBe(`/${locale}/hr/time/2026-09-10`);
    },
  );

  it("retains a cleared History date while editing without replacing the other bound", () => {
    window.history.pushState({}, "", "/en/hr/time?source=audit#days");
    renderWithIntl(<App list={() => <HrHistoryScreen />} />, {
      locale: "en",
      workspace: false,
    });
    fireEvent.change(screen.getByLabelText("Calendar month"), {
      target: { value: "2026-09" },
    });
    const from = screen.getByLabelText("From");
    const to = screen.getByLabelText("To");
    expect(to).toHaveValue("2026-09-30");
    const monthSearch = window.location.search;
    fireEvent.change(from, { target: { value: "" } });
    expect(from).toHaveValue("");
    expect(to).toHaveValue("2026-09-30");
    // The incomplete bound stays local: the URL and query keep September.
    expect(window.location.search).toBe(monthSearch);
    expect(lastArgs(historyName)).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    fireEvent.change(from, { target: { value: "2026-09-05" } });
    expect(lastArgs(historyName)).toMatchObject({
      from: "2026-09-05",
      to: "2026-09-30",
    });
    expect(
      Object.fromEntries(new URLSearchParams(window.location.search)),
    ).toEqual({ source: "audit", from: "2026-09-05", to: "2026-09-30" });
    expect(window.location.hash).toBe("#days");
  });

  it.each([
    ["en", "Calendar month", "From", "To"],
    ["th", "เดือนตามปฏิทิน", "ตั้งแต่", "ถึง"],
  ] as const)(
    "%s History keeps a cleared To bound local; a month pick, native Back and remount restore the URL range",
    async (locale, monthLabel, fromLabel, toLabel) => {
      window.history.pushState({}, "", `/${locale}/hr/time?source=audit#days`);
      const view = renderWithIntl(<App list={() => <HrHistoryScreen />} />, {
        locale,
        workspace: false,
      });
      fireEvent.change(screen.getByLabelText(monthLabel), {
        target: { value: "2026-09" },
      });
      const monthSearch = window.location.search;
      fireEvent.change(screen.getByLabelText(toLabel), {
        target: { value: "" },
      });
      expect(screen.getByLabelText(toLabel)).toHaveValue("");
      expect(screen.getByLabelText(fromLabel)).toHaveValue("2026-09-01");
      expect(screen.getByLabelText(monthLabel)).toHaveValue("");
      expect(window.location.search).toBe(monthSearch);
      expect(lastArgs(historyName)).toMatchObject({
        from: "2026-09-01",
        to: "2026-09-30",
      });

      // Picking the month the URL already holds still restores both fields.
      fireEvent.change(screen.getByLabelText(monthLabel), {
        target: { value: "2026-09" },
      });
      expect(screen.getByLabelText(toLabel)).toHaveValue("2026-09-30");
      expect(window.location.search).toBe(monthSearch);

      // A complete To becomes its own entry with From and the query kept.
      fireEvent.change(screen.getByLabelText(toLabel), {
        target: { value: "2026-09-20" },
      });
      expect(
        Object.fromEntries(new URLSearchParams(window.location.search)),
      ).toEqual({ source: "audit", from: "2026-09-01", to: "2026-09-20" });
      expect(window.location.hash).toBe("#days");
      const editedSearch = window.location.search;

      // An unfinished edit on that entry is dropped by Back, not carried over.
      fireEvent.change(screen.getByLabelText(fromLabel), {
        target: { value: "" },
      });
      expect(screen.getByLabelText(fromLabel)).toHaveValue("");
      await nativeBack();
      expect(window.location.search).toBe(monthSearch);
      expect(screen.getByLabelText(fromLabel)).toHaveValue("2026-09-01");
      expect(screen.getByLabelText(toLabel)).toHaveValue("2026-09-30");
      expect(screen.getByLabelText(monthLabel)).toHaveValue("2026-09");
      await nativeForward();
      expect(window.location.search).toBe(editedSearch);
      expect(screen.getByLabelText(fromLabel)).toHaveValue("2026-09-01");
      expect(screen.getByLabelText(toLabel)).toHaveValue("2026-09-20");

      // A remount (refresh) reads only the URL's complete range.
      fireEvent.change(screen.getByLabelText(toLabel), {
        target: { value: "" },
      });
      view.unmount();
      renderWithIntl(<App list={() => <HrHistoryScreen />} />, {
        locale,
        workspace: false,
      });
      expect(screen.getByLabelText(fromLabel)).toHaveValue("2026-09-01");
      expect(screen.getByLabelText(toLabel)).toHaveValue("2026-09-20");
      expect(lastArgs(historyName)).toMatchObject({
        from: "2026-09-01",
        to: "2026-09-20",
      });
    },
  );

  it("a direct History link opens its period and filter; a malformed range falls back to the current month", () => {
    window.history.pushState(
      {},
      "",
      "/en/hr/time?from=2026-09-01&to=2026-09-30&status=EXCEPTION",
    );
    const view = renderWithIntl(<App list={() => <HrHistoryScreen />} />, {
      locale: "en",
      workspace: false,
    });
    expect(screen.getByLabelText("Calendar month")).toHaveValue("2026-09");
    expect(
      screen.getByRole("button", { name: /Needs review/ }),
    ).toHaveAttribute("aria-pressed", "true");
    view.unmount();
    window.history.pushState({}, "", "/en/hr/time?from=bad&to=2026-09-30");
    renderWithIntl(<App list={() => <HrHistoryScreen />} />, {
      locale: "en",
      workspace: false,
    });
    expect(screen.getByLabelText("Calendar month")).toHaveValue("2026-10");
    expect(lastArgs(historyName)).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-15",
    });
  });
});

describe("Requests keep their status and page across a request visit", () => {
  const requestsName = getFunctionName(hrRefs.requests);
  beforeEach(() => {
    state.query.mockImplementation(
      (name: string, args: { cursor?: string; status?: string }) =>
        name === requestsName
          ? envelope({
              ok: true,
              items: [
                {
                  id: args.cursor ? "older-request" : "newer-request",
                  businessDate: args.cursor ? "2026-08-03" : "2026-10-13",
                  status: args.status ?? "PENDING",
                  reason: args.cursor ? "Older reason" : "Newer reason",
                },
              ],
              isDone: args.cursor !== undefined,
              ...(args.cursor ? {} : { continueCursor: "page-2" }),
            })
          : undefined,
    );
  });

  it("Requests status and older page -> request -> native Back restores the same page", async () => {
    window.history.pushState({}, "", "/en/hr/requests#mine");
    renderWithIntl(<App list={() => <HrRequestsScreen />} />, {
      locale: "en",
      workspace: false,
    });
    chooseOption("Status", "Returned");
    expect(new URLSearchParams(window.location.search).get("status")).toBe(
      "RETURNED",
    );
    fireEvent.click(screen.getByRole("button", { name: "Older page" }));
    expect(screen.getByText("Page 2")).toBeVisible();
    expect(lastArgs(requestsName)).toMatchObject({
      status: "RETURNED",
      cursor: "page-2",
    });
    const listUrl =
      window.location.pathname + window.location.search + window.location.hash;
    fireEvent.click(screen.getByRole("link", { name: /Older reason/ }));
    expect(window.location.pathname).toBe("/en/hr/requests/older-request");

    await nativeBack();
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe(listUrl);
    expect(screen.getByText("Page 2")).toBeVisible();
    expect(screen.getByText("Older reason")).toBeVisible();
    expect(lastArgs(requestsName)).toMatchObject({
      status: "RETURNED",
      cursor: "page-2",
    });
    expect(screen.getByLabelText("Status")).toHaveTextContent("Returned");
  });
});
