import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { fromLocal } from "../../convex/model/hr/calendar";
import * as hrSearch from "../../convex/hr/search";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "@tests/fixtures/convex-tenant-world";
import { measured } from "../fixtures/query-read-stats";

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

describe("HR search checks review access only for matching employees", () => {
  it("a name search reads only the audit history of employees that match", async () => {
    const employees = 60;
    const audits = 5;
    const { w, ids } = await legacySite(employees, () => audits);
    const { value, stats } = await search(w, "Zed Target");
    expect(value.items.map((item) => item.id)).toEqual([ids.at(-1)]);
    expect(value.complete).toBe(true);
    // Only the one matching employee needs the self-review identity check.
    expect(stats.rangeDocs.auditEvents ?? 0).toBe(audits);
  });

  it("an unrelated employee's long legacy history does not make a fully checked result incomplete", async () => {
    // Employee 0 (unrelated, "Worker 0") has 10,001 retained audits. The
    // target has none, so its own identity check is complete and exact.
    const { w, ids } = await legacySite(3, (index) =>
      index === 0 ? 10_001 : 0,
    );
    const { value, stats } = await search(w, "Zed Target");
    expect(value.items.map((item) => item.id)).toEqual([ids.at(-1)]);
    expect(value.complete).toBe(true);
    expect(stats.rangeDocs.auditEvents ?? 0).toBe(0);
  });

  it("still checks the identity history of an exact-code match", async () => {
    const { w, ids } = await legacySite(3, () => 5);
    const { value, stats } = await search(w, "TGT-0001");
    expect(value.items.map((item) => item.id)).toEqual([ids.at(-1)]);
    expect(value.complete).toBe(true);
    expect(stats.rangeDocs.auditEvents ?? 0).toBe(5);
  });

  it("withholds a matching employee when their own identity history exceeds the budget", async () => {
    const { w } = await legacySite(1, () => 10_001);
    const { value } = await search(w, "Zed Target");
    expect(value.items).toEqual([]);
    expect(value.complete).toBe(false);
  });

  it("withholds a matching employee previously linked to the reviewer", async () => {
    const { w, ids } = await legacySite(1, () => 0);
    await w.t.run(async (ctx) => {
      await ctx.db.insert("auditEvents", {
        orgId: w.orgA,
        occurredAt: 1,
        actorKind: "USER",
        actorUserId: w.userA,
        action: "hr.employee.save",
        permissionCode: "hr.admin.manage",
        entityTable: "hrEmployees",
        entityId: ids[0]!,
        outcome: "ALLOWED",
        requestId: "previous-self-link",
        changes: [{ field: "userId", from: JSON.stringify(w.userA) }],
      });
    });
    const { value, stats } = await search(w, "Zed Target");
    expect(value.items).toEqual([]);
    expect(value.complete).toBe(true);
    expect(stats.rangeDocs.auditEvents).toBe(1);
  });
});
