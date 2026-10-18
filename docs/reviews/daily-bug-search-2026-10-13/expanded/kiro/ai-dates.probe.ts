/**
 * Kiro diagnostic probe (AI Search grounding). Asserts the EXPECTED reading;
 * a failure on current source is evidence of the defect.
 *
 * Run: pnpm exec vitest run --config docs/reviews/daily-bug-search-2026-10-13/expanded/kiro/vitest.config.mts ai-dates
 */
import { expect, it, vi } from "vitest";

import { readDates } from "../../../../../convex/model/search/dates";
import {
  groundIntent,
  NO_CONTEXT,
  parseModelIntent,
} from "../../../../../convex/model/search/intent";
import { resolveIntent } from "../../../../../src/lib/search/resolveIntent";
import { HR_CODES } from "../../../../../src/lib/navigation";

const TODAY = "2026-10-13";

it("KIRO-09 a year-less range containing today resolves to the current year", async () => {
  const query = "ส่งออกงวด 1-15 ต.ค.";
  const reading = readDates(query, TODAY);
  const model = parseModelIntent({
    kind: "PERIOD_EXPORT",
    page: null,
    settingsSection: null,
    employeeFocus: null,
    employeeCode: null,
    employeeName: null,
    dateText: "1-15 ต.ค.",
    useContextEmployee: false,
    useContextDate: false,
    useContextPeriod: false,
    clarify: null,
    unsupportedTopic: null,
  });
  if (!model.ok) throw new Error("fixture");
  const intent = groundIntent(model.value, {
    query,
    today: TODAY,
    context: NO_CONTEXT,
  });
  // The current draft period exists only for 2026.
  const periodsByRange = vi.fn(async (from: string, to: string) => ({
    complete: true,
    items:
      from === "2026-10-01" && to === "2026-10-15"
        ? [
            {
              id: "period-2026-10a",
              siteCode: "ALPHA",
              siteName: "Alpha",
              startDate: from,
              endDate: to,
              status: "DRAFT" as const,
              latestClosedVersion: 0,
            },
          ]
        : [],
  }));
  const outcome = await resolveIntent({
    intent,
    today: TODAY,
    granted: [HR_CODES.close, HR_CODES.export],
    ownCode: null,
    context: null,
    lookups: {
      reviewEmployees: async () => null,
      adminEmployees: async () => null,
      periodsByRange,
    },
  });
  console.info("KIRO-09 evidence", {
    reading: JSON.stringify(reading),
    lookedUp: periodsByRange.mock.calls,
    outcome: outcome.kind,
  });
  expect(intent.date).toMatchObject({ ref: "RANGE", from: "2026-10-01" });
  expect(outcome.kind).not.toBe("NO_MATCH");
});
