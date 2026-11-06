import { expect, it } from "vitest";

import { buildPeriodRows, periodFingerprintText } from "./period";

it("a period review detects a changed OFF roster revision before freezing its provenance", () => {
  const rows = (revision: number) =>
    buildPeriodRows({
      startDate: "2026-10-19",
      endDate: "2026-10-19",
      employees: [
        {
          id: "employee-1",
          code: "E001",
          name: "Employee",
          employment: { startDate: "2026-01-01" },
        },
      ],
      offsetMinutes: 420,
      now: Date.UTC(2026, 9, 20, 3),
      holidayName: () => undefined,
      recorded: () => undefined,
      pending: () => false,
      assignment: () => ({ kind: "OFF", revision }),
    });

  const reviewed = rows(1);
  // Another admin clears and reassigns OFF. The result is still a ready rest
  // day, but closing freezes a different cell revision than the reviewer saw.
  const reassigned = rows(3);
  expect(reviewed[0]?.status).toBe("READY");
  expect(reassigned[0]?.status).toBe("READY");
  expect(reviewed[0]?.plan.roster?.revision).toBe(1);
  expect(reassigned[0]?.plan.roster?.revision).toBe(3);
  expect(periodFingerprintText(reassigned)).not.toBe(
    periodFingerprintText(reviewed),
  );
});
