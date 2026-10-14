import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { chooseOption } from "@tests/fixtures/select-control";

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
    identityKey: "org-live:user-live",
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
import { guardedNavigate } from "@/lib/navigationGuard";
import { hrRefs } from "@/lib/convex/hrApi";
import { HrDayScreen } from "./DayScreen";
import { ReviewDetail } from "./ReviewDetail";

const businessDate = "2026-10-13";
const at = (time: string) => Date.parse(`${businessDate}T${time}+07:00`);
const saved = { ok: true, value: { written: true, documentId: "day" } };

type Certification = {
  readonly disposition: string;
  readonly startAt?: number;
  readonly endAt?: number;
};
function day(revision: number, certification?: Certification) {
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
    status: certification ? "READY" : "EXCEPTION",
    issue: certification ? undefined : "MISSING_END",
    disposition: certification?.disposition ?? null,
    originalStartAt: at("08:30:20"),
    workedMinutes: 0,
    outsideShiftMinutes: 0,
    locked: false,
    events: [],
    corrections: [],
    ...(certification
      ? {
          certification: {
            ...certification,
            current: true,
            reason: "Earlier decision",
            decidedAt: at("18:00:00"),
            decidedByName: "Other reviewer",
          },
        }
      : {}),
  };
}
const worked = (startAt: number, endAt: number) => ({
  disposition: "WORKED",
  startAt,
  endAt,
});
function setReview(detail: ReturnType<typeof day>) {
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
      detail,
    },
  });
}
function setSelf(detail: ReturnType<typeof day>) {
  state.queries.set(getFunctionName(hrRefs.selfDayDetail), {
    ok: true,
    value: { ok: true, timezone: "Asia/Bangkok", today: "2026-10-14", detail },
  });
}
function mountReview() {
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
  return { rerender: () => view.rerender(page()) };
}
function mountDay() {
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
  return { rerender: () => view.rerender(page()) };
}
const reason = () => screen.getByRole("textbox", { name: /Reason/ });
const sent = () =>
  state.mutate.mock.calls.at(-1)?.[0] as Record<string, unknown>;
const changedNotice = () =>
  screen.queryByText("This day changed after you started");

beforeEach(() => {
  state.queries.clear();
  state.mutate.mockReset();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/en/hr/review");
});

describe("live attendance updates keep unsent HR drafts", () => {
  it("keeps a re-review reason over a newer revision and sends only after the reviewer uses it", async () => {
    setReview(day(2, worked(at("08:30:20"), at("17:30:50"))));
    const view = mountReview();
    fireEvent.click(screen.getByRole("button", { name: "Review again" }));
    fireEvent.change(reason(), {
      target: { value: "Keep my unsent decision rationale" },
    });
    // Another reviewer re-certifies with a different clock-out.
    setReview(day(3, worked(at("08:30:20"), at("18:00:10"))));
    view.rerender();
    expect(reason()).toHaveValue("Keep my unsent decision rationale");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(changedNotice()).toBeVisible();
    expect(screen.getByTestId("hr-dispose-changed")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(screen.getByLabelText("Clock-out")).toHaveValue("17:30");
    expect(screen.getByTestId("hr-dispose-submit")).toBeDisabled();
    fireEvent.submit(screen.getByTestId("hr-dispose-submit").closest("form")!);
    expect(state.mutate).not.toHaveBeenCalled();
    // The draft is still protected from leaving the page.
    const leave = vi.fn();
    act(() => guardedNavigate(leave));
    expect(leave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    state.mutate.mockResolvedValue(saved);
    fireEvent.click(
      screen.getByRole("button", { name: "Use the current record" }),
    );
    expect(changedNotice()).toBeNull();
    expect(reason()).toHaveValue("Keep my unsent decision rationale");
    expect(screen.getByLabelText("Clock-out")).toHaveValue("18:00");
    fireEvent.click(screen.getByTestId("hr-dispose-submit"));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
    expect(sent()).toMatchObject({
      expectedRevision: 3,
      disposition: "WORKED",
      retainCertified: { start: true, end: true },
      reason: "Keep my unsent decision rationale",
    });
    expect(sent()).not.toHaveProperty("start");
    expect(sent()).not.toHaveProperty("end");
  });

  it("sends a stale dirty decision against its loaded revision when the update arrives in flight", async () => {
    setReview(day(2, worked(at("08:30:20"), at("17:30:50"))));
    const view = mountReview();
    fireEvent.click(screen.getByRole("button", { name: "Review again" }));
    fireEvent.change(reason(), { target: { value: "Sent before the update" } });
    let answer: (value: unknown) => void = () => {};
    state.mutate.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    fireEvent.click(screen.getByTestId("hr-dispose-submit"));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
    setReview(day(3, worked(at("08:30:20"), at("18:00:10"))));
    view.rerender();
    expect(sent()).toMatchObject({ expectedRevision: 2 });
    await act(async () =>
      answer({
        ok: true,
        value: { written: false, error: { code: "DECISION_STALE" } },
      }),
    );
    // The refused draft stays; the reviewer must explicitly use revision 3.
    expect(reason()).toHaveValue("Sent before the update");
    expect(changedNotice()).toBeVisible();
    expect(screen.getByTestId("hr-dispose-submit")).toBeDisabled();
  });

  it("keeps an exception disposition draft when another reviewer certifies the day", () => {
    setReview(day(1));
    const view = mountReview();
    fireEvent.change(reason(), { target: { value: "Paper register" } });
    setReview(day(2, worked(at("08:30:20"), at("17:30:00"))));
    view.rerender();
    expect(
      screen.queryByRole("button", { name: "Review again" }),
    ).not.toBeInTheDocument();
    expect(reason()).toHaveValue("Paper register");
    expect(changedNotice()).toBeVisible();
  });

  it("refreshes clean review forms from the live day", async () => {
    setReview(day(1));
    const view = mountReview();
    // A clean exception form gives way to the certified state.
    setReview(day(2, worked(at("08:30:20"), at("17:30:00"))));
    view.rerender();
    expect(screen.queryByTestId("hr-dispose-submit")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review again" }));
    // An opened, untouched re-review follows the next certification.
    setReview(day(3, worked(at("08:30:20"), at("18:15:00"))));
    view.rerender();
    expect(changedNotice()).toBeNull();
    expect(screen.getByLabelText("Clock-out")).toHaveValue("18:15");
    state.mutate.mockResolvedValue(saved);
    fireEvent.change(reason(), { target: { value: "Clean refresh" } });
    fireEvent.click(screen.getByTestId("hr-dispose-submit"));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
    expect(sent()).toMatchObject({ expectedRevision: 3 });
    // The reviewer's own successful decision closes the form again.
    expect(
      await screen.findByRole("button", { name: "Review again" }),
    ).toBeVisible();
  });

  it("keeps an employee correction reason over a supervisor certification until the employee uses it", async () => {
    setSelf(day(1));
    const view = mountDay();
    fireEvent.change(reason(), {
      target: { value: "Keep my correction explanation" },
    });
    fireEvent.change(screen.getByLabelText("Correct clock-out"), {
      target: { value: "17:45" },
    });
    setSelf(day(2, worked(at("08:30:20"), at("17:30:00"))));
    view.rerender();
    expect(reason()).toHaveValue("Keep my correction explanation");
    expect(screen.getByLabelText("Correct clock-out")).toHaveValue("17:45");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(changedNotice()).toBeVisible();
    expect(screen.getByTestId("hr-correction-submit")).toBeDisabled();
    state.mutate.mockResolvedValue(saved);
    fireEvent.click(
      screen.getByRole("button", { name: "Use the current record" }),
    );
    fireEvent.click(screen.getByTestId("hr-correction-submit"));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
    expect(sent()).toMatchObject({
      reason: "Keep my correction explanation",
      end: { minute: 1065, nextDay: false },
    });
  });

  it("refreshes a clean employee correction form without a notice", () => {
    setSelf(day(1));
    const view = mountDay();
    setSelf({ ...day(2), originalEndAt: at("17:40:00") } as never);
    view.rerender();
    expect(changedNotice()).toBeNull();
    expect(screen.getByLabelText("Correct clock-out")).toHaveValue("17:40");
    expect(screen.getByTestId("hr-correction-submit")).toBeEnabled();
  });
});

describe("re-review keeps exact untouched attendance instants", () => {
  // Certified with seconds; the inputs only show minutes.
  const certified = worked(at("08:30:50"), at("17:30:00"));

  it("retains both certified sides when only the reason changes", async () => {
    setReview(day(2, certified));
    mountReview();
    fireEvent.click(screen.getByRole("button", { name: "Review again" }));
    expect(screen.getByLabelText("Clock-in")).toHaveValue("08:30");
    fireEvent.change(reason(), { target: { value: "Same times, new note" } });
    state.mutate.mockResolvedValue(saved);
    fireEvent.click(screen.getByTestId("hr-dispose-submit"));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
    expect(sent()).toMatchObject({
      expectedRevision: 2,
      retainCertified: { start: true, end: true },
    });
    expect(sent()).not.toHaveProperty("start");
    expect(sent()).not.toHaveProperty("end");
  });

  it("serializes only an edited side and retains the other", async () => {
    setReview(day(2, certified));
    mountReview();
    fireEvent.click(screen.getByRole("button", { name: "Review again" }));
    fireEvent.change(screen.getByLabelText("Clock-out"), {
      target: { value: "17:45" },
    });
    fireEvent.change(reason(), { target: { value: "Later clock-out" } });
    state.mutate.mockResolvedValue(saved);
    fireEvent.click(screen.getByTestId("hr-dispose-submit"));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
    expect(sent()).toMatchObject({
      end: { minute: 1065, nextDay: false },
      retainCertified: { start: true, end: false },
    });
    expect(sent()).not.toHaveProperty("start");
  });

  it("keeps original clock events when the certification has no times", async () => {
    // A leave certification: the form starts from the originals.
    setReview({
      ...day(2, { disposition: "LEAVE" }),
      originalEndAt: at("17:30:40"),
    } as never);
    mountReview();
    fireEvent.click(screen.getByRole("button", { name: "Review again" }));
    fireEvent.change(reason(), { target: { value: "Actually worked" } });
    state.mutate.mockResolvedValue(saved);
    // Choose Worked with untouched original times.
    chooseOption("Disposition", "Worked");
    fireEvent.click(screen.getByTestId("hr-dispose-submit"));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
    expect(sent()).toMatchObject({ disposition: "WORKED" });
    expect(sent()).not.toHaveProperty("start");
    expect(sent()).not.toHaveProperty("end");
    expect(sent()).not.toHaveProperty("retainCertified");
  });
});
