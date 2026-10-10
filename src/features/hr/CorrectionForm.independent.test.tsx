import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const mocks = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("convex/react", () => ({ useMutation: () => mocks.submit }));

import { CorrectionForm } from "./CorrectionForm";
import type { DayDetail } from "./DayDetailView";

const detail: DayDetail = {
  employeeId: "employee-a",
  businessDate: "2026-10-08",
  revision: 1,
  plan: { kind: "NONWORKING", reason: "UNSCHEDULED" },
  status: "EXCEPTION",
  issue: "UNPLANNED_WORK",
  disposition: null,
  effectiveStartAt: undefined,
  effectiveEndAt: undefined,
  originalStartAt: undefined,
  originalEndAt: undefined,
  workedMinutes: 0,
  outsideShiftMinutes: 0,
  locked: false,
  events: [],
  certification: undefined,
  pendingCorrectionId: undefined,
  corrections: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});
afterEach(cleanup);

it("retries the original correction after a lost response even if the form receives edits", async () => {
  mocks.submit.mockRejectedValueOnce(
    new Error("Response lost after persistence"),
  );
  mocks.submit.mockResolvedValueOnce({
    ok: true,
    value: { written: true, documentId: "correction-a", replayed: true },
  });
  renderWithIntl(<CorrectionForm detail={detail} timezone="Asia/Bangkok" />, {
    locale: "en",
  });
  fireEvent.change(screen.getByLabelText("Correct clock-in"), {
    target: { value: "08:30" },
  });
  fireEvent.change(screen.getByLabelText("Correct clock-out"), {
    target: { value: "17:30" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: /^Reason/ }), {
    target: { value: "Forgot to clock out" },
  });
  fireEvent.click(screen.getByTestId("hr-correction-submit"));
  await screen.findByTestId("hr-write-uncertain");
  const original = mocks.submit.mock.calls[0]?.[0];

  // Locked fields or a pinned submitted payload both satisfy safe retry.
  // A programmatic change also guards against rebuilding the payload from
  // mutable component state when the response was lost.
  fireEvent.change(screen.getByLabelText("Correct clock-out"), {
    target: { value: "18:30" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: /^Reason/ }), {
    target: { value: "A different correction" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Try again safely" }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
  expect(mocks.submit.mock.calls[1]?.[0]).toEqual(original);
});
