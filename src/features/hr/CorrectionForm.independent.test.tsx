import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const mocks = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("convex/react", () => ({ useMutation: () => mocks.submit }));

import { CorrectionForm } from "./CorrectionForm";
import type { DayDetail } from "./DayDetailView";
import { api } from "../../../convex/_generated/api";
import { storedPlan } from "../../../convex/hr/shared";
import { fromLocal } from "../../../convex/model/hr/calendar";
import { planFor } from "../../../convex/model/hr/schedule";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "@tests/fixtures/convex-tenant-world";

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

it.each([
  {
    side: "Correct clock-out",
    value: "18:00",
    expectedStart: 510 * 60_000 + 45_123,
    expectedEnd: 1080 * 60_000,
  },
  {
    side: "Correct clock-in",
    value: "09:00",
    expectedStart: 540 * 60_000,
    expectedEnd: 1050 * 60_000 + 20_456,
  },
])(
  "preserves the untouched original instant when editing $side through the registered correction handler",
  async ({ side, value, expectedStart, expectedEnd }) => {
    vi.stubGlobal("crypto", webcrypto);
    vi.useFakeTimers({ toFake: ["Date"] });
    const date = "2026-10-05";
    const midnight = fromLocal(date, 0, 420);
    vi.setSystemTime(fromLocal("2026-10-07", 600, 420));
    const w = await createConvexTenantWorld({
      "../convex/hr/self.ts": () => import("../../../convex/hr/self"),
    });
    await seedConvexAuthorization(w, { roleA: "HR_EMPLOYEE" });
    const employeeId = await w.t.run(async (ctx) => {
      const id = await ctx.db.insert("hrEmployees", {
        orgId: w.orgA,
        warehouseId: w.warehouses.alphaA,
        code: "SECONDS",
        displayName: "Worker",
        userId: w.userA,
        employmentStartDate: "2026-01-01",
        status: "ACTIVE",
        version: 1,
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: w.userA,
        updatedByUserId: w.userA,
      });
      await ctx.db.insert("hrAttendanceDays", {
        orgId: w.orgA,
        warehouseId: w.warehouses.alphaA,
        employeeId: id,
        businessDate: date,
        plan: storedPlan(
          planFor({
            date,
            schedule: undefined,
            offsetMinutes: 420,
            holidayName: undefined,
          }),
        ),
        clockInAt: midnight + 510 * 60_000 + 45_123,
        clockOutAt: midnight + 1050 * 60_000 + 20_456,
        open: false,
        revision: 2,
        createdAt: 1,
        updatedAt: 1,
      });
      return id;
    });
    mocks.submit.mockImplementation((args) =>
      w.t
        .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
        .mutation(api.hr.self.submitCorrection, args),
    );
    try {
      renderWithIntl(
        <CorrectionForm
          detail={{
            ...detail,
            employeeId,
            businessDate: date,
            originalStartAt: midnight + 510 * 60_000 + 45_123,
            originalEndAt: midnight + 1050 * 60_000 + 20_456,
          }}
          timezone="Asia/Bangkok"
        />,
        { locale: "en" },
      );
      fireEvent.change(screen.getByLabelText(side), { target: { value } });
      fireEvent.change(screen.getByRole("textbox", { name: /^Reason/ }), {
        target: { value: "Correct the recorded time" },
      });
      fireEvent.click(screen.getByTestId("hr-correction-submit"));
      await screen.findByTestId("hr-correction-saved");
      const [request] = await w.t.run((ctx) =>
        ctx.db.query("hrCorrectionRequests").collect(),
      );
      expect(request?.proposedStartAt).toBe(midnight + expectedStart);
      expect(request?.proposedEndAt).toBe(midnight + expectedEnd);
      const [day] = await w.t.run((ctx) =>
        ctx.db.query("hrAttendanceDays").collect(),
      );
      expect(day?.clockInAt).toBe(midnight + 510 * 60_000 + 45_123);
      expect(day?.clockOutAt).toBe(midnight + 1050 * 60_000 + 20_456);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  },
);

it("treats an explicitly edited time returned to the displayed minute as an intentional minute-precision edit", async () => {
  mocks.submit.mockResolvedValue({
    ok: true,
    value: { written: true, documentId: "correction-explicit" },
  });
  renderWithIntl(
    <CorrectionForm
      detail={{
        ...detail,
        originalStartAt: fromLocal(detail.businessDate, 510, 420) + 45_000,
        originalEndAt: fromLocal(detail.businessDate, 1050, 420) + 20_000,
      }}
      timezone="Asia/Bangkok"
    />,
    { locale: "en" },
  );
  fireEvent.change(screen.getByLabelText("Correct clock-in"), {
    target: { value: "08:31" },
  });
  fireEvent.change(screen.getByLabelText("Correct clock-in"), {
    target: { value: "08:30" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: /^Reason/ }), {
    target: { value: "Correct clock-in to the exact minute" },
  });
  fireEvent.click(screen.getByTestId("hr-correction-submit"));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
  expect(mocks.submit.mock.calls[0]?.[0]).toMatchObject({
    start: { minute: 510, nextDay: false },
  });
  expect(mocks.submit.mock.calls[0]?.[0]).not.toHaveProperty("end");
});
