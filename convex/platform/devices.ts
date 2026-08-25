import { v } from "convex/values";

import { pageResult } from "../lib/listEnvelope";
import type { TenantOrgId } from "../lib/tenantDb";
import { refusal, writeErrorValidator, written } from "../lib/writeEnvelope";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { deviceStatus, deviceType } from "../lib/validators";
import {
  MAX_JOB_PAGE_SIZE,
  makeJobPageRequest,
} from "../model/inventory/jobPage";
import {
  decideInstallationBinding,
  planDeviceRegistration,
  planDeviceRename,
  planDeviceRetirement,
  type RegisteredDevice,
} from "../model/platform/deviceRegistry";

export const DEVICE_OPERATIONS = Object.freeze({
  register: "platform.device.register",
  rename: "platform.device.rename",
  bind: "platform.device.bind",
  retire: "platform.device.retire",
});

interface DeviceDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly label: string;
  readonly deviceType: string;
  readonly status: string;
  readonly warehouseId?: string;
  readonly installationId?: string;
  readonly lastSeenAt?: number;
  readonly retiredAt?: number;
}

const asRegistered = (device: DeviceDocument): RegisteredDevice => ({
  deviceId: device._id,
  label: device.label,
  status: device.status === "RETIRED" ? "RETIRED" : "ACTIVE",
  ...(device.installationId === undefined
    ? {}
    : { installationId: device.installationId }),
});

async function findByLabel(
  ctx: TenantFunctionContext,
  label: string,
): Promise<DeviceDocument | null> {
  return await ctx.tenantDb
    .byIndex<DeviceDocument & Record<string, never>>(
      "devices",
      "by_orgId_label",
      [{ field: "label", value: label }],
    )
    .first();
}

async function findByInstallation(
  ctx: TenantFunctionContext,
  installationId: string,
): Promise<DeviceDocument | null> {
  return await ctx.tenantDb
    .byIndex<DeviceDocument & Record<string, never>>(
      "devices",
      "by_orgId_installationId",
      [{ field: "installationId", value: installationId }],
    )
    .first();
}

const deviceRowValidator = v.object({
  deviceId: v.id("devices"),
  label: v.string(),
  deviceType,
  status: deviceStatus,
  warehouseId: v.optional(v.id("warehouses")),

  installationBound: v.boolean(),
  lastSeenAt: v.optional(v.number()),
  retiredAt: v.optional(v.number()),
});

export const listDevices = queryWithOrg({
  args: {
    status: v.optional(deviceStatus),
    maxPageSize: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      items: v.array(deviceRowValidator),
      nextCursor: v.union(v.string(), v.null()),
      complete: v.boolean(),
    }),
    v.object({ ok: v.literal(false), error: v.object({ code: v.string() }) }),
  ),
  permissionCode: "admin.device.read",
  target: { table: "devices" },
  handler: async (ctx, args) => {
    const request = makeJobPageRequest({
      ...(args.maxPageSize === undefined
        ? {}
        : { maxPageSize: args.maxPageSize }),
      ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    });
    if (!request.ok) {
      return { ok: false as const, error: { code: request.error.code } };
    }

    const page = await ctx.tenantDb
      .byIndex<DeviceDocument & Record<string, never>>(
        "devices",
        "by_orgId_status_label",
        args.status === undefined
          ? []
          : [{ field: "status", value: args.status }],
      )
      .page({
        limit: request.value.maxPageSize,
        ...(request.value.cursor === null
          ? {}
          : { cursor: request.value.cursor }),
      });

    return pageResult(
      page.page.map((row) => {
        const record = row as unknown as Record<string, unknown>;
        const optional = (name: string) =>
          record[name] === undefined ? {} : { [name]: record[name] as never };
        return {
          deviceId: row._id as never,
          label: record["label"] as string,
          deviceType: record["deviceType"] as never,
          status: record["status"] as never,
          installationBound: record["installationId"] !== undefined,
          ...optional("warehouseId"),
          ...optional("lastSeenAt"),
          ...optional("retiredAt"),
        };
      }),
      page,
    );
  },
});

const deviceOutcomeValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

export const registerDevice = mutationWithOrg({
  args: {
    requestId: v.string(),
    label: v.string(),
    deviceType,
    warehouseId: v.optional(v.id("warehouses")),
    installationId: v.optional(v.string()),
  },
  returns: deviceOutcomeValidator,
  permissionCode: "admin.device.manage",
  target: { table: "devices" },
  handler: async (ctx, args) => {
    const plan = planDeviceRegistration({
      label: args.label,
      deviceType: args.deviceType,
      ...(args.installationId === undefined
        ? {}
        : { installationId: args.installationId }),
      now: Date.now(),
    });
    if (!plan.ok) return refusal({ ...plan.error, field: "label" });

    if ((await findByLabel(ctx, plan.value.label)) !== null) {
      return refusal({
        code: "DUPLICATE_KEY",
        field: "label",
        table: "devices",
      });
    }
    if (plan.value.installationId !== undefined) {
      const bound = await findByInstallation(ctx, plan.value.installationId);
      if (bound !== null) {
        return refusal({
          code: "DUPLICATE_KEY",
          field: "installationId",
          table: "devices",
        });
      }
    }

    if (args.warehouseId !== undefined) {
      const warehouse = await ctx.tenantDb.get("warehouses", args.warehouseId);
      if (warehouse === null) {
        return refusal({ code: "REFERENCE_NOT_FOUND", field: "warehouseId" });
      }
    }

    const deviceId = await ctx.tenantDb.insert("devices", {
      label: plan.value.label,
      deviceType: plan.value.deviceType,
      status: plan.value.status,
      ...(args.warehouseId === undefined
        ? {}
        : { warehouseId: args.warehouseId }),
      ...(plan.value.installationId === undefined
        ? {}
        : { installationId: plan.value.installationId }),
      lastSeenAt: plan.value.lastSeenAt,
      registeredByUserId: ctx.tenant.actor._id,
    });

    return written({ documentId: deviceId, replayed: false });
  },
});

export const renameDevice = mutationWithOrg({
  args: {
    requestId: v.string(),
    deviceId: v.id("devices"),
    label: v.string(),
  },
  returns: deviceOutcomeValidator,
  permissionCode: "admin.device.manage",
  target: { table: "devices", id: ({ deviceId }) => deviceId },
  handler: async (ctx, args) => {
    const device = await ctx.tenantDb.get<DeviceDocument>(
      "devices",
      args.deviceId,
    );
    if (device === null) {
      return refusal({ code: "NOT_FOUND", table: "devices" });
    }

    const plan = planDeviceRename({
      device: asRegistered(device),
      label: args.label,
    });
    if (!plan.ok) return refusal({ ...plan.error, field: "label" });

    const existing = await findByLabel(ctx, plan.value.label);
    if (existing !== null && existing._id !== args.deviceId) {
      return refusal({
        code: "DUPLICATE_KEY",
        field: "label",
        table: "devices",
      });
    }

    await ctx.tenantDb.patch("devices", args.deviceId, {
      label: plan.value.label,
    });
    return written({ documentId: args.deviceId, replayed: false });
  },
});

export const bindDeviceInstallation = mutationWithOrg({
  args: {
    requestId: v.string(),
    deviceId: v.id("devices"),
    installationId: v.string(),
  },
  returns: deviceOutcomeValidator,
  permissionCode: "admin.device.manage",
  target: { table: "devices", id: ({ deviceId }) => deviceId },
  handler: async (ctx, args) => {
    const device = await ctx.tenantDb.get<DeviceDocument>(
      "devices",
      args.deviceId,
    );
    if (device === null) {
      return refusal({ code: "NOT_FOUND", table: "devices" });
    }

    const bound = await findByInstallation(ctx, args.installationId.trim());
    const decision = decideInstallationBinding({
      device: asRegistered(device),
      installationId: args.installationId,
      ...(bound === null ? {} : { boundToDeviceId: bound._id }),
    });
    if (!decision.ok) {
      return refusal({ ...decision.error, field: "installationId" });
    }
    if (decision.value.kind === "ALREADY_BOUND") {
      return written({ documentId: args.deviceId, replayed: true });
    }

    await ctx.tenantDb.patch("devices", args.deviceId, {
      installationId: decision.value.installationId,
      lastSeenAt: Date.now(),
    });
    return written({ documentId: args.deviceId, replayed: false });
  },
});

export const retireDevice = mutationWithOrg({
  args: {
    requestId: v.string(),
    deviceId: v.id("devices"),
  },
  returns: deviceOutcomeValidator,
  permissionCode: "admin.device.manage",
  target: { table: "devices", id: ({ deviceId }) => deviceId },
  handler: async (ctx, args) => {
    const device = await ctx.tenantDb.get<DeviceDocument>(
      "devices",
      args.deviceId,
    );
    if (device === null) {
      return refusal({ code: "NOT_FOUND", table: "devices" });
    }

    const plan = planDeviceRetirement({
      device: asRegistered(device),
      now: Date.now(),
    });
    if (!plan.ok) return refusal({ ...plan.error, table: "devices" });

    await ctx.tenantDb.patch("devices", args.deviceId, {
      status: plan.value.status,
      retiredAt: plan.value.retiredAt,
      retiredByUserId: ctx.tenant.actor._id,

      ...(plan.value.releasesInstallation ? { installationId: undefined } : {}),
    });
    return written({ documentId: args.deviceId, replayed: false });
  },
});

export const recordDeviceSeen = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    installationId: v.string(),
  },
  returns: deviceOutcomeValidator,
  permissionCode: "work.device.seen",
  target: { table: "devices" },
  warehouseId: ({ warehouseId }) => warehouseId,
  installationId: ({ installationId }) => installationId,
  handler: async (ctx, args) => {
    const device = await findByInstallation(ctx, args.installationId.trim());
    if (device === null) {
      return refusal({ code: "NOT_FOUND", table: "devices" });
    }
    if (device.status === "RETIRED") {
      return refusal({
        code: "DEVICE_RETIRED",
        table: "devices",
        status: device.status,
      });
    }

    await ctx.tenantDb.patch("devices", device._id, { lastSeenAt: Date.now() });
    return written({ documentId: device._id, replayed: false });
  },
});

export const maxDevicePageSize = MAX_JOB_PAGE_SIZE;
