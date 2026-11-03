import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { IDEMPOTENCY_RETENTION_MS } from "../../convex/lib/idempotency";
import { PAYSLIP_CSV_HEADER, pdfHash } from "../../convex/model/hr/payslip";
import { POLICY_PRESET, thailandDefaults } from "../../convex/model/hr/policy";
import { SHORTCUT_KEYS } from "../../convex/hr/preferences";
import { fromLocal } from "../../convex/model/hr/calendar";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  seedSecondActorForOrgA,
} from "../fixtures/convex-tenant-world";

const START = fromLocal("2026-10-05", 510, 420);
const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function fixture() {
  const w = await createConvexTenantWorld({
    "../convex/hr/policies.ts": () => import("../../convex/hr/policies"),
    "../convex/hr/leave.ts": () => import("../../convex/hr/leave"),
    "../convex/hr/setup.ts": () => import("../../convex/hr/setup"),
    "../convex/hr/review.ts": () => import("../../convex/hr/review"),
    "../convex/finishedGoods/batches.ts": () =>
      import("../../convex/finishedGoods/batches"),
    "../convex/hr/periods.ts": () => import("../../convex/hr/periods"),
    "../convex/hr/periodClose.ts": () => import("../../convex/hr/periodClose"),
    "../convex/hr/payslips.ts": () => import("../../convex/hr/payslips"),
    "../convex/hr/announcements.ts": () =>
      import("../../convex/hr/announcements"),
    "../convex/finishedGoods/workflow.ts": () =>
      import("../../convex/finishedGoods/workflow"),
    "../convex/storageLayouts/zones.ts": () =>
      import("../../convex/storageLayouts/zones"),
    "../convex/finishedGoods/jobScanLocations.ts": () =>
      import("../../convex/finishedGoods/jobScanLocations"),
    "../convex/storageLayouts/writes.ts": () =>
      import("../../convex/storageLayouts/writes"),
    "../convex/hr/preferences.ts": () => import("../../convex/hr/preferences"),
    "../convex/hr/notifications.ts": () =>
      import("../../convex/hr/notifications"),
    "../convex/hr/self.ts": () => import("../../convex/hr/self"),
    "../convex/hr/recovery.ts": () => import("../../convex/hr/recovery"),
    "../convex/operations/temporaryRetention.ts": () =>
      import("../../convex/operations/temporaryRetention"),
  });
  const auth = await seedConvexAuthorization(w, { roleA: "ORG_ADMIN" });
  const employeeId = await w.t.run((ctx) =>
    ctx.db.insert("hrEmployees", {
      orgId: w.orgA,
      warehouseId: w.warehouses.alphaA,
      userId: w.userA,
      code: "RETRY",
      displayName: "Retry worker",
      employmentStartDate: "2020-01-01",
      status: "ACTIVE",
      version: 1,
      createdAt: START,
      updatedAt: START,
      createdByUserId: w.userA,
      updatedByUserId: w.userA,
    }),
  );
  return { ...w, auth, employeeId, actor: w.t.withIdentity(identity) };
}
type World = Awaited<ReturnType<typeof fixture>>;
async function sweep(w: World) {
  return await w.t.mutation(internal.operations.temporaryRetention.sweep, {
    orgId: w.orgA,
    table: "idempotencyRecords",
    cutoff: Date.now(),
    limit: 100,
    dryRun: false,
  });
}
function value<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false },
): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected authorized result");
  return result.value;
}
const success = (result: any) => {
  expect(result, JSON.stringify(result)).toMatchObject({
    ok: true,
    value: { written: true },
  });
  return result.value;
};
const refused = (result: any, code: string) =>
  expect(result).toMatchObject({
    ok: true,
    value: { written: false, error: { code } },
  });

// Create commands with unique business keys safely refuse after receipt expiry;
// pallet creation intentionally allocates a new business identity after expiry.
describe.each([-1, 0, 1])("business retries at expiry %d ms", (offset) => {
  it.each([false, true])(
    "preserves creation invariants with cleanup=%s",
    async (cleanup) => {
      const w = await fixture();
      const product = {
        warehouseId: w.warehouses.alphaA,
        requestId: "retry-product-create",
        sku: "RETRY-1",
        name: "Boxes",
        unit: "pieces",
        storageFormat: "PALLET" as const,
        defaultQuantity: 500,
        storageCondition: "Dry",
        draft: false,
      };
      const p = success(
        await w.actor.mutation(api.finishedGoods.workflow.saveProduct, product),
      );
      const pallet = {
        warehouseId: w.warehouses.alphaA,
        requestId: "retry-pallet-create",
        productId: p.documentId,
      };
      const first = success(
        await w.actor.mutation(api.finishedGoods.workflow.createPallet, pallet),
      );
      const layout = {
        warehouseId: w.warehouses.alphaA,
        requestId: "retry-layout-create",
        code: "RETRY",
        name: "Retry building",
        widthMm: 10000,
        depthMm: 10000,
        defaultFloorHeightMm: 3000,
        floorCount: 1,
      };
      const building = success(
        await w.actor.mutation(
          api.storageLayouts.writes.createStorageBuilding,
          layout,
        ),
      );
      vi.setSystemTime(START + IDEMPOTENCY_RETENTION_MS + offset);
      if (cleanup) expect((await sweep(w)).deleted).toBe(offset < 0 ? 0 : 3);
      const repeatedProduct = await w.actor.mutation(
        api.finishedGoods.workflow.saveProduct,
        product,
      );
      const repeatedLayout = await w.actor.mutation(
        api.storageLayouts.writes.createStorageBuilding,
        layout,
      );
      if (offset < 0) {
        expect(success(repeatedProduct).documentId).toBe(p.documentId);
        expect(success(repeatedLayout).documentId).toBe(building.documentId);
        refused(
          await w.actor.mutation(api.finishedGoods.workflow.saveProduct, {
            ...product,
            name: "Changed",
          }),
          "REQUEST_ARGUMENT_CONFLICT",
        );
      } else {
        refused(repeatedProduct, "DUPLICATE_KEY");
        refused(repeatedLayout, "DUPLICATE_KEY");
        // A changed payload with a new unique key is allowed after expiry.
        success(
          await w.actor.mutation(api.finishedGoods.workflow.saveProduct, {
            ...product,
            sku: "RETRY-2",
          }),
        );
      }
      const second = success(
        await w.actor.mutation(api.finishedGoods.workflow.createPallet, pallet),
      );
      expect(second.documentId === first.documentId).toBe(offset < 0);
      const state = await w.t.run(async (ctx) => ({
        products: await ctx.db.query("finishedGoodsProducts").collect(),
        pallets: await ctx.db.query("finishedGoodsPallets").collect(),
        buildings: await ctx.db.query("storageBuildings").collect(),
        floors: await ctx.db.query("storageFloors").collect(),
      }));
      expect(state.products).toHaveLength(offset < 0 ? 1 : 2);
      expect(state.pallets).toHaveLength(offset < 0 ? 1 : 2);
      expect(new Set(state.pallets.map((row) => row.code)).size).toBe(
        state.pallets.length,
      );
      expect(state.buildings).toHaveLength(1);
      expect(state.floors).toHaveLength(1);
    },
  );
  it.each([false, true])(
    "applies preference versions and stable notification read time with cleanup=%s",
    async (cleanup) => {
      const w = await fixture();
      const shortcuts = SHORTCUT_KEYS.map((key) => ({ key, visible: true }));
      const command = {
        requestId: "retry-preferences-save",
        expectedVersion: 0,
        shortcuts,
      };
      success(await w.actor.mutation(api.hr.preferences.save, command));
      const notificationId = await w.t.run((ctx) =>
        ctx.db.insert("hrNotifications", {
          orgId: w.orgA,
          employeeId: w.employeeId,
          event: "CORRECTION_DECIDED",
          title: "Correction reviewed",
          eventKey: "retry-notification",
          unread: true,
          createdAt: START,
        }),
      );
      const mark = { requestId: "retry-notification-read", notificationId };
      success(await w.actor.mutation(api.hr.notifications.markOne, mark));
      vi.setSystemTime(START + IDEMPOTENCY_RETENTION_MS + offset);
      if (cleanup) await sweep(w);
      const result = await w.actor.mutation(api.hr.preferences.save, command);
      if (offset < 0) success(result);
      else refused(result, "PREFERENCES_STALE");
      const changed = {
        ...command,
        expectedVersion: 1,
        shortcuts: shortcuts.map((s) => ({ ...s, visible: false })),
      };
      if (offset < 0)
        refused(
          await w.actor.mutation(api.hr.preferences.save, changed),
          "REQUEST_ARGUMENT_CONFLICT",
        );
      else success(await w.actor.mutation(api.hr.preferences.save, changed));
      const read = success(
        await w.actor.mutation(api.hr.notifications.markOne, mark),
      );
      expect(read.readAt).toBe(START);
      const current = await w.actor.query(api.hr.preferences.current, {});
      const preferences = value(current);
      if (!preferences.ok) throw new Error("Expected linked preferences");
      expect(preferences.version).toBe(offset < 0 ? 1 : 2);
      const notifications = await w.actor.query(api.hr.notifications.list, {});
      expect(value(notifications).unreadCount).toBe(0);
      expect(value(notifications).items).toHaveLength(1);
      expect(
        await w.t.run((ctx) => ctx.db.query("hrShortcutPreferences").collect()),
      ).toHaveLength(1);
    },
  );
  it.each([false, true])(
    "reconciles expired attendance into permanent fences with cleanup=%s",
    async (cleanup) => {
      const w = await fixture();
      const command = {
        requestId: "retry-attendance-clock",
        expectedBusinessDate: "2026-10-05",
      };
      success(await w.actor.mutation(api.hr.self.clockIn, command));
      vi.setSystemTime(START + IDEMPOTENCY_RETENTION_MS + offset);
      if (cleanup) await sweep(w);
      if (offset >= 0)
        refused(
          await w.actor.mutation(api.hr.self.clockIn, command),
          "HR_CLOCK_DAY_CHANGED",
        );
      const recovery = {
        requestId: command.requestId,
        operation: "hr.attendance.clockIn",
      };
      expect(
        await w.actor.mutation(api.hr.recovery.reconcileRequest, recovery),
      ).toMatchObject({
        ok: true,
        value: { status: offset < 0 ? "COMMITTED" : "FENCED" },
      });
      if (offset < 0)
        success(await w.actor.mutation(api.hr.self.clockIn, command));
      else {
        vi.setSystemTime(START + 2 * IDEMPOTENCY_RETENTION_MS);
        await sweep(w);
        refused(
          await w.actor.mutation(api.hr.self.clockIn, command),
          "REQUEST_RETIRED",
        );
      }
      expect(
        await w.t.run((ctx) => ctx.db.query("hrAttendanceEvents").collect()),
      ).toHaveLength(1);
    },
  );
});

it.each([-1, 0, 1])(
  "rechecks current membership at expiry offset %d and isolates equal tenant keys",
  async (offset) => {
    const w = await fixture();
    const command = {
      warehouseId: w.warehouses.alphaA,
      requestId: "retry-scoped-product",
      sku: "SCOPED",
      name: "Scoped",
      unit: "pieces",
      storageCondition: "Dry",
      draft: false,
    };
    success(
      await w.actor.mutation(api.finishedGoods.workflow.saveProduct, command),
    );
    const other = w.t.withIdentity({ ...identity, org_id: "org_fixture_b" });
    const b = success(
      await other.mutation(api.finishedGoods.workflow.saveProduct, {
        ...command,
        warehouseId: w.warehouses.alphaB,
      }),
    );
    vi.setSystemTime(START + IDEMPOTENCY_RETENTION_MS + offset);
    await w.t.run((ctx) =>
      ctx.db.patch(w.auth.identities.membershipA, { status: "REVOKED" }),
    );
    await expect(
      w.actor.mutation(api.finishedGoods.workflow.saveProduct, command),
    ).rejects.toThrow("MEMBERSHIP_INACTIVE");
    const rows = await w.t.run((ctx) =>
      ctx.db.query("finishedGoodsProducts").collect(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row._id === b.documentId)?.orgId).toBe(w.orgB);
  },
);

it("serializes concurrent deliveries to one pallet effect while the receipt is live", async () => {
  const w = await fixture();
  const p = success(
    await w.actor.mutation(api.finishedGoods.workflow.saveProduct, {
      warehouseId: w.warehouses.alphaA,
      requestId: "retry-race-product",
      sku: "RACE",
      name: "Race",
      unit: "pieces",
      storageCondition: "Dry",
      draft: false,
    }),
  );
  const command = {
    warehouseId: w.warehouses.alphaA,
    requestId: "retry-concurrent-pallet",
    productId: p.documentId,
  };
  const results = await Promise.all([
    w.actor.mutation(api.finishedGoods.workflow.createPallet, command),
    w.actor.mutation(api.finishedGoods.workflow.createPallet, command),
  ]);
  expect(
    new Set(results.map((result) => success(result).documentId)).size,
  ).toBe(1);
  expect(
    await w.t.run((ctx) => ctx.db.query("finishedGoodsPallets").collect()),
  ).toHaveLength(1);
});

it("isolates HR actors before expiry and permits their own new execution after expiry", async () => {
  const w = await fixture();
  const second = await seedSecondActorForOrgA(w, "HR_EMPLOYEE");
  await w.t.run((ctx) =>
    ctx.db.insert("hrEmployees", {
      orgId: w.orgA,
      warehouseId: w.warehouses.alphaA,
      userId: second.userId,
      code: "SECOND",
      displayName: "Second worker",
      employmentStartDate: "2020-01-01",
      status: "ACTIVE",
      version: 1,
      createdAt: START,
      updatedAt: START,
      createdByUserId: w.userA,
      updatedByUserId: w.userA,
    }),
  );
  const other = w.t.withIdentity({
    subject: second.clerkUserId,
    org_id: identity.org_id,
  });
  const command = {
    requestId: "retry-actor-preferences",
    expectedVersion: 0,
    shortcuts: SHORTCUT_KEYS.map((key) => ({ key, visible: true })),
  };
  success(await w.actor.mutation(api.hr.preferences.save, command));
  vi.setSystemTime(START + IDEMPOTENCY_RETENTION_MS - 1);
  refused(
    await other.mutation(api.hr.preferences.save, command),
    "REQUEST_ARGUMENT_CONFLICT",
  );
  const notificationId = await w.t.run((ctx) =>
    ctx.db.insert("hrNotifications", {
      orgId: w.orgA,
      employeeId: w.employeeId,
      event: "CORRECTION_DECIDED",
      title: "Reviewed",
      eventKey: "private-read",
      unread: true,
      createdAt: START,
    }),
  );
  refused(
    await other.mutation(api.hr.notifications.markOne, {
      requestId: "retry-other-notification",
      notificationId,
    }),
    "NOT_FOUND",
  );
  vi.setSystemTime(START + IDEMPOTENCY_RETENTION_MS);
  success(await other.mutation(api.hr.preferences.save, command));
  const rows = await w.t.run((ctx) =>
    ctx.db.query("hrShortcutPreferences").collect(),
  );
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((row) => row.userId))).toEqual(
    new Set([w.userA, second.userId]),
  );
  expect(rows.every((row) => row.version === 1)).toBe(true);
  expect(await w.t.run((ctx) => ctx.db.get(notificationId))).toMatchObject({
    unread: true,
  });
  const foreignTenant = w.t.withIdentity({
    ...identity,
    org_id: "org_fixture_b",
  });
  refused(
    await foreignTenant.mutation(api.hr.preferences.save, command),
    "HR_NOT_LINKED",
  );
});

// These publication commands share a terminal-state contract: replay while
// retained, safe refusal after expiry. Their different side effects are checked
// independently: frozen days, payroll bytes and announcement fanout.
describe.each([-1, 0, 1])("publication retries at expiry %d ms", (offset) => {
  it.each([false, true])(
    "keeps frozen output and fanout unchanged with cleanup=%s",
    async (cleanup) => {
      vi.stubEnv("HR_PAYSLIP_PROVIDER_FRESHNESS_ENABLED", "true");
      vi.stubEnv("HR_PAYSLIP_PRIVATE_STORAGE_ENABLED", "true");
      const w = await fixture();
      await w.t.run(async (ctx) => {
        await ctx.db.patch(w.auth.identities.membershipA, {
          scopeMode: "ORG_WIDE",
        });
        for (const capability of ["PAYSLIPS", "ANNOUNCEMENTS"] as const)
          await ctx.db.insert("hrPolicyVersions", {
            orgId: w.orgA,
            capability,
            config: thailandDefaults(),
            effectiveDate: "2026-10-01",
            version: 1,
            draftVersion: 1,
            preset: POLICY_PRESET,
            coverageConfirmed: true,
            existingBenefitsReviewed: true,
            activatedAt: START,
            activatedByUserId: w.userA,
          });
      });
      const periodId = success(
        await w.actor.mutation(api.hr.periods.create, {
          requestId: "retry-publish-period-create",
          warehouseId: w.warehouses.alphaA,
          startDate: "2026-10-01",
          endDate: "2026-10-02",
        }),
      ).documentId;
      const ready = success(
        await w.actor.mutation(api.hr.periodClose.begin, {
          requestId: "retry-publish-period-begin",
          periodId,
        }),
      );
      expect(ready.state).toBe("READY");
      const preview = value(
        await w.actor.query(api.hr.periods.preview, {
          periodId,
          clockFree: true,
        }),
      );
      if (
        !preview.ok ||
        preview.view.kind !== "CLOSING" ||
        preview.view.state !== "READY" ||
        !preview.view.fingerprint
      )
        throw new Error("Expected ready fingerprint");
      const period = {
        requestId: "retry-publish-period-final",
        periodId,
        versionId: ready.versionId,
        expectedFingerprint: preview.view.fingerprint,
      };
      success(await w.actor.mutation(api.hr.periodClose.publish, period));
      const pdf = "%PDF-1.7\nRetry payroll original\n%%EOF\n";
      const hash = await pdfHash(new TextEncoder().encode(pdf));
      const batch = success(
        await w.actor.mutation(api.hr.payslips.stage, {
          requestId: "retry-publish-payslip-stage",
          from: "2026-10-01",
          to: "2026-10-31",
          sourceName: "Payroll.csv",
          csv: `${PAYSLIP_CSV_HEADER}\nRETRY,2026-10-01,2026-10-31,2026-10-30,30000.00,1000.00,29000.00`,
          sourceConfirmed: true,
          documents: [
            { employeeCode: "RETRY", base64: btoa(pdf), expectedHash: hash },
          ],
        }),
      );
      const payslip = {
        requestId: "retry-publish-payslip-final",
        importId: batch.documentId,
        replacementConfirmed: false,
      };
      success(await w.actor.mutation(api.hr.payslips.publish, payslip));
      const draft = success(
        await w.actor.mutation(api.hr.announcements.saveDraft, {
          requestId: "retry-publish-announcement-draft",
          expectedVersion: 0,
          title: "Notice",
          body: "Company notice",
          audience: { mode: "SITES", warehouseIds: [w.warehouses.alphaA] },
          acknowledgmentRequired: false,
        }),
      );
      const announcement = {
        requestId: "retry-publish-announcement-final",
        announcementId: draft.documentId,
        expectedVersion: 1,
      };
      success(
        await w.actor.mutation(api.hr.announcements.publish, announcement),
      );
      const sources = () =>
        w.t.run(async (ctx) => ({
          frozen: await ctx.db.query("hrPeriodRows").collect(),
          versions: await ctx.db.query("hrPeriodVersions").collect(),
          payroll: await ctx.db.query("hrPayslipRows").collect(),
          payloads: await ctx.db.query("hrPayslipPayloads").collect(),
          announcements: await ctx.db.query("hrAnnouncements").collect(),
          notifications: await ctx.db.query("hrNotifications").collect(),
        }));
      const before = await sources();
      expect(before.frozen).toHaveLength(2);
      expect(before.versions).toHaveLength(1);
      expect(before.payroll).toHaveLength(1);
      expect(before.payloads).toHaveLength(1);
      expect(before.payroll[0]?.sourceHash).toBe(hash);
      expect(before.announcements).toHaveLength(1);
      expect(before.notifications.length).toBeGreaterThan(0);
      vi.setSystemTime(START + IDEMPOTENCY_RETENTION_MS + offset);
      if (cleanup) await sweep(w);
      const periodRetry = await w.actor.mutation(
        api.hr.periodClose.publish,
        period,
      );
      const payslipRetry = await w.actor.mutation(
        api.hr.payslips.publish,
        payslip,
      );
      const announcementRetry = await w.actor.mutation(
        api.hr.announcements.publish,
        announcement,
      );
      if (offset < 0) {
        expect(success(periodRetry).documentId).toBe(ready.versionId);
        expect(success(payslipRetry).documentId).toBe(batch.documentId);
        expect(success(announcementRetry).documentId).toBe(draft.documentId);
      } else {
        refused(periodRetry, "PERIOD_ALREADY_CLOSED");
        refused(payslipRetry, "PAYSLIP_ALREADY_PUBLISHED");
        refused(announcementRetry, "ANNOUNCEMENT_STALE");
      }
      expect(await sources()).toEqual(before);
      if (offset >= 0) {
        const freshDraft = success(
          await w.actor.mutation(api.hr.announcements.saveDraft, {
            requestId: "retry-publish-announcement-draft",
            expectedVersion: 0,
            title: "Notice",
            body: "Company notice",
            audience: { mode: "SITES", warehouseIds: [w.warehouses.alphaA] },
            acknowledgmentRequired: false,
          }),
        );
        expect(freshDraft.documentId).not.toBe(draft.documentId);
        const after = await sources();
        expect(after.announcements).toHaveLength(2);
        expect(after.notifications).toEqual(before.notifications);
      }
    },
  );
});

// Zone creation owns a location and default support as well as the zone. A
// completed move owns release/store transitions, rather than quantity changes.
describe.each([-1, 0, 1])(
  "layout and move retries at expiry %d ms",
  (offset) => {
    it.each([false, true])(
      "preserves geometry, identities and placement transitions with cleanup=%s",
      async (cleanup) => {
        const w = await fixture();
        const warehouseId = w.warehouses.alphaA;
        const buildingId = success(
          await w.actor.mutation(
            api.storageLayouts.writes.createStorageBuilding,
            {
              requestId: "retry-move-building",
              warehouseId,
              code: "MOVE",
              name: "Move building",
              widthMm: 10000,
              depthMm: 10000,
              defaultFloorHeightMm: 3000,
              floorCount: 1,
            },
          ),
        ).documentId;
        // Commissioned-layout precondition; lifecycle activation is covered in its
        // own suite. All writes under retry below use registered public commands.
        await w.t.run((ctx) => ctx.db.patch(buildingId, { status: "ACTIVE" }));
        const zoneCommand = {
          requestId: "retry-zone-create",
          warehouseId,
          buildingId,
          floorNumber: 1,
          label: "Storage",
          xMm: 0,
          yMm: 0,
          widthMm: 5000,
          depthMm: 5000,
          maxStackHeightMm: 3000,
          storageCondition: "Dry",
        };
        const zone = success(
          await w.actor.mutation(
            api.storageLayouts.zones.createStorageZone,
            zoneCommand,
          ),
        );
        const locationCommand = {
          requestId: "retry-named-location",
          warehouseId,
          buildingId,
          code: "NAMED-RETRY",
          name: "Named retry",
        };
        const location = success(
          await w.actor.mutation(
            api.finishedGoods.jobScanLocations.create,
            locationCommand,
          ),
        );
        const productId = success(
          await w.actor.mutation(api.finishedGoods.workflow.saveProduct, {
            requestId: "retry-move-product",
            warehouseId,
            sku: "MOVE",
            name: "Boxes",
            unit: "pieces",
            defaultQuantity: 500,
            storageFormat: "PALLET",
            storageCondition: "Dry",
            draft: false,
          }),
        ).documentId;
        const palletId = success(
          await w.actor.mutation(api.finishedGoods.workflow.createPallet, {
            requestId: "retry-move-pallet",
            warehouseId,
            productId,
          }),
        ).documentId;
        const base = { warehouseId, palletId };
        const pallet = await w.t.run((ctx) =>
          ctx.db.get("finishedGoodsPallets", palletId),
        );
        success(
          await w.actor.mutation(api.finishedGoods.workflow.saveMeasurement, {
            ...base,
            requestId: "retry-move-measure",
            expectedMeasurementUpdatedAt: pallet!.updatedAt,
            quantity: 500,
            lengthMm: 1200,
            widthMm: 1000,
            heightMm: 1400,
          }),
        );
        const sourcePlacementId = success(
          await w.actor.mutation(api.finishedGoods.workflow.reserve, {
            ...base,
            requestId: "retry-move-store-reserve",
            zoneId: zone.documentId,
            xMm: 0,
            yMm: 0,
            rotation: 0,
          }),
        ).documentId;
        success(
          await w.actor.mutation(api.finishedGoods.workflow.verifyDestination, {
            ...base,
            requestId: "retry-move-store-verify",
            code: zone.code,
            method: "MANUAL",
          }),
        );
        success(
          await w.actor.mutation(api.finishedGoods.workflow.confirmStored, {
            ...base,
            requestId: "retry-move-store-final",
          }),
        );
        const moveId = success(
          await w.actor.mutation(api.finishedGoods.workflow.reserveMove, {
            ...base,
            requestId: "retry-move-reserve",
            zoneId: zone.documentId,
            expectedSourcePlacementId: sourcePlacementId,
            xMm: 200,
            yMm: 300,
            rotation: 90,
          }),
        ).documentId;
        const move = {
          ...base,
          moveId,
          physicalConfirmed: true,
          confirmationMethod: "ACKNOWLEDGEMENT" as const,
        };
        success(
          await w.actor.mutation(api.finishedGoods.workflow.startMove, {
            ...move,
            requestId: "retry-move-start",
          }),
        );
        const complete = { ...move, requestId: "retry-move-complete" };
        success(
          await w.actor.mutation(
            api.finishedGoods.workflow.completeMove,
            complete,
          ),
        );
        const sources = () =>
          w.t.run(async (ctx) => ({
            zones: await ctx.db.query("storageZones").collect(),
            locations: await ctx.db.query("locations").collect(),
            supports: await ctx.db.query("storagePositions").collect(),
            placements: await ctx.db.query("finishedGoodsPlacements").collect(),
            moves: await ctx.db.query("finishedGoodsMoves").collect(),
            pallets: await ctx.db.query("finishedGoodsPallets").collect(),
          }));
        const before = await sources();
        expect(before.zones).toHaveLength(1);
        expect(before.locations).toHaveLength(2);
        expect(before.moves).toHaveLength(1);
        expect(before.placements.map((row) => row.status).sort()).toEqual([
          "RELEASED",
          "STORED",
        ]);
        expect(before.pallets[0]).toMatchObject({
          status: "STORED",
          quantity: 500,
        });
        vi.setSystemTime(START + IDEMPOTENCY_RETENTION_MS + offset);
        if (cleanup) await sweep(w);
        const zoneRetry = await w.actor.mutation(
          api.storageLayouts.zones.createStorageZone,
          zoneCommand,
        );
        const locationRetry = await w.actor.mutation(
          api.finishedGoods.jobScanLocations.create,
          locationCommand,
        );
        const moveRetry = await w.actor.mutation(
          api.finishedGoods.workflow.completeMove,
          complete,
        );
        if (offset < 0) {
          expect(success(zoneRetry).documentId).toBe(zone.documentId);
          expect(success(locationRetry).documentId).toBe(location.documentId);
          expect(success(moveRetry).documentId).toBe(moveId);
        } else {
          refused(zoneRetry, "ZONE_OVERLAPS_STORAGE_ZONE");
          refused(locationRetry, "DUPLICATE_KEY");
          refused(moveRetry, "MOVE_NOT_ACTIVE");
        }
        expect(await sources()).toEqual(before);
        if (offset >= 0) {
          const freshZone = success(
            await w.actor.mutation(api.storageLayouts.zones.createStorageZone, {
              ...zoneCommand,
              xMm: 6000,
              widthMm: 2000,
            }),
          );
          const freshLocation = success(
            await w.actor.mutation(api.finishedGoods.jobScanLocations.create, {
              ...locationCommand,
              code: "NAMED-SECOND",
            }),
          );
          expect(freshZone.documentId).not.toBe(zone.documentId);
          expect(freshLocation.documentId).not.toBe(location.documentId);
          const after = await sources();
          expect(after.zones).toHaveLength(2);
          expect(after.locations).toHaveLength(4);
          expect(after.moves).toEqual(before.moves);
          expect(after.placements).toEqual(before.placements);
        }
      },
    );
  },
);

describe.each([-1, 0, 1])("correction retries at expiry %d ms", (offset) => {
  it.each([false, true])(
    "retains one pending proposal with cleanup=%s",
    async (cleanup) => {
      const w = await fixture();
      const command = {
        requestId: "retry-correction-submit",
        businessDate: "2026-10-02",
        start: { minute: 510, nextDay: false },
        end: { minute: 1050, nextDay: false },
        reason: "Forgot clock",
      };
      const first = success(
        await w.actor.mutation(api.hr.self.submitCorrection, command),
      );
      const sources = () =>
        w.t.run(async (ctx) => ({
          corrections: await ctx.db.query("hrCorrectionRequests").collect(),
          days: await ctx.db.query("hrAttendanceDays").collect(),
          notifications: await ctx.db.query("hrNotifications").collect(),
        }));
      const before = await sources();
      expect(before.corrections).toHaveLength(1);
      expect(before.days).toHaveLength(1);
      expect(before.days[0]?.pendingCorrectionId).toBe(first.documentId);
      vi.setSystemTime(START + IDEMPOTENCY_RETENTION_MS + offset);
      if (cleanup) await sweep(w);
      const retry = await w.actor.mutation(
        api.hr.self.submitCorrection,
        command,
      );
      if (offset < 0) expect(success(retry).documentId).toBe(first.documentId);
      else refused(retry, "CORRECTION_ALREADY_PENDING");
      expect(await sources()).toEqual(before);
    },
  );
});

describe.each([-1, 0, 1])("leave retries at expiry %d ms", (offset) => {
  it.each([false, true])(
    "never reserves the same claimed date twice with cleanup=%s",
    async (cleanup) => {
      const w = await fixture();
      await w.t.run(async (ctx) => {
        await ctx.db.patch(w.auth.identities.membershipA, {
          scopeMode: "ORG_WIDE",
        });
        await ctx.db.patch(w.employeeId, {
          schedule: {
            workDays: [1, 2, 3, 4, 5],
            startTime: "08:30",
            endTime: "17:30",
            endsNextDay: false,
            breakMinutes: 60,
          },
        });
      });
      await seedSecondActorForOrgA(w, "HR_ADMIN");
      success(
        await w.actor.mutation(api.hr.policies.saveDraft, {
          requestId: "retry-leave-policy",
          capability: "LEAVE",
          expectedVersion: 0,
          effectiveDate: "2026-10-05",
          config: thailandDefaults(),
        }),
      );
      for (const [type, granted] of [
        ["ANNUAL", 6],
        ["SICK", 30],
        ["PERSONAL", 3],
        ["MILITARY", 60],
      ] as const)
        success(
          await w.actor.mutation(api.hr.policies.reconcileOpening, {
            requestId: `retry-opening-${type}`,
            employeeId: w.employeeId,
            type,
            asOf: "2026-10-05",
            granted,
            used: 0,
            reserved: 0,
            paidUsed: 0,
            paidReserved: 0,
            sourceReference: "Verified register",
            expectedVersion: 0,
          }),
        );
      for (let day = 1; day <= 13; day++)
        success(
          await w.actor.mutation(api.hr.setup.saveHoliday, {
            requestId: `retry-leave-holiday-${day}`,
            warehouseId: w.warehouses.alphaA,
            date:
              day === 13
                ? "2026-05-01"
                : `2026-01-${String(day).padStart(2, "0")}`,
            name: "Company holiday",
          }),
        );
      success(
        await w.actor.mutation(api.hr.policies.activate, {
          requestId: "retry-leave-activate",
          capability: "LEAVE",
          expectedVersion: 1,
          coverageConfirmed: true,
          existingBenefitsReviewed: true,
        }),
      );
      const fields = {
        type: "ANNUAL" as const,
        from: "2026-12-01",
        to: "2026-12-01",
        reason: "Annual leave",
      };
      const preview = value(await w.actor.query(api.hr.leave.preview, fields));
      if (!preview.ok) throw new Error("Expected leave preview");
      const command = {
        ...fields,
        requestId: "retry-leave-submit",
        expectedPreviewHash: preview.previewHash,
      };
      const original = success(
        await w.actor.mutation(api.hr.leave.submit, command),
      );
      const sources = () =>
        w.t.run(async (ctx) => ({
          requests: await ctx.db.query("hrLeaveRequests").collect(),
          accounts: await ctx.db.query("hrLeaveAccounts").collect(),
          ledger: await ctx.db.query("hrLeaveLedger").collect(),
          claims: await ctx.db.query("hrLeaveDayClaims").collect(),
        }));
      const before = await sources();
      expect(before.requests).toHaveLength(1);
      expect(before.claims).toHaveLength(1);
      expect(
        before.accounts.find((row) => row.type === "ANNUAL"),
      ).toMatchObject({ reserved: 1, used: 0 });
      vi.setSystemTime(START + IDEMPOTENCY_RETENTION_MS + offset);
      if (cleanup) await sweep(w);
      const retry = await w.actor.mutation(api.hr.leave.submit, command);
      if (offset < 0)
        expect(success(retry).documentId).toBe(original.documentId);
      else refused(retry, "LEAVE_OVERLAP");
      expect(await sources()).toEqual(before);
    },
  );
});

describe.each([-1, 0, 1])(
  "rack generation retries at expiry %d ms",
  (offset) => {
    it.each([false, true])(
      "protects immutable addresses and permits a new fixture after expiry with cleanup=%s",
      async (cleanup) => {
        const w = await fixture();
        const warehouseId = w.warehouses.alphaA;
        const buildingId = success(
          await w.actor.mutation(
            api.storageLayouts.writes.createStorageBuilding,
            {
              requestId: "retry-rack-building",
              warehouseId,
              code: "RACK",
              name: "Rack building",
              widthMm: 10000,
              depthMm: 10000,
              defaultFloorHeightMm: 3000,
              floorCount: 1,
            },
          ),
        ).documentId;
        const zoneId = success(
          await w.actor.mutation(api.storageLayouts.zones.createStorageZone, {
            requestId: "retry-rack-zone",
            warehouseId,
            buildingId,
            floorNumber: 1,
            label: "Rack",
            mode: "RACK",
            xMm: 0,
            yMm: 0,
            widthMm: 5000,
            depthMm: 5000,
            maxStackHeightMm: 3000,
          }),
        ).documentId;
        const command = {
          requestId: "retry-rack-generate",
          warehouseId,
          zoneId,
          fixtureCode: "R1",
          bayCount: 1,
          levelCount: 1,
          slotsPerBay: 1,
          bayWidthMm: 1000,
          rackDepthMm: 1000,
          levelHeightMm: 1000,
        };
        const original = success(
          await w.actor.mutation(
            api.storageLayouts.zones.generateRackStoragePositions,
            command,
          ),
        );
        expect(original.createdCount).toBe(1);
        const sources = () =>
          w.t.run(async (ctx) => ({
            positions: await ctx.db.query("storagePositions").collect(),
            locations: await ctx.db.query("locations").collect(),
          }));
        const before = await sources();
        expect(before.positions).toHaveLength(1);
        expect(before.locations).toHaveLength(2);
        vi.setSystemTime(START + IDEMPOTENCY_RETENTION_MS + offset);
        if (cleanup) await sweep(w);
        const retry = await w.actor.mutation(
          api.storageLayouts.zones.generateRackStoragePositions,
          command,
        );
        if (offset < 0)
          expect(success(retry).positionIds).toEqual(original.positionIds);
        else refused(retry, "RACK_CODE_CONFLICT");
        expect(await sources()).toEqual(before);
        const changed = { ...command, fixtureCode: "R2" };
        if (offset < 0)
          refused(
            await w.actor.mutation(
              api.storageLayouts.zones.generateRackStoragePositions,
              changed,
            ),
            "REQUEST_ARGUMENT_CONFLICT",
          );
        else {
          expect(
            success(
              await w.actor.mutation(
                api.storageLayouts.zones.generateRackStoragePositions,
                changed,
              ),
            ).createdCount,
          ).toBe(1);
          const after = await sources();
          expect(after.positions).toHaveLength(2);
          expect(after.locations).toHaveLength(3);
          expect(new Set(after.positions.map((row) => row.code)).size).toBe(2);
        }
      },
    );
  },
);

describe.each([-1, 0, 1])("batch retries at expiry %d ms", (offset) => {
  it.each([false, true])(
    "creates a new batch only after ordinary expiry with cleanup=%s",
    async (cleanup) => {
      const w = await fixture();
      const warehouseId = w.warehouses.alphaA;
      const productId = success(
        await w.actor.mutation(api.finishedGoods.workflow.saveProduct, {
          requestId: "retry-batch-product",
          warehouseId,
          sku: "BATCH",
          name: "Batch",
          unit: "PCS",
          storageFormat: "PALLET",
          storageCondition: "ANY",
          draft: false,
        }),
      ).documentId;
      const row = {
        quantity: 500,
        lengthMm: 1200,
        widthMm: 1000,
        heightMm: 1400,
        dimensionsChecked: true,
      };
      const command = {
        requestId: "retry-batch-commit",
        warehouseId,
        productId,
        storageFormat: "PALLET" as const,
        totalQuantity: 1000,
        packages: [row, row],
      };
      const original = success(
        await w.actor.mutation(api.finishedGoods.batches.commitBatch, command),
      );
      vi.setSystemTime(START + IDEMPOTENCY_RETENTION_MS + offset);
      if (cleanup) await sweep(w);
      const retry = success(
        await w.actor.mutation(api.finishedGoods.batches.commitBatch, command),
      );
      expect(retry.documentId === original.documentId).toBe(offset < 0);
      const state = await w.t.run(async (ctx) => ({
        batches: await ctx.db.query("finishedGoodsBatches").collect(),
        revisions: await ctx.db.query("finishedGoodsBatchRevisions").collect(),
        pallets: await ctx.db.query("finishedGoodsPallets").collect(),
      }));
      expect(state.batches).toHaveLength(offset < 0 ? 1 : 2);
      expect(state.revisions).toHaveLength(offset < 0 ? 1 : 2);
      expect(state.pallets).toHaveLength(offset < 0 ? 2 : 4);
      expect(
        state.pallets.reduce((total, row) => total + (row.quantity ?? 0), 0),
      ).toBe(offset < 0 ? 1000 : 2000);
      expect(new Set(state.pallets.map((row) => row.code)).size).toBe(
        state.pallets.length,
      );
    },
  );
});

describe.each([-1, 0, 1])("certification retries at expiry %d ms", (offset) => {
  it.each([false, true])(
    "refuses a stale revision after expiry with cleanup=%s",
    async (cleanup) => {
      const w = await fixture();
      const second = await seedSecondActorForOrgA(w, "HR_EMPLOYEE");
      const employeeId = await w.t.run((ctx) =>
        ctx.db.insert("hrEmployees", {
          orgId: w.orgA,
          warehouseId: w.warehouses.alphaA,
          code: "CERTIFY",
          displayName: "Worker",
          userId: second.userId,
          employmentStartDate: "2020-01-01",
          status: "ACTIVE",
          schedule: {
            workDays: [1, 2, 3, 4, 5],
            startTime: "08:30",
            endTime: "17:30",
            endsNextDay: false,
            breakMinutes: 60,
          },
          version: 1,
          createdAt: START,
          updatedAt: START,
          createdByUserId: w.userA,
          updatedByUserId: w.userA,
        }),
      );
      const command = {
        requestId: "retry-day-certification",
        employeeId,
        businessDate: "2026-10-02",
        expectedRevision: 0,
        disposition: "ABSENT" as const,
        reason: "Verified absence",
      };
      const original = success(
        await w.actor.mutation(api.hr.review.disposeDay, command),
      );
      const before = await w.t.run((ctx) =>
        ctx.db.query("hrAttendanceDays").collect(),
      );
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({
        revision: 1,
        certification: { disposition: "ABSENT" },
      });
      vi.setSystemTime(START + IDEMPOTENCY_RETENTION_MS + offset);
      if (cleanup) await sweep(w);
      const retry = await w.actor.mutation(api.hr.review.disposeDay, command);
      if (offset < 0)
        expect(success(retry).documentId).toBe(original.documentId);
      else refused(retry, "DECISION_STALE");
      expect(
        await w.t.run((ctx) => ctx.db.query("hrAttendanceDays").collect()),
      ).toEqual(before);
    },
  );
});
