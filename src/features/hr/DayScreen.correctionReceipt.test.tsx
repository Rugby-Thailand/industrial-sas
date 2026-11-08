import { act, fireEvent, screen, waitFor } from "@testing-library/react";
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
    permissions: ["hr.self.access"],
    timezoneSupported: true,
    timezone: "Asia/Bangkok",
    today: "2026-10-14",
    identityKey: "org-bh03t:user-bh03t",
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
import { HrDayScreen } from "./DayScreen";
import type { DayDetail } from "./DayDetailView";

const businessDate = "2026-10-13";
const at = (time: string) => Date.parse(`${businessDate}T${time}+07:00`);
const saved = { ok: true, value: { written: true, documentId: "c1" } };

function day(revision: number): DayDetail {
  return {
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
    originalEndAt: undefined,
    effectiveStartAt: at("08:30:20"),
    effectiveEndAt: undefined,
    workedMinutes: 0,
    outsideShiftMinutes: 0,
    locked: false,
    events: [],
    corrections: [],
    pendingCorrectionId: undefined,
    certification: undefined,
  } as DayDetail;
}
function correction(status: "PENDING" | "CERTIFIED") {
  return {
    id: "c1",
    status,
    version: status === "PENDING" ? 1 : 2,
    stale: status === "CERTIFIED",
    proposedStartAt: at("08:30:20"),
    proposedEndAt: at("17:30:00"),
    reason: "Forgot clock-out",
    submittedAt: at("18:00:00"),
    submittedByName: "Worker",
    decidedAt: status === "PENDING" ? undefined : at("19:00:00"),
    decidedByName: status === "PENDING" ? null : "Boss",
    decisionReason: status === "PENDING" ? undefined : undefined,
    history: [],
  };
}
function setSelf(detail: DayDetail) {
  state.queries.set(getFunctionName(hrRefs.selfDayDetail), {
    ok: true,
    value: { ok: true, timezone: "Asia/Bangkok", today: "2026-10-14", detail },
  });
}

beforeEach(() => {
  state.queries.clear();
  state.mutate.mockReset();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/en/hr/time/2026-10-13");
});

it.each([false, true])(
  "a certified correction releases its receipt for a fresh form with complete snapshot %s",
  async (completeSnapshot) => {
    setSelf(day(1));
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
    fireEvent.change(screen.getByLabelText("Correct clock-out"), {
      target: { value: "17:30" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), {
      target: { value: "Forgot clock-out" },
    });
    state.mutate.mockResolvedValue(saved);
    fireEvent.click(screen.getByTestId("hr-correction-submit"));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
    expect(await screen.findByTestId("hr-correction-saved")).toBeVisible();
    // Live update: the request is pending.
    setSelf({
      ...day(1),
      issue: "PENDING_CORRECTION",
      pendingCorrectionId: "c1",
      corrections: [correction("PENDING")],
    } as DayDetail);
    await act(async () => view.rerender(page()));
    // Reviewer certifies it: the day is correctable again (server only blocks a pending one).
    setSelf({
      ...day(2),
      ...(completeSnapshot
        ? {
            status: "READY",
            issue: undefined,
            disposition: "WORKED",
            effectiveStartAt: at("08:30:20"),
            effectiveEndAt: at("17:30:00"),
            workedMinutes: 479,
            certification: {
              disposition: "WORKED",
              startAt: at("08:30:20"),
              endAt: at("17:30:00"),
              reason: "Forgot clock-out",
              current: true,
              decidedAt: at("19:00:00"),
              decidedByName: "Boss",
            },
          }
        : {}),
      corrections: [correction("CERTIFIED")],
    } as DayDetail);
    await act(async () => view.rerender(page()));
    const submitButtons = screen.queryAllByTestId(
      "hr-correction-submit",
    ).length;
    const staleReceipts = screen.queryAllByTestId("hr-correction-saved").length;
    expect({ submitButtons, staleReceipts }).toEqual({
      submitButtons: 1,
      staleReceipts: 0,
    });
    expect(screen.getByTestId("hr-correction-submit")).toBeEnabled();
    expect(screen.getByRole("textbox", { name: /Reason/ })).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Correct clock-out"), {
      target: { value: "17:45" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), {
      target: { value: "Found the correct clock-out" },
    });
    fireEvent.click(screen.getByTestId("hr-correction-submit"));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(2));
    expect(state.mutate.mock.calls[1]![0].requestId).not.toBe(
      state.mutate.mock.calls[0]![0].requestId,
    );
  },
);
