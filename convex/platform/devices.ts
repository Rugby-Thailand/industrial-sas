/**
 * The device registry: registration, naming, installation binding, and
 * retirement (`FF-P1-08`, `ADR-0006` §8).
 *
 * The rules live in `convex/model/platform/deviceRegistry.ts`. What this module
 * adds is the three things a pure function cannot do: prove the tenant owns the
 * row, honour the two uniqueness contracts Convex cannot express, and write the
 * change inside the transaction that audits it.
 *
 * ### Why a device is registered by an administrator and not by itself
 *
 * A handheld that could register itself is a handheld that can name itself, and
 * the registry's whole purpose is that a human can look at a scanner, read the
 * label on its case, and find the same label here. `admin.device.manage` is
 * therefore the write permission, and the value the browser contributes is
 * exactly one opaque correlation string.
 *
 * ### Two uniqueness contracts, both checked here
 *
 * - `(orgId, label)` unconditionally: two rows called `DOCK-01 handheld` make
 *   the registry unable to answer the only question it exists for.
 * - `(orgId, installationId)` when present: one browser installation
 *   correlates to at most one device row. Absent is not a collision, so the
 *   check runs only when a value was supplied.
 *
 * Both are single bounded index reads, which is what makes the obligation
 * affordable on the write path (`schemaPolicy.ts`).
 */
import { v } from "convex/values";

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

/** One bounded read per uniqueness contract. See the module note. */
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
  /**
   * Whether an installation is bound, not which one.
   *
   * The value itself is a correlation string the tenant has no reason to read
   * back on a list screen, and echoing it would put a device-identifying value
   * into every registry render for no reader. "Bound" is the fact an
   * administrator acts on.
   */
  installationBound: v.boolean(),
  lastSeenAt: v.optional(v.number()),
  retiredAt: v.optional(v.number()),
});

/** The registry, newest state included, as a bounded page. */
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

    /*
     * Read through the status index even when no status was asked for: the
     * label is the second term, so an unfiltered read still comes back in
     * label order within each status, which is the order the registry is read
     * aloud in. Filtering a label-ordered page by status afterwards would
     * return short pages that read as "no retired devices" (`INV-0002-04`).
     */
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

    return {
      ok: true as const,
      items: page.page.map((row) => {
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
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
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

/**
 * Put a device into service.
 *
 * Registering the *same label* twice is refused rather than replayed: a second
 * registration under one label is an administrator registering a second
 * physical device with a duplicate asset tag, and telling them so is more
 * useful than silently handing back the first device's ID.
 */
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

/** Rename a device that is still in service. */
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

/**
 * Bind the installed PWA on one browser to a registered device.
 *
 * Separate from registration because the two happen at different moments: a
 * device is registered when it is bought, and its installation is bound when
 * somebody installs the app on it — often after a re-image, which is exactly
 * the case that must not silently move another device's binding.
 *
 * Binding an installation that already names this device answers `replayed`,
 * so an administrator who taps twice is not told they failed.
 */
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

/**
 * Take a device out of service.
 *
 * The row stays, and so does every transaction that names it. The installation
 * binding is released in the same patch, so a re-imaged handheld can register
 * cleanly rather than resolving to a device the tenant believes is gone.
 */
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
      // `undefined` clears the field through the tenant accessor's patch, which
      // is what releases the installation for a re-imaged handheld.
      ...(plan.value.releasesInstallation ? { installationId: undefined } : {}),
    });
    return written({ documentId: args.deviceId, replayed: false });
  },
});

/**
 * Record that a device is still in service.
 *
 * The one command in this slice classified `QUEUEABLE`
 * (`convex/model/platform/commandClassification.ts`): it writes a timestamp,
 * reads no stock, and a replay of it is indistinguishable from the original.
 * An operator holds `work.device.seen`, which is warehouse-scoped, so a ping
 * still proves the actor may act at the site it names.
 *
 * The device is resolved from the installation ID through the organization's
 * own index — never from a client-supplied document ID — so a value belonging
 * to another tenant resolves to nothing and a retired device is refused rather
 * than quietly revived.
 */
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

/** The page cap, re-exported so a client can size its own loop. */
export const maxDevicePageSize = MAX_JOB_PAGE_SIZE;
