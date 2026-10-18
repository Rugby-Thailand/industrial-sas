/**
 * Kiro HR UX-flow probe — resubmitting a returned correction (rendered DayScreen).
 *
 * Asserts what the employee needs to fix a returned request: the reviewer's
 * reason ahead of (or inside) the resubmission form, and the earlier proposal
 * as its starting point. A failure on current source is the evidence.
 *
 * Run: pnpm exec vitest run --config docs/reviews/ux-flow-kiro-2026-10-15/hr/probes/vitest.config.mts hr-resubmit
 */
import { cleanup, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ queries: new Map<string, unknown>() }));
vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) =>
      args === "skip" ? undefined : state.queries.get(name(reference)),
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
    identityKey: "probe-org:probe-employee",
    sites: [],
  }),
  useHrCan: () => true,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: ComponentProps<"a">) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/hr/time/2026-10-14",
}));

import { hrRefs } from "@/lib/convex/hrApi";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { HrDayScreen } from "@/features/hr/DayScreen";

const at = (date: string, hhmm: string) =>
  Date.parse(`${date}T${hhmm}:00+07:00`);
const RETURN_REASON = "Attach the stock-count sheet and confirm 07:45";

beforeEach(() => {
  state.queries.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/en/hr/time/2026-10-14");
  state.queries.set(getFunctionName(hrRefs.selfDayDetail), {
    ok: true,
    value: {
      ok: true,
      timezone: "Asia/Bangkok",
      today: "2026-10-15",
      detail: {
        employeeId: "e1",
        businessDate: "2026-10-14",
        revision: 3,
        plan: {
          kind: "SCHEDULED",
          startAt: at("2026-10-14", "08:30"),
          endAt: at("2026-10-14", "17:30"),
          startTime: "08:30",
          endTime: "17:30",
          endsNextDay: false,
          breakMinutes: 60,
        },
        status: "READY",
        disposition: null,
        effectiveStartAt: at("2026-10-14", "08:29"),
        effectiveEndAt: at("2026-10-14", "17:31"),
        workedMinutes: 482,
        outsideShiftMinutes: 0,
        originalStartAt: at("2026-10-14", "08:29"),
        originalEndAt: at("2026-10-14", "17:31"),
        locked: false,
        events: [],
        corrections: [
          {
            id: "c1",
            status: "RETURNED",
            proposedStartAt: at("2026-10-14", "07:45"),
            proposedEndAt: at("2026-10-14", "17:31"),
            reason: "Started early for the stock count",
            version: 2,
            stale: false,
            submittedAt: at("2026-10-14", "18:00"),
            submittedByName: "Somchai",
            history: [
              {
                action: "SUBMITTED",
                at: at("2026-10-14", "18:00"),
                actorName: "Somchai",
                reason: "Started early for the stock count",
              },
              {
                action: "RETURNED",
                at: at("2026-10-15", "08:10"),
                actorName: "Line lead",
                reason: RETURN_REASON,
              },
            ],
          },
        ],
      },
    },
  });
});
afterEach(() => cleanup());

it("K-UX-HR-04 expected: the resubmission form shows why it was returned before the employee edits it", () => {
  renderWithIntl(<HrDayScreen businessDate="2026-10-14" />, {
    locale: "en",
    workspace: false,
  });
  const form = screen
    .getByRole("heading", { name: "Resubmit the returned request" })
    .closest("form")!;
  const reason = screen.getByText(RETURN_REASON);
  const reasonBeforeOrInsideForm =
    form.contains(reason) ||
    Boolean(
      reason.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  const start =
    form.querySelectorAll<HTMLInputElement>('input[type="time"]')[0]!;
  expect(
    reasonBeforeOrInsideForm,
    JSON.stringify({
      returnReasonPosition: "after the form, in the Requests log",
      formStartValue: start.value,
    }),
  ).toBe(true);
});

it("K-UX-HR-04 expected: the resubmission starts from the returned proposal, not the original punch", () => {
  renderWithIntl(<HrDayScreen businessDate="2026-10-14" />, {
    locale: "en",
    workspace: false,
  });
  const form = screen
    .getByRole("heading", { name: "Resubmit the returned request" })
    .closest("form")!;
  const start =
    form.querySelectorAll<HTMLInputElement>('input[type="time"]')[0]!;
  const reason = form.querySelector("textarea")!;
  expect(
    start.value,
    JSON.stringify({ formStart: start.value, formReason: reason.value }),
  ).toBe("07:45");
});
