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
import type { DayDetail } from "./DayDetailView";

const businessDate = "2026-10-13";
const at = (time: string) => Date.parse(`${businessDate}T${time}+07:00`);
const saved = { ok: true, value: { written: true, documentId: "day" } };

type Certification = {
  readonly disposition: NonNullable<DayDetail["certification"]>["disposition"];
  readonly startAt?: number;
  readonly endAt?: number;
};
function day(revision: number, certification?: Certification): DayDetail {
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
    originalEndAt: undefined,
    effectiveStartAt: certification?.startAt ?? at("08:30:20"),
    effectiveEndAt: certification?.endAt,
    workedMinutes: 0,
    outsideShiftMinutes: 0,
    locked: false,
    events: [],
    corrections: [],
    pendingCorrectionId: undefined,
    certification: certification
      ? {
          ...certification,
          startAt: certification.startAt,
          endAt: certification.endAt,
          current: true,
          reason: "Earlier decision",
          decidedAt: at("18:00:00"),
          decidedByName: "Other reviewer",
        }
      : undefined,
  };
}
const worked = (startAt: number, endAt: number): Certification => ({
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
    setSelf({ ...day(2), originalEndAt: at("17:40:00") });
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
    });
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

function pendingDay(revision = 2): DayDetail {
  return {
    ...day(revision),
    status: "EXCEPTION",
    disposition: null,
    pendingCorrectionId: "c1",
    corrections: [
      {
        id: "c1",
        status: "PENDING",
        version: 1,
        stale: false,
        proposedStartAt: at("08:30:20"),
        proposedEndAt: at("17:30:00"),
        reason: "Forgot clock-out",
        submittedAt: at("18:00:00"),
        submittedByName: "Worker",
        decidedAt: undefined,
        decidedByName: null,
        decisionReason: undefined,
        history: [],
      },
    ],
  };
}

describe("live eligibility changes retain HR drafts", () => {
  it.each(["reviewer", "employee"] as const)(
    "retains the %s reason and blocks new writes after a live period closure",
    async (actor) => {
      const detail = day(2, worked(at("08:30:20"), at("17:30:50")));
      const set = actor === "reviewer" ? setReview : setSelf;
      set(detail);
      const view = actor === "reviewer" ? mountReview() : mountDay();
      if (actor === "reviewer")
        fireEvent.click(screen.getByRole("button", { name: "Review again" }));
      fireEvent.change(reason(), {
        target: { value: "Keep this reason after closure" },
      });
      set({ ...detail, locked: true });
      view.rerender();
      expect(reason()).toHaveValue("Keep this reason after closure");
      const submit = screen.getByTestId(
        actor === "reviewer" ? "hr-dispose-submit" : "hr-correction-submit",
      );
      expect(submit).toBeDisabled();
      fireEvent.submit(submit.closest("form")!);
      expect(state.mutate).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
      const leave = vi.fn();
      act(() => guardedNavigate(leave));
      expect(
        screen.getByRole("dialog", { name: "Save changes before leaving?" }),
      ).toBeVisible();
      expect(leave).not.toHaveBeenCalled();
    },
  );

  it.each(["reviewer", "employee"] as const)(
    "retains the %s reason when another session creates a pending correction",
    async (actor) => {
      const set = actor === "reviewer" ? setReview : setSelf;
      set(day(1));
      const view = actor === "reviewer" ? mountReview() : mountDay();
      fireEvent.change(reason(), {
        target: { value: "Keep my unsent explanation" },
      });
      set(pendingDay());
      view.rerender();
      expect(reason()).toHaveValue("Keep my unsent explanation");
      expect(
        screen.getByTestId(
          actor === "reviewer" ? "hr-dispose-submit" : "hr-correction-submit",
        ),
      ).toBeDisabled();
      expect(
        screen.getByText(/pending request|waiting for review/i),
      ).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
      expect(screen.queryByRole("textbox")).toBeNull();
      if (actor === "reviewer")
        expect(screen.getByTestId("hr-certify")).toBeEnabled();
      const leave = vi.fn();
      act(() => guardedNavigate(leave));
      await waitFor(() => expect(leave).toHaveBeenCalledOnce());
    },
  );

  it("retains a return reason when another reviewer decides the pending correction", () => {
    setReview(pendingDay());
    const view = mountReview();
    fireEvent.click(screen.getByTestId("hr-return"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Keep return reason" },
    });
    setReview(day(3, worked(at("08:30:20"), at("17:30:00"))));
    view.rerender();
    expect(screen.getByRole("textbox")).toHaveValue("Keep return reason");
    expect(screen.getByTestId("hr-return-confirm")).toBeDisabled();
    fireEvent.click(screen.getByTestId("hr-return-confirm"));
    expect(state.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Review again" })).toBeVisible();
  });

  it("keeps a pending reviewer decision bound to its loaded version after another reviewer decides", async () => {
    setReview(pendingDay());
    const view = mountReview();
    fireEvent.click(screen.getByTestId("hr-return"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Original return command" },
    });
    let answer: (value: unknown) => void = () => {};
    state.mutate.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    fireEvent.click(screen.getByTestId("hr-return-confirm"));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
    setReview(day(3, worked(at("08:30:20"), at("17:30:00"))));
    view.rerender();
    expect(screen.getByRole("textbox")).toHaveValue("Original return command");
    expect(sent()).toMatchObject({
      correctionId: "c1",
      expectedVersion: 1,
      reason: "Original return command",
    });
    const leave = vi.fn();
    act(() => guardedNavigate(leave));
    await act(async () => {
      await Promise.resolve();
    });
    expect(leave).not.toHaveBeenCalled();
    await act(async () =>
      answer({
        ok: true,
        value: { written: false, error: { code: "DECISION_STALE" } },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("textbox")).toHaveValue("Original return command");
    expect(screen.getByTestId("hr-return-confirm")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    act(() => guardedNavigate(leave));
    await waitFor(() => expect(leave).toHaveBeenCalledOnce());
  });

  it("reconciles a changed pending correction version before sending the retained return reason", async () => {
    setReview(pendingDay());
    const view = mountReview();
    fireEvent.click(screen.getByTestId("hr-return"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Keep return reason" },
    });
    const next = pendingDay();
    setReview({
      ...next,
      corrections: next.corrections.map((c) => ({ ...c, version: 2 })),
    });
    view.rerender();
    expect(screen.getByRole("textbox")).toHaveValue("Keep return reason");
    expect(screen.getByTestId("hr-return-confirm")).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Use the current record" }),
    );
    state.mutate.mockResolvedValue(saved);
    fireEvent.click(screen.getByTestId("hr-return-confirm"));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
    expect(sent()).toMatchObject({
      correctionId: "c1",
      expectedVersion: 2,
      reason: "Keep return reason",
    });
  });

  it("updates pristine forms to the live locked and pending explanations", () => {
    setReview(day(1));
    const review = mountReview();
    setReview(pendingDay());
    review.rerender();
    expect(screen.queryByTestId("hr-dispose-submit")).toBeNull();
    expect(screen.getByTestId("hr-certify")).toBeEnabled();
    setReview({ ...pendingDay(), locked: true });
    review.rerender();
    expect(screen.queryByTestId("hr-certify")).toBeNull();
  });

  it("keeps a successful employee correction receipt after its live pending update", async () => {
    setSelf(day(1));
    const view = mountDay();
    fireEvent.change(screen.getByLabelText("Correct clock-out"), {
      target: { value: "17:30" },
    });
    fireEvent.change(reason(), { target: { value: "Forgot clock-out" } });
    let answer: (value: unknown) => void = () => {};
    state.mutate.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    fireEvent.click(screen.getByTestId("hr-correction-submit"));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
    setSelf(pendingDay());
    view.rerender();
    expect(reason()).toHaveValue("Forgot clock-out");
    await act(async () => answer(saved));
    expect(await screen.findByTestId("hr-correction-saved")).toBeVisible();
    expect(screen.queryByTestId("hr-correction-submit")).toBeNull();
    // A subsequent Return opens a new resubmission, rather than leaving the
    // employee stuck on the previous submission's terminal receipt.
    const returned = pendingDay(3);
    setSelf({
      ...returned,
      pendingCorrectionId: undefined,
      corrections: returned.corrections.map((c) => ({
        ...c,
        status: "RETURNED",
        version: 2,
      })),
    });
    view.rerender();
    expect(await screen.findByTestId("hr-correction-submit")).toBeEnabled();
    expect(reason()).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Correct clock-out"), {
      target: { value: "17:45" },
    });
    fireEvent.change(reason(), {
      target: { value: "Resubmitted after return" },
    });
    state.mutate.mockResolvedValue(saved);
    fireEvent.click(screen.getByTestId("hr-correction-submit"));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(2));
    expect(sent()).toMatchObject({
      correctionId: "c1",
      reason: "Resubmitted after return",
    });
  });
});

describe("re-review successful command completion", () => {
  it.each([false, true])(
    "closes re-review after a successful %s retry with a newer live revision",
    async (retry) => {
      setReview(day(2, worked(at("08:30:20"), at("17:30:50"))));
      const view = mountReview();
      fireEvent.click(screen.getByRole("button", { name: "Review again" }));
      fireEvent.change(reason(), { target: { value: "Own completed review" } });
      let answer: (value: unknown) => void = () => {};
      state.mutate.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      );
      fireEvent.click(screen.getByTestId("hr-dispose-submit"));
      await waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
      const request = sent()["requestId"];
      setReview(day(3, worked(at("08:30:20"), at("17:30:50"))));
      view.rerender();
      if (retry) {
        await act(async () => answer({}));
        expect(await screen.findByTestId("hr-write-uncertain")).toBeVisible();
        state.mutate.mockResolvedValue(saved);
        fireEvent.click(
          screen.getByRole("button", { name: "Try again safely" }),
        );
        await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(2));
        expect(sent()["requestId"]).toBe(request);
        expect(sent()).toMatchObject({ expectedRevision: 2 });
      } else {
        await act(async () => answer(saved));
      }
      expect(
        await screen.findByRole("button", { name: "Review again" }),
      ).toBeVisible();
      expect(screen.queryByRole("textbox")).toBeNull();
      const leave = vi.fn();
      act(() => guardedNavigate(leave));
      await waitFor(() => expect(leave).toHaveBeenCalledOnce());
    },
  );
});

describe("review decision receipts outlive their own live update", () => {
  // Convex publishes the decision's query transition before its mutation
  // resolves, so the form that sent it is gone when the answer arrives.
  async function decideWithLiveUpdate(
    choice: "certify" | "return",
    after: DayDetail,
  ) {
    setReview(pendingDay());
    const view = mountReview();
    let answer: (value: unknown) => void = () => {};
    state.mutate.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    if (choice === "return") {
      fireEvent.click(screen.getByTestId("hr-return"));
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "Please attach the register" },
      });
      fireEvent.click(screen.getByTestId("hr-return-confirm"));
    } else fireEvent.click(screen.getByTestId("hr-certify"));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
    setReview(after);
    view.rerender();
    await act(async () => answer(saved));
    return view;
  }
  const receipt = () => screen.getByTestId("hr-review-receipt");
  const returnedDay = (base: DayDetail): DayDetail => ({
    ...base,
    pendingCorrectionId: undefined,
    corrections: pendingDay().corrections.map((c) => ({
      ...c,
      status: "RETURNED",
      version: 2,
    })),
  });

  it("keeps the Return receipt over a complete day that now has nothing to decide", async () => {
    await decideWithLiveUpdate(
      "return",
      returnedDay({
        ...day(3),
        status: "READY",
        issue: undefined,
        originalEndAt: at("17:30:00"),
        effectiveEndAt: at("17:30:00"),
      }),
    );
    expect(receipt()).toHaveAttribute("role", "status");
    expect(receipt()).toHaveTextContent("Returned");
    expect(receipt()).toHaveTextContent(
      "The employee can correct the request and send it again.",
    );
    expect(screen.getByTestId("hr-review-nothing")).toBeVisible();
    expect(screen.queryByTestId("hr-return-confirm")).toBeNull();
    // Nothing is left to protect: leaving the page needs no confirmation.
    const leave = vi.fn();
    act(() => guardedNavigate(leave));
    await waitFor(() => expect(leave).toHaveBeenCalledOnce());
  });

  it("keeps the Return receipt above the missing clock-out disposition the day needs next", async () => {
    await decideWithLiveUpdate("return", returnedDay(day(3)));
    expect(receipt()).toHaveTextContent("Returned");
    expect(receipt()).toHaveTextContent(
      "The employee can correct the request and send it again.",
    );
    // The next step is still offered, after the confirmation.
    const disposition = screen.getByText("Account for this day");
    expect(
      receipt().compareDocumentPosition(disposition) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("hr-dispose-submit")).toBeEnabled();
  });

  it("keeps the Certify receipt after the certified day replaces the decision form", async () => {
    await decideWithLiveUpdate(
      "certify",
      day(3, worked(at("08:30:20"), at("17:30:00"))),
    );
    expect(receipt()).toHaveTextContent("Certified");
    expect(screen.queryByTestId("hr-certify")).toBeNull();
    expect(screen.getByRole("button", { name: "Review again" })).toBeVisible();
  });

  it("keeps the disposition receipt after its own live certification closes the form", async () => {
    setReview(day(1));
    const view = mountReview();
    fireEvent.change(reason(), { target: { value: "Paper register" } });
    let answer: (value: unknown) => void = () => {};
    state.mutate.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    fireEvent.click(screen.getByTestId("hr-dispose-submit"));
    await waitFor(() => expect(state.mutate).toHaveBeenCalledOnce());
    setReview(day(2, worked(at("08:30:20"), at("17:30:00"))));
    view.rerender();
    await act(async () => answer(saved));
    expect(receipt()).toHaveTextContent("Decision saved");
    expect(screen.queryByTestId("hr-dispose-submit")).toBeNull();
    expect(screen.getByRole("button", { name: "Review again" })).toBeVisible();
  });

  it("drops the Return receipt once the employee resubmits the request", async () => {
    const view = await decideWithLiveUpdate("return", returnedDay(day(3)));
    expect(receipt()).toHaveTextContent("Returned");
    const resubmitted = pendingDay(4);
    setReview({
      ...resubmitted,
      corrections: resubmitted.corrections.map((c) => ({ ...c, version: 3 })),
    });
    view.rerender();
    expect(screen.queryByTestId("hr-review-receipt")).toBeNull();
    expect(screen.getByTestId("hr-certify")).toBeEnabled();
  });
});

describe("returned request resubmission context", () => {
  function returnedSelfDay(): DayDetail {
    const base = pendingDay(3);
    return {
      ...base,
      pendingCorrectionId: undefined,
      corrections: base.corrections.map((c) => ({
        ...c,
        status: "RETURNED",
        version: 2,
        proposedStartAt: at("07:45:00"),
        decidedByName: "Line lead",
        decisionReason: "Attach the stock-count sheet",
        history: [
          {
            action: "SUBMITTED" as const,
            at: at("18:00:00"),
            actorName: "Worker",
            reason: "Forgot clock-out",
            proposedStartAt: undefined,
            proposedEndAt: undefined,
          },
          {
            action: "RETURNED" as const,
            at: at("19:00:00"),
            actorName: "Line lead",
            reason: "Attach the stock-count sheet",
            proposedStartAt: undefined,
            proposedEndAt: undefined,
          },
        ],
      })),
    };
  }

  it("shows the return reason and returned proposal before the resubmission fields without prefilling them", () => {
    setSelf(returnedSelfDay());
    mountDay();
    const form = screen
      .getByRole("heading", { name: "Resubmit the returned request" })
      .closest("form")!;
    const notice = screen.getByTestId("hr-correction-returned");
    expect(form).toContainElement(notice);
    expect(notice).toHaveTextContent("Returned for changes");
    expect(notice).toHaveTextContent("Attach the stock-count sheet");
    expect(notice).toHaveTextContent("Returned request: 07:45");
    const start = screen.getByLabelText("Correct clock-in");
    expect(
      notice.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The existing resubmission rule is unchanged: original times, new reason.
    expect(start).toHaveValue("08:30");
    expect(reason()).toHaveValue("");
  });

  it("falls back to the latest return in the request history for the reason", () => {
    const detail = returnedSelfDay();
    setSelf({
      ...detail,
      corrections: detail.corrections.map((c) => ({
        ...c,
        decisionReason: undefined,
      })),
    });
    mountDay();
    expect(screen.getByTestId("hr-correction-returned")).toHaveTextContent(
      "Attach the stock-count sheet",
    );
  });

  it("shows no return notice on a new correction request", () => {
    setSelf(day(1));
    mountDay();
    expect(screen.queryByTestId("hr-correction-returned")).toBeNull();
  });
});
