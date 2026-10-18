import { fireEvent, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  mutate: vi.fn(),
}));
vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) =>
      args === "skip" ? undefined : state.queries.get(name(reference)),
    useMutation: () => state.mutate,
  };
});
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: ["hr.self.access", "hr.team.review"],
    timezoneSupported: true,
    timezone: "Asia/Bangkok",
    today: "2026-10-14",
    identityKey: "sol-audit-org:sol-audit-user",
    sites: [],
  }),
  useHrCan: () => true,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: ComponentProps<"a">) => <a {...props} />,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { hrRefs } from "@/lib/convex/hrApi";
import { HrDayScreen } from "@/features/hr/DayScreen";
import { ReviewDetail } from "@/features/hr/ReviewDetail";

const businessDate = "2026-10-13";
const at = (time: string) => Date.parse(`${businessDate}T${time}+07:00`);
const detail = (revision: number) => ({
  employeeId: "e1",
  businessDate,
  revision,
  plan: {
    kind: "SCHEDULED",
    startAt: at("08:30:00"),
    endAt: at("17:30:00"),
    startTime: "08:30",
    endTime: "17:30",
    endsNextDay: false,
    breakMinutes: 60,
  },
  status: "EXCEPTION",
  issue: "MISSING_END",
  disposition: null,
  originalStartAt: at("08:30:20"),
  workedMinutes: 0,
  outsideShiftMinutes: 0,
  locked: false,
  events: [],
  corrections: [],
});
function setReview(revision: number, certified = false) {
  state.queries.set(getFunctionName(hrRefs.reviewDayDetail), {
    ok: true,
    value: {
      ok: true,
      timezone: "Asia/Bangkok",
      today: "2026-10-14",
      employee: {
        id: "e1",
        code: "EMP-001",
        displayName: "Worker",
        linked: true,
      },
      detail: {
        ...detail(revision),
        ...(certified
          ? {
              status: "READY",
              certification: {
                disposition: "WORKED",
                startAt: at("08:30:20"),
                endAt: at("17:30:50"),
                current: true,
                reason: "Original certified interval",
                decidedAt: at("18:00:00"),
                decidedByName: "Other reviewer",
              },
            }
          : {}),
      },
    },
  });
}
beforeEach(() => {
  state.queries.clear();
  state.mutate.mockReset();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/en/hr/review");
});

it("SOL-01 reproduces loss of an unsent re-review draft on a live day revision", () => {
  setReview(2, true);
  const page = () => (
    <DraftGuardProvider>
      <main>
        <ReviewDetail employeeId="e1" businessDate={businessDate} />
      </main>
    </DraftGuardProvider>
  );
  const view = renderWithIntl(page(), {
    locale: "en",
    preserveProviders: true,
  });
  fireEvent.click(screen.getByRole("button", { name: "Review again" }));
  fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), {
    target: { value: "Keep my unsent decision rationale" },
  });
  expect(screen.getByRole("textbox", { name: /Reason/ })).toHaveValue(
    "Keep my unsent decision rationale",
  );
  setReview(3, true);
  view.rerender(page());
  // Bug observation: the user draft disappears and the Review again gate is reset.
  expect(screen.queryByRole("textbox", { name: /Reason/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Review again" })).toBeVisible();
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("SOL-01 also reproduces loss of an employee correction draft on a live day revision", () => {
  state.queries.set(getFunctionName(hrRefs.selfDayDetail), {
    ok: true,
    value: {
      ok: true,
      timezone: "Asia/Bangkok",
      today: "2026-10-14",
      detail: detail(1),
    },
  });
  const page = () => (
    <DraftGuardProvider>
      <main>
        <HrDayScreen businessDate={businessDate} />
      </main>
    </DraftGuardProvider>
  );
  const view = renderWithIntl(page(), {
    locale: "en",
    preserveProviders: true,
  });
  fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), {
    target: { value: "Keep my correction explanation" },
  });
  state.queries.set(getFunctionName(hrRefs.selfDayDetail), {
    ok: true,
    value: {
      ok: true,
      timezone: "Asia/Bangkok",
      today: "2026-10-14",
      detail: {
        ...detail(2),
        status: "READY",
        disposition: "WORKED",
        certification: {
          disposition: "WORKED",
          startAt: at("08:30:20"),
          endAt: at("17:30:00"),
          current: true,
          reason: "Supervisor certified missing checkout",
          decidedAt: at("18:00:00"),
          decidedByName: "Supervisor",
        },
      },
    },
  });
  view.rerender(page());
  // The reason is reset by the revision-keyed CorrectionForm remount.
  expect(screen.getByRole("textbox", { name: /Reason/ })).toHaveValue("");
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("SOL-02 reproduces second truncation in an unchanged WORKED re-certification", async () => {
  setReview(2, true);
  state.mutate.mockResolvedValue({
    ok: true,
    value: { written: true, documentId: "day" },
  });
  renderWithIntl(<ReviewDetail employeeId="e1" businessDate={businessDate} />, {
    locale: "en",
  });
  fireEvent.click(screen.getByRole("button", { name: "Review again" }));
  fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), {
    target: { value: "Confirm existing interval with new rationale" },
  });
  fireEvent.click(screen.getByTestId("hr-dispose-submit"));
  await vi.waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
  expect(state.mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      start: { minute: 510, nextDay: false },
      end: { minute: 1050, nextDay: false },
    }),
  );
});
