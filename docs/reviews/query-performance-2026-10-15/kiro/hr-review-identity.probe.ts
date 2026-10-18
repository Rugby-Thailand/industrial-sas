import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../../convex/_generated/dataModel";
import { fromLocal } from "../../../../convex/model/hr/calendar";
import * as hrSearch from "../../../../convex/hr/search";
import * as hrReview from "../../../../convex/hr/review";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "@tests/fixtures/convex-tenant-world";
import { measured, total } from "./measure";

const DATE = "2026-10-05";
const schedule = {
  workDays: [1, 2, 3, 4, 5],
  startTime: "08:30",
  endTime: "17:30",
  endsNextDay: false,
  breakMinutes: 60,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fromLocal("2026-10-07", 600, 420));
});
afterEach(() => vi.useRealTimers());

/**
 * Pre-rollout ("legacy") employees: rows saved before reviewExcludedUserIds
 * existed, each with `auditsPerEmployee` retained hr.employee.save audits
 * (no userId changes, i.e. never linked). Nothing in the tree backfills them.
 */
async function legacySite(
  employees: number,
  auditsPerEmployee: (index: number) => number,
) {
  const w = await createConvexTenantWorld();
  await seedConvexAuthorization(w, { roleA: "HR_ADMIN", roleB: "HR_EMPLOYEE" });
  const ids = await w.t.run(async (ctx) => {
    const ids: Id<"hrEmployees">[] = [];
    for (let index = 0; index < employees; index++) {
      const target = index === employees - 1;
      const id = await ctx.db.insert("hrEmployees", {
        orgId: w.orgA,
        warehouseId: w.warehouses.alphaA,
        code: target ? "TGT-0001" : `EMP-${String(index).padStart(4, "0")}`,
        displayName: target ? "Zed Target" : `Worker ${index}`,
        employmentStartDate: "2026-01-01",
        status: "ACTIVE",
        schedule,
        version: 1,
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: w.userA,
        updatedByUserId: w.userA,
      });
      ids.push(id);
      for (let audit = 0; audit < auditsPerEmployee(index); audit++)
        await ctx.db.insert("auditEvents", {
          orgId: w.orgA,
          occurredAt: audit,
          actorKind: "USER",
          actorUserId: w.userA,
          action: "hr.employee.save",
          permissionCode: "hr.admin.manage",
          entityTable: "hrEmployees",
          entityId: id,
          outcome: "ALLOWED",
          requestId: `legacy-${index}-${audit}`,
        });
    }
    return ids;
  });
  return { w, ids };
}

type SearchResult = {
  items: Array<{ id: string; code: string }>;
  complete: boolean;
};

async function search(w: ConvexTenantWorld, text: string) {
  return measured<SearchResult>(w, hrSearch.reviewEmployees, { text });
}

describe("Q3 — legacy self-review identity scan runs before name matching", () => {
  it("a name search reads only the audit history of employees that match", async () => {
    const employees = 60;
    const audits = 5;
    const { w, ids } = await legacySite(employees, () => audits);
    const { value, stats } = await search(w, "Zed Target");
    console.info(
      `[Q3] name search over ${employees} legacy employees: auditEvents ranges=${stats.ranges.auditEvents ?? 0} docs=${stats.rangeDocs.auditEvents ?? 0}; all ranges=${total(stats.ranges)} docs=${total(stats.rangeDocs)}`,
    );
    expect(value.items.map((item) => item.id)).toEqual([ids.at(-1)]);
    expect(value.complete).toBe(true);
    // Only the one matching employee needs the self-review identity check.
    expect(stats.rangeDocs.auditEvents ?? 0).toBeLessThanOrEqual(audits);
  });

  it("an unrelated employee's long legacy history does not make a fully checked result incomplete", async () => {
    // Employee 0 (unrelated, "Worker 0") has 10,001 retained audits. The
    // target has none, so its own identity check is complete and exact.
    const { w, ids } = await legacySite(3, (index) =>
      index === 0 ? 10_001 : 0,
    );
    const { value, stats } = await search(w, "Zed Target");
    console.info(
      `[Q3] search with one unrelated long history: complete=${value.complete} items=${value.items.length} auditEvents docs=${stats.rangeDocs.auditEvents ?? 0}`,
    );
    expect(value.items.map((item) => item.id)).toEqual([ids.at(-1)]);
    expect(value.complete).toBe(true);
  });

  it("observation: the review queue reads every legacy employee's audit history per execution", async () => {
    const employees = 60;
    const audits = 5;
    const { w } = await legacySite(employees, () => audits);
    const { value, stats } = await measured<{ ok: boolean }>(
      w,
      hrReview.queue,
      { from: DATE, to: DATE },
    );
    console.info(
      `[Q3] queue: ok=${value.ok} auditEvents ranges=${stats.ranges.auditEvents ?? 0} docs=${stats.rangeDocs.auditEvents ?? 0}; hrEmployees docs=${stats.rangeDocs.hrEmployees ?? 0}`,
    );
    expect(value.ok).toBe(true);
    // Recorded rather than asserted as a defect: the queue must check every
    // listed employee, so the fix is persisting the identity set (backfill),
    // not skipping the check. A backfilled tree reads 0 audit rows here.
    expect(stats.ranges.auditEvents ?? 0).toBe(employees);
  });
});
