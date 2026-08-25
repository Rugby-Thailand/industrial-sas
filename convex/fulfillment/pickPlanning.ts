import { v } from "convex/values";

import {
  CODE_FIELD,
  appendDomainAudit,
  createMasterDataRow,
  describeAuditValue,
  insertedFields,
  normalizeField,
  replayTenantWriteIfPresent,
  updateMasterDataRow,
} from "../lib/masterDataStore";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import { pickWaveStatus } from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import {
  deriveFulfillmentLineStatus,
  moveFulfillmentQuantity,
  type FulfillmentQuantities,
} from "../model/fulfillment/reservationPolicy";

export const PICK_PLANNING_OPERATIONS = Object.freeze({
  createWave: "fulfillment.pick.wave.create",
  releaseWave: "fulfillment.pick.wave.release",
});

const MAX_WAVE_RESERVATIONS = 100;
const MAX_WAVE_TASKS = 50;
const MAX_PICK_LINES_PER_TASK = 50;

interface FulfillmentOrderRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly status: string;
}

interface FulfillmentLineRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly orderedBaseMinorUnits: number;
  readonly status: string;
  readonly quantities: FulfillmentQuantities;
}

interface ReservationRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly fulfillmentOrderId: string;
  readonly fulfillmentLineId: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly bucketKey: string;
  readonly locationId: string;
  readonly lotId?: string;
  readonly baseUom: string;
  readonly baseMinorUnits: number;
  readonly consumedBaseMinorUnits: number;
  readonly releasedBaseMinorUnits: number;
  readonly status: string;
  readonly rotationRank: number;
}

interface PickWaveRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly waveNumber: string;
  readonly warehouseId: string;
  readonly fulfillmentOrderId: string;
  readonly status:
    "DRAFT" | "RELEASED" | "IN_PROGRESS" | "COMPLETE" | "CANCELLED";
  readonly taskCount: number;
  readonly completedTaskCount: number;
}

interface PickTaskRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly pickWaveId: string;
  readonly fulfillmentLineId: string;
  readonly warehouseId: string;
  readonly taskNumber: number;
  readonly status: string;
  readonly lineCount: number;
}

interface PickTaskLineRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly pickTaskId: string;
  readonly inventoryReservationId: string;
  readonly plannedBaseMinorUnits: number;
}

const waveResultValidator = v.object({
  found: v.boolean(),
  pickWaveId: v.optional(v.id("pickWaves")),
  waveNumber: v.optional(v.string()),
  warehouseId: v.optional(v.id("warehouses")),
  fulfillmentOrderId: v.optional(v.id("fulfillmentOrders")),
  status: v.optional(pickWaveStatus),
  taskCount: v.optional(v.number()),
  completedTaskCount: v.optional(v.number()),
});

export const createPickWave = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    fulfillmentOrderId: v.id("fulfillmentOrders"),
    waveNumber: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.pick.plan",
  target: { table: "pickWaves" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const waveNumber = normalizeField(
      "waveNumber",
      args.waveNumber,
      CODE_FIELD,
    );
    if (!waveNumber.ok) return refusal(waveNumber.error);
    const fulfillment = await ctx.tenantDb.get<FulfillmentOrderRow>(
      "fulfillmentOrders",
      args.fulfillmentOrderId,
    );
    if (fulfillment === null || fulfillment.warehouseId !== args.warehouseId) {
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "fulfillmentOrderId",
      });
    }
    if (fulfillment.status !== "IN_FULFILLMENT") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "FULFILLMENT_NOT_ALLOCATED",
      });
    }
    const fingerprint = {
      operation: PICK_PLANNING_OPERATIONS.createWave,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      fulfillmentOrderId: args.fulfillmentOrderId,
      waveNumber: waveNumber.value,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "pickWaves",
      operation: PICK_PLANNING_OPERATIONS.createWave,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);

    const reservationPage = await ctx.tenantDb
      .byIndex<ReservationRow>(
        "inventoryReservations",
        "by_orgId_fulfillmentOrderId_status_bucketKey",
        [
          {
            field: "fulfillmentOrderId",
            value: args.fulfillmentOrderId,
          },
          { field: "status", value: "ACTIVE" },
        ],
      )
      .page({ limit: MAX_WAVE_RESERVATIONS });
    if (!reservationPage.isDone) {
      return refusal({
        code: "WAVE_LIMIT_EXCEEDED",
        field: "reservations",
      });
    }
    if (reservationPage.page.length === 0) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "reservations",
        reason: "NO_ACTIVE_RESERVATIONS",
      });
    }
    const grouped = new Map<string, ReservationRow[]>();
    for (const reservation of reservationPage.page) {
      const existingLine = await ctx.tenantDb
        .byIndex<PickTaskLineRow>(
          "pickTaskLines",
          "by_orgId_inventoryReservationId",
          [
            {
              field: "inventoryReservationId",
              value: reservation._id,
            },
          ],
        )
        .first();
      if (existingLine !== null) {
        return refusal({
          code: "PRECONDITION_FAILED",
          field: "reservations",
          reason: "RESERVATION_ALREADY_WAVED",
        });
      }
      const open =
        reservation.baseMinorUnits -
        reservation.consumedBaseMinorUnits -
        reservation.releasedBaseMinorUnits;
      if (!Number.isSafeInteger(open) || open <= 0) {
        return refusal({
          code: "STORED_ROW_INVALID",
          field: "reservation",
        });
      }
      const rows = grouped.get(reservation.fulfillmentLineId) ?? [];
      rows.push(reservation);
      grouped.set(reservation.fulfillmentLineId, rows);
    }
    if (grouped.size > MAX_WAVE_TASKS) {
      return refusal({ code: "WAVE_LIMIT_EXCEEDED", field: "tasks" });
    }
    if (
      [...grouped.values()].some(
        (rows) => rows.length > MAX_PICK_LINES_PER_TASK,
      )
    ) {
      return refusal({ code: "WAVE_LIMIT_EXCEEDED", field: "taskLines" });
    }

    const now = Date.now();
    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "pickWaves",
        operation: PICK_PLANNING_OPERATIONS.createWave,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint,
      uniqueness: [
        {
          field: "waveNumber",
          index: "by_orgId_waveNumber",
          equality: [{ field: "waveNumber", value: waveNumber.value }],
        },
      ],
      document: {
        waveNumber: waveNumber.value,
        warehouseId: args.warehouseId,
        fulfillmentOrderId: args.fulfillmentOrderId,
        status: "DRAFT",
        taskCount: grouped.size,
        completedTaskCount: 0,
        createdByUserId: ctx.tenant.actor._id,
        createdAt: now,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    const context = writeContextOf(ctx, {
      table: "pickWaves",
      operation: PICK_PLANNING_OPERATIONS.createWave,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
    });
    const groups = [...grouped.entries()].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    for (const [
      taskOffset,
      [fulfillmentLineId, reservations],
    ] of groups.entries()) {
      const task = {
        pickWaveId: outcome.value.documentId,
        taskNumber: taskOffset + 1,
        warehouseId: args.warehouseId,
        fulfillmentOrderId: args.fulfillmentOrderId,
        fulfillmentLineId,
        status: "AVAILABLE",
        lineCount: reservations.length,
        eventCount: 0,
      };
      const pickTaskId = await ctx.tenantDb.insert("pickTasks", task);
      await appendDomainAudit(context, {
        entityTable: "pickTasks",
        entityId: pickTaskId,
        changes: insertedFields(task),
      });
      const ranked = [...reservations].sort(
        (left, right) =>
          left.rotationRank - right.rotationRank ||
          (left.bucketKey < right.bucketKey ? -1 : 1),
      );
      for (const [lineOffset, reservation] of ranked.entries()) {
        const plannedBaseMinorUnits =
          reservation.baseMinorUnits -
          reservation.consumedBaseMinorUnits -
          reservation.releasedBaseMinorUnits;
        const line = {
          pickTaskId,
          lineNumber: lineOffset + 1,
          inventoryReservationId: reservation._id,
          warehouseId: args.warehouseId,
          itemId: reservation.itemId,
          locationId: reservation.locationId,
          ...(reservation.lotId === undefined
            ? {}
            : { lotId: reservation.lotId }),
          bucketKey: reservation.bucketKey,
          baseUom: reservation.baseUom,
          plannedBaseMinorUnits,
          pickedBaseMinorUnits: 0,
          shortBaseMinorUnits: 0,
          damagedBaseMinorUnits: 0,
          status: "OPEN",
        };
        const lineId = await ctx.tenantDb.insert("pickTaskLines", line);
        await appendDomainAudit(context, {
          entityTable: "pickTaskLines",
          entityId: lineId,
          changes: insertedFields(line),
        });
      }
    }
    return written(outcome.value);
  },
});

export const releasePickWave = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    pickWaveId: v.id("pickWaves"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "fulfillment.pick.plan",
  target: { table: "pickWaves", id: ({ pickWaveId }) => pickWaveId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const wave = await ctx.tenantDb.get<PickWaveRow>(
      "pickWaves",
      args.pickWaveId,
    );
    if (wave === null || wave.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "pickWaves" });
    }
    const fingerprint = {
      operation: PICK_PLANNING_OPERATIONS.releaseWave,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      pickWaveId: args.pickWaveId,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "pickWaves",
      operation: PICK_PLANNING_OPERATIONS.releaseWave,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    if (wave.status !== "DRAFT") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "WAVE_NOT_DRAFT",
      });
    }
    const taskPage = await ctx.tenantDb
      .byIndex<PickTaskRow>("pickTasks", "by_orgId_pickWaveId_taskNumber", [
        { field: "pickWaveId", value: args.pickWaveId },
      ])
      .page({ limit: MAX_WAVE_TASKS });
    if (!taskPage.isDone || taskPage.page.length !== wave.taskCount) {
      return refusal({ code: "STORED_ROW_INVALID", field: "tasks" });
    }
    const byFulfillmentLine = new Map<string, number>();
    const linesToRelease: PickTaskLineRow[] = [];
    for (const task of taskPage.page) {
      const linePage = await ctx.tenantDb
        .byIndex<PickTaskLineRow>(
          "pickTaskLines",
          "by_orgId_pickTaskId_lineNumber",
          [{ field: "pickTaskId", value: task._id }],
        )
        .page({ limit: MAX_WAVE_RESERVATIONS });
      if (!linePage.isDone || linePage.page.length !== task.lineCount) {
        return refusal({ code: "STORED_ROW_INVALID", field: "taskLines" });
      }
      linesToRelease.push(...linePage.page);
      const quantity = linePage.page.reduce(
        (sum, line) => sum + line.plannedBaseMinorUnits,
        0,
      );
      byFulfillmentLine.set(
        task.fulfillmentLineId,
        (byFulfillmentLine.get(task.fulfillmentLineId) ?? 0) + quantity,
      );
    }
    for (const line of linesToRelease) {
      const reservation = await ctx.tenantDb.get<ReservationRow>(
        "inventoryReservations",
        line.inventoryReservationId,
      );
      if (reservation === null || reservation.status !== "ACTIVE") {
        return refusal({
          code: "PRECONDITION_FAILED",
          field: "reservation",
          reason: "RESERVATION_NOT_ACTIVE",
        });
      }
    }
    const lineUpdates: {
      readonly line: FulfillmentLineRow;
      readonly quantities: FulfillmentQuantities;
      readonly status: string;
    }[] = [];
    for (const [fulfillmentLineId, baseMinorUnits] of byFulfillmentLine) {
      const line = await ctx.tenantDb.get<FulfillmentLineRow>(
        "fulfillmentLines",
        fulfillmentLineId,
      );
      if (line === null) {
        return refusal({
          code: "STORED_ROW_INVALID",
          field: "fulfillmentLine",
        });
      }
      const moved = moveFulfillmentQuantity(line.quantities, {
        from: "RESERVED",
        to: "PICKING",
        baseMinorUnits,
      });
      if (!moved.ok) return refusal(moved.error);
      const status = deriveFulfillmentLineStatus(
        line.orderedBaseMinorUnits,
        moved.value,
      );
      if (!status.ok) return refusal(status.error);
      lineUpdates.push({
        line,
        quantities: moved.value,
        status: status.value,
      });
    }
    const now = Date.now();
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "pickWaves",
        operation: PICK_PLANNING_OPERATIONS.releaseWave,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: args.pickWaveId,
      fingerprint,
      uniqueness: [],
      patch: { status: "RELEASED", releasedAt: now },
    });
    if (!outcome.ok) return refusal(outcome.error);
    const context = writeContextOf(ctx, {
      table: "pickWaves",
      operation: PICK_PLANNING_OPERATIONS.releaseWave,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
    });
    for (const line of linesToRelease) {
      await ctx.tenantDb.patch(
        "inventoryReservations",
        line.inventoryReservationId,
        { status: "PICKING" },
      );
      await appendDomainAudit(context, {
        entityTable: "inventoryReservations",
        entityId: line.inventoryReservationId,
        changes: [{ field: "status", from: "ACTIVE", to: "PICKING" }],
      });
    }
    for (const update of lineUpdates) {
      await ctx.tenantDb.patch("fulfillmentLines", update.line._id, {
        quantities: { ...update.quantities },
        status: update.status,
      });
      await appendDomainAudit(context, {
        entityTable: "fulfillmentLines",
        entityId: update.line._id,
        changes: [
          {
            field: "quantities",
            from: describeAuditValue(update.line.quantities),
            to: describeAuditValue(update.quantities),
          },
          { field: "status", from: update.line.status, to: update.status },
        ],
      });
    }
    return written(outcome.value);
  },
});

export const getPickWave = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    pickWaveId: v.id("pickWaves"),
  },
  returns: waveResultValidator,
  permissionCode: "fulfillment.pick.read",
  target: { table: "pickWaves", id: ({ pickWaveId }) => pickWaveId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const wave = await ctx.tenantDb.get<PickWaveRow>(
      "pickWaves",
      args.pickWaveId,
    );
    if (wave === null || wave.warehouseId !== args.warehouseId) {
      return { found: false };
    }
    return {
      found: true,
      pickWaveId: wave._id as never,
      waveNumber: wave.waveNumber,
      warehouseId: wave.warehouseId as never,
      fulfillmentOrderId: wave.fulfillmentOrderId as never,
      status: wave.status,
      taskCount: wave.taskCount,
      completedTaskCount: wave.completedTaskCount,
    };
  },
});
