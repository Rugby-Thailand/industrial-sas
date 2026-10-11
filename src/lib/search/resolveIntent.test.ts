/**
 * Local evaluation of the deterministic AI navigation pipeline.
 *
 * The model is MOCKED: every case uses the fixture's `ideal` (or, for
 * adversarial cases, a deliberately wrong) model answer. These results
 * prove grounding, permission and resolution rules only; they are not a
 * measurement of model accuracy. See `global-search-live-eval.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";

import {
  groundIntent,
  type ModelIntent,
} from "../../../convex/model/search/intent";
import {
  EVAL_CASES,
  EVAL_CONTEXTS,
  EVAL_TODAY,
  PERSONAS,
  contextFlags,
  evalLookups,
  type EvalCase,
} from "@tests/fixtures/global-search-eval";
import { HR_CODES, destinationHref } from "../navigation";
import {
  resolveIntent,
  type EmployeeHit,
  type IntentLookups,
  type IntentOutcome,
  type PageSearchContext,
} from "./resolveIntent";

async function run(test: EvalCase): Promise<IntentOutcome> {
  const context =
    test.context === undefined ? null : EVAL_CONTEXTS[test.context];
  const persona = PERSONAS[test.persona];
  return await resolveIntent({
    intent: groundIntent(test.ideal, {
      query: test.query,
      today: EVAL_TODAY,
      context: contextFlags(context),
    }),
    today: EVAL_TODAY,
    granted: persona.granted,
    ownCode: persona.ownCode,
    context,
    lookups: evalLookups(test.persona),
  });
}

describe("AI navigation evaluation set (mocked model, local pipeline)", () => {
  it("is representative: ≥ 60 cases across intents, personas and adversarial input", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(EVAL_CASES.map((test) => test.id)).size).toBe(
      EVAL_CASES.length,
    );
    expect(
      EVAL_CASES.filter((test) => test.adversarial).length,
    ).toBeGreaterThanOrEqual(8);
    expect(new Set(EVAL_CASES.map((test) => test.ideal.kind)).size).toBe(8);
    expect(new Set(EVAL_CASES.map((test) => test.persona)).size).toBe(4);
    expect(
      EVAL_CASES.some(
        (test) =>
          /[a-z]/i.test(test.query) && /[\u0E00-\u0E7F]/.test(test.query),
      ),
    ).toBe(true);
  });

  it.each(EVAL_CASES.map((test) => [test.id, test] as const))(
    "%s",
    async (_id, test) => {
      const outcome = await run(test);
      const expected = test.expect;
      expect(outcome.kind, JSON.stringify(outcome)).toBe(expected.kind);
      if (expected.kind === "NAVIGATE" && outcome.kind === "NAVIGATE") {
        expect(outcome.target).toEqual(expected.target);
        // Every automatic destination is an app-built, valid URL.
        expect(destinationHref(outcome.target)).toMatch(/^\/[a-z]/);
      }
      if (expected.kind === "CHOOSE" && outcome.kind === "CHOOSE")
        expect(outcome.reason).toBe(expected.reason);
      if (expected.kind === "CLARIFY" && outcome.kind === "CLARIFY")
        expect(outcome.need).toBe(expected.need);
      if (expected.kind === "UNSUPPORTED" && outcome.kind === "UNSUPPORTED")
        expect(outcome.topic).toBe(expected.topic);
    },
  );

  it("never navigates to a record the persona may not open", async () => {
    for (const test of EVAL_CASES) {
      const outcome = await run(test);
      if (outcome.kind !== "NAVIGATE") continue;
      const target = outcome.target;
      const granted = PERSONAS[test.persona].granted;
      if (target.key === "hr.reviewDay")
        expect(granted, test.id).toContain("hr.team.review");
      if (target.key === "hr.employeeEdit")
        expect(granted, test.id).toContain("hr.admin.manage");
      if (target.key === "hr.selfDay")
        expect(granted, test.id).toContain("hr.self.access");
    }
  });
});

describe("resolution rules", () => {
  const base = EVAL_CASES.find((test) => test.id === "review-code-date")!;

  it("does not auto-open when the protected search is incomplete", async () => {
    const lookups = evalLookups("SUPERVISOR");
    const outcome = await resolveIntent({
      intent: groundIntent(base.ideal, {
        query: base.query,
        today: EVAL_TODAY,
        context: contextFlags(null),
      }),
      today: EVAL_TODAY,
      granted: PERSONAS.SUPERVISOR.granted,
      ownCode: PERSONAS.SUPERVISOR.ownCode,
      context: null,
      lookups: {
        ...lookups,
        reviewEmployees: async (text) => ({
          ...(await lookups.reviewEmployees(text))!,
          complete: false,
        }),
      },
    });
    expect(outcome).toMatchObject({ kind: "CHOOSE", reason: "INCOMPLETE" });
  });

  it("reports an unavailable search instead of no match", async () => {
    const outcome = await resolveIntent({
      intent: groundIntent(base.ideal, {
        query: base.query,
        today: EVAL_TODAY,
        context: contextFlags(null),
      }),
      today: EVAL_TODAY,
      granted: PERSONAS.SUPERVISOR.granted,
      ownCode: PERSONAS.SUPERVISOR.ownCode,
      context: null,
      lookups: {
        ...evalLookups("SUPERVISOR"),
        reviewEmployees: async () => null,
      },
    });
    expect(outcome).toEqual({ kind: "UNAVAILABLE" });
  });

  it("re-checks a context record through the protected search", async () => {
    const test = EVAL_CASES.find((entry) => entry.id === "review-context")!;
    const reviewEmployees = vi.fn(evalLookups("SUPERVISOR").reviewEmployees);
    await resolveIntent({
      intent: groundIntent(test.ideal, {
        query: test.query,
        today: EVAL_TODAY,
        context: contextFlags(EVAL_CONTEXTS.reviewE3),
      }),
      today: EVAL_TODAY,
      granted: PERSONAS.SUPERVISOR.granted,
      ownCode: PERSONAS.SUPERVISOR.ownCode,
      context: EVAL_CONTEXTS.reviewE3,
      lookups: { ...evalLookups("SUPERVISOR"), reviewEmployees },
    });
    // Exact code only, and the answer must be the selected record's ID.
    expect(reviewEmployees).toHaveBeenCalledWith("EMP-DEMO-003", [
      "EMP-DEMO-003",
    ]);
  });
});

/**
 * Consequence regressions from the independent root resolver/context
 * spikes: real grounding + resolver, synthetic pre-scoped lookups. Expected
 * outcomes are the frozen safe consequences, not this implementation.
 */
describe("safe consequences (root spike cases)", () => {
  const TODAY = "2026-10-09";
  const ALL = Object.values(HR_CODES);
  const empty: ModelIntent = {
    kind: "TEAM_DAY_REVIEW",
    page: null,
    settingsSection: null,
    employeeFocus: null,
    employeeCode: null,
    employeeName: null,
    dateText: null,
    useContextEmployee: false,
    useContextDate: false,
    useContextPeriod: false,
    clarify: null,
    unsupportedTopic: null,
  };
  const selected: PageSearchContext = {
    page: "hr.review",
    employee: {
      id: "selected-employee",
      code: "EMP-SELECTED-001",
      name: "Different Person",
    },
    date: "2026-10-07",
  };
  const hit = (code: string, match = "CODE"): EmployeeHit => ({
    id:
      code === "EMP-EVAL-001"
        ? "explicit-employee"
        : code === "EMP-SELECTED-001"
          ? "selected-employee"
          : `id-${code}`,
    code,
    name: "Somchai",
    siteCode: "EVAL",
    active: true,
    match,
  });
  const lookups = (): IntentLookups => ({
    reviewEmployees: vi.fn(
      async (_text: string, codes?: readonly string[]) => ({
        items:
          codes === undefined
            ? [hit("EMP-EVAL-001", "NAME")]
            : codes.map((code) => hit(code)),
        complete: true,
      }),
    ),
    adminEmployees: vi.fn(async (_text: string, codes?: readonly string[]) => ({
      items: (codes ?? []).map((code) => hit(code)),
      complete: true,
    })),
    periodsByRange: vi.fn(async (from: string, to: string) => ({
      items: [
        {
          id: "explicit-period",
          siteCode: "EVAL",
          siteName: "Synthetic",
          startDate: from,
          endDate: to,
          status: "CLOSED" as const,
          latestClosedVersion: 4,
        },
      ],
      complete: true,
    })),
  });
  const resolve = async (
    query: string,
    model: Partial<ModelIntent>,
    context: PageSearchContext | null = null,
    lookup = lookups(),
  ) =>
    await resolveIntent({
      intent: groundIntent(
        { ...empty, ...model },
        { query, today: TODAY, context: contextFlags(context) },
      ),
      today: TODAY,
      granted: ALL,
      ownCode: "EMP-SELF-001",
      context,
      lookups: lookup,
    });

  it.each([null, selected])(
    "never treats a rejected other employee as the actor's own day (context %#)",
    async (context) => {
      const lookup = lookups();
      const outcome = await resolve(
        "แก้เวลา EMP-EVAL-001 วันที่ 8 ต.ค. 2569",
        {
          kind: "SELF_DAY_CORRECTION",
          employeeCode: "EMP-EVAL-999",
          useContextEmployee: true,
        },
        context,
        lookup,
      );
      expect(outcome).toMatchObject({
        kind: "CLARIFY",
        need: "EMPLOYEE_UNCONFIRMED",
      });
      // Not the own day, and not the selected person either.
      expect(JSON.stringify(outcome)).not.toContain("hr.selfDay");
      expect(JSON.stringify(outcome)).not.toContain("selected-employee");
      expect(lookup.reviewEmployees).not.toHaveBeenCalled();
    },
  );

  it("never opens the own day when the model drops an explicit other code", async () => {
    const outcome = await resolve("แก้เวลา EMP-EVAL-001 วันที่ 8 ต.ค. 2569", {
      kind: "SELF_DAY_CORRECTION",
    });
    expect(outcome).toMatchObject({
      kind: "CLARIFY",
      need: "EMPLOYEE_UNCONFIRMED",
    });
  });

  it("reviews the explicit employee when the model reads it as a self correction", async () => {
    expect(
      await resolve("แก้เวลา EMP-EVAL-001 วันที่ 8 ต.ค. 2569", {
        kind: "SELF_DAY_CORRECTION",
        employeeCode: "EMP-EVAL-001",
      }),
    ).toEqual({
      kind: "NAVIGATE",
      target: {
        key: "hr.reviewDay",
        employeeId: "explicit-employee",
        date: "2026-10-08",
        focus: "decision",
      },
    });
  });

  it("lets an explicit name beat an unreferenced selected employee and day", async () => {
    const outcome = await resolve(
      "แก้เวลาสมชาย",
      {
        employeeName: "สมชาย",
        useContextEmployee: true,
        useContextDate: true,
      },
      selected,
    );
    expect(outcome.kind).not.toBe("NAVIGATE");
    expect(JSON.stringify(outcome)).not.toContain("selected-employee");
    expect(JSON.stringify(outcome)).not.toContain("2026-10-07");
  });

  it("uses the selected record only when the query refers to it", async () => {
    expect(
      await resolve(
        "ตรวจรายการนี้",
        { useContextEmployee: true, useContextDate: true },
        selected,
      ),
    ).toMatchObject({
      kind: "NAVIGATE",
      target: { employeeId: "selected-employee", date: "2026-10-07" },
    });
    // The lookup must return the selected record itself, not a namesake.
    const swapped: IntentLookups = {
      ...lookups(),
      reviewEmployees: async () => ({
        items: [{ ...hit("EMP-SELECTED-001"), id: "someone-else" }],
        complete: true,
      }),
    };
    expect(
      (
        await resolve(
          "ตรวจรายการนี้",
          { useContextEmployee: true, useContextDate: true },
          selected,
          swapped,
        )
      ).kind,
    ).not.toBe("NAVIGATE");
  });

  it("lets an explicit range beat the selected period", async () => {
    const outcome = await resolve(
      "ส่งออกงวด 19–25 กันยายน 2569",
      { kind: "PERIOD_EXPORT", useContextPeriod: true },
      {
        page: "hr.period",
        period: {
          id: "selected-period",
          siteCode: "EVAL",
          startDate: "2026-10-01",
          endDate: "2026-10-07",
          version: 2,
        },
      },
    );
    expect(outcome).toMatchObject({
      kind: "NAVIGATE",
      target: { periodId: "explicit-period" },
    });
  });

  it("opens an explicit historical version, never the latest", async () => {
    expect(
      await resolve("ส่งออกงวด 19–25 กันยายน 2569 ฉบับ 1", {
        kind: "PERIOD_EXPORT",
      }),
    ).toEqual({
      kind: "NAVIGATE",
      target: {
        key: "hr.period",
        periodId: "explicit-period",
        version: 1,
        focus: "export",
      },
    });
  });

  it.each(["v-1", "version zero", "ฉบับ abc", "v1/2", "v0", "v1 v2"])(
    "refuses a malformed version (%s) instead of the latest",
    async (text) => {
      const outcome = await resolve(`ส่งออกงวด 19–25 กันยายน 2569 ${text}`, {
        kind: "PERIOD_EXPORT",
      });
      expect(outcome).toMatchObject({
        kind: "CLARIFY",
        need: "VERSION_INVALID",
      });
    },
  );

  it("reports a version that does not exist as unavailable, never the latest", async () => {
    const outcome = await resolve("ส่งออกงวด 19–25 กันยายน 2569 v9", {
      kind: "PERIOD_EXPORT",
    });
    expect(outcome).toMatchObject({
      kind: "CLARIFY",
      need: "VERSION_UNAVAILABLE",
    });
    // The same for "this period, version 9" on a period page.
    expect(
      await resolve(
        "ส่งออกงวดนี้ ฉบับ 9",
        { kind: "PERIOD_EXPORT", useContextPeriod: true },
        {
          page: "hr.period",
          period: {
            id: "selected-period",
            siteCode: "EVAL",
            startDate: "2026-10-01",
            endDate: "2026-10-07",
            version: 2,
            latestClosedVersion: 3,
          },
        },
      ),
    ).toMatchObject({ kind: "CLARIFY", need: "VERSION_UNAVAILABLE" });
  });

  it("asks about a future day before recommending any person found by name", async () => {
    const lookup = lookups();
    const outcome = await resolve(
      "ตรวจเวลา สมชาย วันที่ 10 ต.ค. 2569",
      { employeeName: "สมชาย" },
      null,
      lookup,
    );
    expect(outcome).toEqual({
      kind: "CLARIFY",
      need: "FUTURE_DATE",
      suggestions: [],
    });
    expect(lookup.reviewEmployees).not.toHaveBeenCalled();
  });

  it("does not open just the model-preferred one of several written codes", async () => {
    const outcome = await resolve(
      "ตรวจเวลา EMP-EVAL-001 และ EMP-EVAL-002 วันที่ 8 ต.ค. 2569",
      { employeeCode: "EMP-EVAL-001" },
    );
    expect(outcome).toMatchObject({ kind: "CHOOSE", reason: "AMBIGUOUS" });
  });

  it("does not take only the date fragment of a conflicting weekday and date", async () => {
    const outcome = await resolve(
      "ตรวจเวลา EMP-EVAL-001 วันจันทร์ 8 ต.ค. 2569",
      { employeeCode: "EMP-EVAL-001", dateText: "8 ต.ค. 2569" },
    );
    expect(outcome.kind).not.toBe("NAVIGATE");
  });

  it("treats an ISO date as a date, not a second employee code", async () => {
    expect(
      await resolve("review EMP-EVAL-001 attendance for 2026-10-08", {
        employeeCode: "EMP-EVAL-001",
      }),
    ).toMatchObject({
      kind: "NAVIGATE",
      target: { employeeId: "explicit-employee", date: "2026-10-08" },
    });
  });

  it("resolves alphabetic, short numeric and one-character codes exactly", async () => {
    for (const [query, code] of [
      ["ตรวจเวลา NIGHT วันที่ 8 ต.ค. 2569", "NIGHT"],
      ["ตรวจเวลา 12 วันที่ 8 ต.ค. 2569", "12"],
      ["ตรวจเวลา A วันที่ 8 ต.ค. 2569", "A"],
    ] as const) {
      const lookup = lookups();
      expect(
        await resolve(query, { employeeCode: code }, null, lookup),
        query,
      ).toMatchObject({
        kind: "NAVIGATE",
        target: { employeeId: `id-${code}`, date: "2026-10-08" },
      });
      // Looked up as an exact code, never as name text.
      expect(lookup.reviewEmployees).toHaveBeenCalledWith(code, [code]);
    }
  });

  it("supports an explicit ISO range for a period", async () => {
    expect(
      await resolve("export attendance period 2026-09-19 to 2026-09-25", {
        kind: "PERIOD_EXPORT",
      }),
    ).toMatchObject({
      kind: "NAVIGATE",
      target: { periodId: "explicit-period", version: 4 },
    });
  });
});
