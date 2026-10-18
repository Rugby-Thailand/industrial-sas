/**
 * Kiro HR UX-flow probes — rendered production components.
 *
 * Each `expected` test asserts the behaviour a user needs; a failure on the
 * current source is the evidence. `control` tests pass and isolate the cause.
 * Convex is replaced by a reactive in-memory store keyed by function name so a
 * mutation can publish the post-write query result before it resolves, as the
 * Convex client does (request_manager.removeCompleted resolves a successful
 * mutation only once a query transition at or after its timestamp arrives).
 *
 * Run: pnpm exec vitest run --config docs/reviews/ux-flow-kiro-2026-10-15/hr/probes/vitest.config.mts
 */
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  calls: [] as { name: string; args: unknown }[],
  mutations: new Map<string, (args: unknown) => Promise<unknown>>(),
  version: 0,
  listeners: new Set<() => void>(),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  };
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) => {
      useSyncExternalStore(
        subscribe,
        () => state.version,
        () => state.version,
      );
      if (args === "skip") return undefined;
      state.calls.push({ name: name(reference), args });
      return state.queries.get(name(reference));
    },
    useMutation: (reference: Parameters<typeof name>[0]) => (args: unknown) =>
      state.mutations.get(name(reference))?.(args) ??
      Promise.reject(new Error(`no mutation ${name(reference)}`)),
    useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
  };
});
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: ["hr.self.access", "hr.team.review"],
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    today: "2026-10-15",
    identityKey: "probe-org:probe-reviewer",
    sites: [],
  }),
  useHrCan: () => true,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: ComponentProps<"a">) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/hr/time",
}));

import { hrRefs } from "@/lib/convex/hrApi";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { HrHistoryScreen } from "@/features/hr/HistoryScreen";
import { ReviewDetail } from "@/features/hr/ReviewDetail";

const ZONE = "Asia/Bangkok";
const at = (date: string, hhmm: string) =>
  Date.parse(`${date}T${hhmm}:00+07:00`);
const ref = (reference: Parameters<typeof getFunctionName>[0]) =>
  getFunctionName(reference);

/** Publish a new live query result, like a Convex transition. */
function publish(name: string, value: unknown) {
  state.queries.set(name, value);
  state.version += 1;
  for (const listener of state.listeners) listener();
}

beforeEach(() => {
  state.queries.clear();
  state.calls.length = 0;
  state.mutations.clear();
  state.version = 0;
  state.listeners.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/en/hr/review");
});
afterEach(() => cleanup());

const plan = {
  kind: "SCHEDULED",
  startAt: at("2026-10-14", "08:30"),
  endAt: at("2026-10-14", "17:30"),
  startTime: "08:30",
  endTime: "17:30",
  endsNextDay: false,
  breakMinutes: 60,
};
const correction = (status: "PENDING" | "RETURNED", version: number) => ({
  id: "c1",
  status,
  proposedStartAt: at("2026-10-14", "08:00"),
  proposedEndAt: at("2026-10-14", "17:30"),
  reason: "I started early for the stock count",
  version,
  stale: false,
  submittedAt: at("2026-10-14", "18:00"),
  submittedByName: "Somchai",
  history: [],
});
/** One reviewed day; `endAt` undefined models a missing clock-out. */
function dayDetail(input: {
  readonly pending: boolean;
  readonly endAt: number | undefined;
}) {
  const complete = input.endAt !== undefined;
  return {
    ok: true,
    requestId: "q",
    value: {
      ok: true,
      timezone: ZONE,
      today: "2026-10-15",
      employee: {
        id: "e1",
        code: "EMP-001",
        displayName: "Somchai",
        linked: true,
        siteCode: "HQ",
        siteName: "Head office",
      },
      detail: {
        employeeId: "e1",
        businessDate: "2026-10-14",
        revision: input.pending ? 3 : 3,
        plan,
        // attendance.ts: a pending request turns the day into an EXCEPTION;
        // without it the day returns to its own status.
        status: input.pending ? "EXCEPTION" : complete ? "READY" : "EXCEPTION",
        ...(input.pending
          ? { issue: "PENDING_CORRECTION" }
          : complete
            ? {}
            : { issue: "MISSING_END" }),
        disposition: null,
        effectiveStartAt: at("2026-10-14", "08:29"),
        ...(complete ? { effectiveEndAt: input.endAt } : {}),
        workedMinutes: complete ? 481 : 0,
        outsideShiftMinutes: 0,
        originalStartAt: at("2026-10-14", "08:29"),
        ...(complete ? { originalEndAt: input.endAt } : {}),
        locked: false,
        events: [],
        ...(input.pending ? { pendingCorrectionId: "c1" } : {}),
        corrections: [
          correction(
            input.pending ? "PENDING" : "RETURNED",
            input.pending ? 1 : 2,
          ),
        ],
      },
    },
  };
}

async function returnCorrection(
  liveUpdate: boolean,
  endAt: number | undefined,
) {
  publish(ref(hrRefs.reviewDayDetail), dayDetail({ pending: true, endAt }));
  state.mutations.set(ref(hrRefs.decideCorrection), async () => {
    // Convex resolves a successful mutation only after the query transition
    // reflecting it; publish the returned day first.
    if (liveUpdate)
      publish(
        ref(hrRefs.reviewDayDetail),
        dayDetail({ pending: false, endAt }),
      );
    return {
      ok: true,
      requestId: "m",
      value: { written: true, documentId: "c1", replayed: false },
    };
  });
  renderWithIntl(<ReviewDetail employeeId="e1" businessDate="2026-10-14" />, {
    locale: "en",
  });
  fireEvent.click(screen.getByTestId("hr-return"));
  fireEvent.change(
    screen.getByRole("textbox", { name: /Reason for returning/ }),
    { target: { value: "Please attach the stock-count sheet" } },
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId("hr-return-confirm"));
  });
  await act(async () => {
    await Promise.resolve();
  });
  const statuses = screen
    .queryAllByRole("status")
    .map((element) => element.textContent ?? "");
  return {
    returnedAnnounced: statuses.some((text) => /\bReturned\b/.test(text)),
    statuses,
    nothingToDecide:
      screen.queryByText("Nothing on this day needs a decision.") !== null,
    accountForDay: screen.queryByText("Account for this day") !== null,
  };
}

describe("K-UX-HR-02 review decision feedback", () => {
  it("control: with a static query the reviewer sees 'Returned'", async () => {
    const seen = await returnCorrection(false, at("2026-10-14", "17:30"));
    expect(seen.returnedAnnounced).toBe(true);
  });

  it("expected: returning a request on a complete day confirms the return once live data updates", async () => {
    const seen = await returnCorrection(true, at("2026-10-14", "17:30"));
    // Observed facts recorded in the failure message.
    expect(
      seen.returnedAnnounced,
      JSON.stringify({ ...seen, note: "decision UI unmounted" }),
    ).toBe(true);
  });

  it("expected: returning a request for a missing clock-out confirms the return instead of only offering 'Account for this day'", async () => {
    const seen = await returnCorrection(true, undefined);
    expect(seen.returnedAnnounced, JSON.stringify(seen)).toBe(true);
  });
});

describe("K-UX-HR-03 History keeps the chosen month after Day → Back", () => {
  const history = () => ({
    ok: true,
    value: {
      ok: true,
      timezone: ZONE,
      today: "2026-10-15",
      rows: [],
    },
  });

  it("expected: the September view survives the remount caused by visiting a day and returning", () => {
    window.history.replaceState({}, "", "/en/hr/time");
    publish(ref(hrRefs.history), history());
    const first = renderWithIntl(<HrHistoryScreen />, { locale: "en" });
    fireEvent.change(screen.getByLabelText("Calendar month"), {
      target: { value: "2026-09" },
    });
    const chosen = state.calls
      .filter((call) => call.name === ref(hrRefs.history))
      .at(-1)?.args as { from: string; to: string };
    expect(chosen).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(window.location.search).toBe("");
    // next.config.ts has no `cacheComponents`, so App Router unmounts the
    // History route when the Day link is followed; Back mounts it again.
    first.unmount();
    renderWithIntl(<HrHistoryScreen />, { locale: "en" });
    const month = screen.getByLabelText("Calendar month") as HTMLInputElement;
    const after = state.calls
      .filter((call) => call.name === ref(hrRefs.history))
      .at(-1)?.args as { from: string; to: string };
    expect(
      month.value,
      JSON.stringify({ monthAfterBack: month.value, queryAfterBack: after }),
    ).toBe("2026-09");
  });
});
