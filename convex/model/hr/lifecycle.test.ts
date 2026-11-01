import { describe, expect, it } from "vitest";

import {
  employmentState,
  planLifecycleTransition,
  separationPreserved,
  type LifecycleSubject,
} from "./lifecycle";

const TODAY = "2026-10-20";
const base: LifecycleSubject = {
  status: "ACTIVE",
  employmentStartDate: "2026-01-05",
};
const separated: LifecycleSubject = {
  ...base,
  status: "INACTIVE",
  separation: {
    type: "TERMINATION",
    lastWorkingDate: "2026-10-01",
    reason: "Ended",
  },
};

describe("employmentState", () => {
  it("derives the state from stored fields, legacy records included", () => {
    expect(employmentState(base)).toBe("ACTIVE");
    expect(employmentState({ ...base, status: "INACTIVE" })).toBe("INACTIVE");
    expect(employmentState({ ...base, probationEndDate: "2026-05-04" })).toBe(
      "PROBATION",
    );
    expect(
      employmentState({
        ...base,
        probationEndDate: "2026-05-04",
        probationConfirmedDate: "2026-05-04",
      }),
    ).toBe("ACTIVE");
    expect(employmentState(separated)).toBe("TERMINATED");
    expect(
      employmentState({
        ...separated,
        separation: { ...separated.separation!, type: "RESIGNATION" },
      }),
    ).toBe("RESIGNED");
  });
});

describe("planLifecycleTransition", () => {
  it("confirms probation on or before today, never in the future or before start", () => {
    const probation = { ...base, probationEndDate: "2026-05-04" };
    const confirm = (effectiveDate: string) =>
      planLifecycleTransition(
        probation,
        { kind: "CONFIRM_PROBATION", effectiveDate },
        TODAY,
      );
    expect(confirm(TODAY)).toEqual({
      ok: true,
      value: {
        patch: { probationConfirmedDate: TODAY },
        event: {
          type: "PROBATION_CONFIRMED",
          effectiveDate: TODAY,
          fromState: "PROBATION",
          toState: "ACTIVE",
        },
      },
    });
    expect(confirm("2026-10-21")).toMatchObject({
      ok: false,
      error: { code: "LIFECYCLE_DATE_FUTURE" },
    });
    expect(confirm("2026-01-04")).toMatchObject({
      error: { code: "LIFECYCLE_DATE_BEFORE_START" },
    });
    expect(
      planLifecycleTransition(
        base,
        { kind: "CONFIRM_PROBATION", effectiveDate: TODAY },
        TODAY,
      ),
    ).toMatchObject({ error: { code: "LIFECYCLE_NOT_ON_PROBATION" } });
  });

  it("offboards only with a past last working day and a reason", () => {
    const offboard = (lastWorkingDate: string, reason = "Resigned") =>
      planLifecycleTransition(
        base,
        {
          kind: "OFFBOARD",
          separationType: "RESIGNATION",
          lastWorkingDate,
          reason,
        },
        TODAY,
      );
    // Boundaries: yesterday is allowed; today and later would deactivate a
    // person on a day they still work.
    expect(offboard("2026-10-19")).toMatchObject({
      ok: true,
      value: {
        patch: {
          status: "INACTIVE",
          employmentEndDate: "2026-10-19",
          separation: { type: "RESIGNATION", lastWorkingDate: "2026-10-19" },
        },
        event: { type: "RESIGNED", fromState: "ACTIVE", toState: "RESIGNED" },
      },
    });
    expect(offboard(TODAY)).toMatchObject({
      error: { code: "LIFECYCLE_LAST_DAY_NOT_PAST" },
    });
    expect(offboard("2026-01-05")).toMatchObject({ ok: true });
    expect(offboard("2026-01-04")).toMatchObject({
      error: { code: "LIFECYCLE_DATE_BEFORE_START" },
    });
    expect(offboard("2026-10-19", "  ")).toMatchObject({
      error: { code: "LIFECYCLE_REASON_REQUIRED", field: "reason" },
    });
    expect(
      planLifecycleTransition(
        separated,
        {
          kind: "OFFBOARD",
          separationType: "RESIGNATION",
          lastWorkingDate: "2026-10-02",
          reason: "Again",
        },
        TODAY,
      ),
    ).toMatchObject({ error: { code: "LIFECYCLE_ALREADY_SEPARATED" } });
  });

  it("reinstates after the last working day, on or before today", () => {
    const reinstate = (effectiveDate: string, subject = separated) =>
      planLifecycleTransition(
        subject,
        { kind: "REINSTATE", effectiveDate, reason: "Rehired" },
        TODAY,
      );
    expect(reinstate("2026-10-02")).toMatchObject({
      ok: true,
      value: {
        patch: { status: "ACTIVE", employmentEndDate: null, separation: null },
        event: { fromState: "TERMINATED", toState: "ACTIVE" },
      },
    });
    expect(reinstate("2026-10-01")).toMatchObject({
      error: { code: "LIFECYCLE_REINSTATE_BEFORE_EXIT" },
    });
    expect(reinstate("2026-10-21")).toMatchObject({
      error: { code: "LIFECYCLE_DATE_FUTURE" },
    });
    expect(reinstate(TODAY, base)).toMatchObject({
      error: { code: "LIFECYCLE_NOT_SEPARATED" },
    });
  });
});

it("a general save keeps an offboarded record inactive with its last day", () => {
  expect(separationPreserved(base, { status: "INACTIVE" })).toBe(true);
  expect(
    separationPreserved(separated, {
      status: "INACTIVE",
      employmentEndDate: "2026-10-01",
    }),
  ).toBe(true);
  expect(
    separationPreserved(separated, {
      status: "ACTIVE",
      employmentEndDate: "2026-10-01",
    }),
  ).toBe(false);
  expect(separationPreserved(separated, { status: "INACTIVE" })).toBe(false);
});
