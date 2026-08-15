import type { DenialReason, MembershipScopeMode } from "./validators";

export interface PermissionDefinition {
  readonly code: string;
  readonly scope: "ORG" | "WAREHOUSE" | "PLATFORM";
  readonly requiresStepUp: boolean;
  readonly requiresMakerChecker: boolean;
  readonly requiresThreshold: boolean;
}

type Flags = readonly ("STEP_UP" | "MAKER_CHECKER" | "THRESHOLD")[];

const permission = (
  code: string,
  scope: PermissionDefinition["scope"],
  flags: Flags = [],
): PermissionDefinition =>
  Object.freeze({
    code,
    scope,
    requiresStepUp: flags.includes("STEP_UP"),
    requiresMakerChecker: flags.includes("MAKER_CHECKER"),
    requiresThreshold: flags.includes("THRESHOLD"),
  });

/** Code-owned catalogue; tenant roles may compose these codes but never add one. */
export const PERMISSION_CATALOGUE = Object.freeze([
  permission("admin.organization.read", "ORG"),
  permission("admin.organization.update", "ORG", ["STEP_UP"]),
  permission("admin.membership.read", "ORG"),
  permission("admin.membership.invite", "ORG", ["STEP_UP"]),
  permission("admin.membership.update", "ORG", ["STEP_UP"]),
  permission("admin.membership.revoke", "ORG", ["STEP_UP"]),
  permission("admin.role.read", "ORG"),
  permission("admin.role.manage", "ORG", ["STEP_UP", "MAKER_CHECKER"]),
  permission("admin.device.manage", "ORG"),
  permission("admin.audit.read", "ORG"),
  permission("admin.supportGrant.read", "ORG"),
  permission("admin.supportGrant.approve", "ORG", ["STEP_UP", "MAKER_CHECKER"]),
  permission("admin.settings.policy.manage", "ORG", [
    "STEP_UP",
    "MAKER_CHECKER",
  ]),
  permission("masterData.item.read", "ORG"),
  permission("masterData.item.manage", "ORG"),
  permission("masterData.item.deactivate", "ORG", ["MAKER_CHECKER"]),
  permission("masterData.supplier.read", "ORG"),
  permission("masterData.supplier.manage", "ORG"),
  permission("masterData.warehouse.read", "ORG"),
  permission("masterData.warehouse.manage", "ORG", ["STEP_UP"]),
  permission("masterData.location.read", "WAREHOUSE"),
  permission("masterData.location.manage", "WAREHOUSE"),
  permission("masterData.storageClass.read", "ORG"),
  permission("masterData.storageClass.manage", "ORG"),
  permission("masterData.location.reparent", "WAREHOUSE", [
    "STEP_UP",
    "MAKER_CHECKER",
  ]),
  permission("masterData.lot.read", "ORG"),
  permission("masterData.lot.create", "ORG"),
  permission("masterData.lot.manage", "ORG", ["MAKER_CHECKER"]),
  permission("masterData.reasonCode.read", "ORG"),
  permission("masterData.reasonCode.manage", "ORG"),
  permission("masterData.import.execute", "ORG"),
  permission("masterData.owner.read", "ORG"),
  permission("masterData.owner.manage", "ORG", ["STEP_UP"]),
  permission("sales.customer.read", "ORG"),
  permission("sales.customer.manage", "ORG"),
  permission("sales.order.read", "ORG"),
  permission("sales.order.create", "ORG"),
  permission("sales.order.update", "ORG"),
  permission("sales.order.release", "ORG"),
  permission("sales.order.cancel", "ORG", ["MAKER_CHECKER"]),
  permission("engineering.request.read", "ORG"),
  permission("engineering.request.assign", "ORG"),
  permission("engineering.masterCard.read", "ORG"),
  permission("engineering.masterCard.draft", "ORG"),
  permission("engineering.masterCard.submit", "ORG"),
  permission("engineering.masterCard.release", "ORG", ["MAKER_CHECKER"]),
  permission("engineering.file.read", "ORG"),
  permission("engineering.file.attach", "ORG"),
  permission("production.packet.read", "WAREHOUSE"),
  permission("production.packet.issue", "WAREHOUSE"),
  permission("production.packet.acknowledge", "WAREHOUSE"),
  permission("purchasing.po.read", "WAREHOUSE"),
  permission("purchasing.po.create", "WAREHOUSE"),
  permission("purchasing.po.update", "WAREHOUSE"),
  permission("purchasing.po.import", "WAREHOUSE"),
  permission("purchasing.po.cancel", "WAREHOUSE", ["MAKER_CHECKER"]),
  permission("purchasing.po.closeShort", "WAREHOUSE", ["THRESHOLD"]),
  permission("receiving.receipt.read", "WAREHOUSE"),
  permission("receiving.receipt.post", "WAREHOUSE"),
  permission("receiving.receipt.overTolerance", "WAREHOUSE", [
    "THRESHOLD",
    "MAKER_CHECKER",
  ]),
  permission("receiving.receipt.unexpected", "WAREHOUSE", ["MAKER_CHECKER"]),
  permission("receiving.receipt.blind", "WAREHOUSE", ["MAKER_CHECKER"]),
  permission("receiving.receipt.cancelLine", "WAREHOUSE"),
  permission("receiving.exception.manage", "WAREHOUSE"),
  permission("quality.profile.read", "ORG"),
  permission("quality.profile.manage", "ORG", ["STEP_UP"]),
  permission("quality.inspection.read", "WAREHOUSE"),
  permission("quality.inspection.execute", "WAREHOUSE"),
  permission("quality.disposition.submit", "WAREHOUSE"),
  permission("quality.disposition.approve", "WAREHOUSE", [
    "MAKER_CHECKER",
    "STEP_UP",
  ]),
  permission("quality.attachment.read", "WAREHOUSE"),
  permission("handlingUnit.read", "WAREHOUSE"),
  permission("handlingUnit.build", "WAREHOUSE"),
  permission("handlingUnit.split", "WAREHOUSE"),
  permission("handlingUnit.merge", "WAREHOUSE"),
  permission("handlingUnit.relabel", "WAREHOUSE", ["MAKER_CHECKER"]),
  permission("handlingUnit.nest", "WAREHOUSE"),
  permission("handlingUnit.mixedContent", "WAREHOUSE", ["THRESHOLD"]),
  permission("label.template.read", "ORG"),
  permission("label.template.draft", "ORG"),
  permission("label.template.manage", "ORG", ["STEP_UP", "MAKER_CHECKER"]),
  permission("label.print.read", "WAREHOUSE"),
  permission("label.print.execute", "WAREHOUSE"),
  permission("label.print.reprint", "WAREHOUSE"),
  permission("putaway.task.read", "WAREHOUSE"),
  permission("putaway.task.claim", "WAREHOUSE"),
  permission("putaway.task.confirm", "WAREHOUSE"),
  permission("putaway.task.override", "WAREHOUSE", ["THRESHOLD"]),
  permission("putaway.policy.manage", "WAREHOUSE", ["STEP_UP"]),
  permission("inventory.balance.read", "WAREHOUSE"),
  permission("inventory.history.read", "WAREHOUSE"),
  permission("inventory.transaction.post", "WAREHOUSE"),
  permission("inventory.statusChange.submit", "WAREHOUSE"),
  permission("inventory.statusChange.approve", "WAREHOUSE", ["MAKER_CHECKER"]),
  permission("inventory.transaction.reverse", "WAREHOUSE", [
    "THRESHOLD",
    "MAKER_CHECKER",
    "STEP_UP",
  ]),
  permission("inventory.negativeStock.override", "WAREHOUSE", [
    "STEP_UP",
    "MAKER_CHECKER",
  ]),
  permission("reporting.dashboard.read", "WAREHOUSE"),
  permission("reporting.export.execute", "WAREHOUSE"),
  permission("reporting.export.read", "WAREHOUSE"),
  permission("reporting.jobRun.read", "ORG"),
  permission("platform.supportGrant.request", "PLATFORM"),
  permission("platform.supportGrant.approve", "PLATFORM", ["MAKER_CHECKER"]),
  permission("platform.tenant.read", "PLATFORM"),
  permission("platform.tenant.write", "PLATFORM", ["MAKER_CHECKER"]),
]);

export const PERMISSIONS_BY_CODE: ReadonlyMap<string, PermissionDefinition> =
  new Map(
    PERMISSION_CATALOGUE.map((definition) => [definition.code, definition]),
  );

export interface DefaultRoleDefinition {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly permissionCodes: readonly string[];
}

const tenantCodes = PERMISSION_CATALOGUE.filter(
  ({ scope }) => scope !== "PLATFORM",
).map(({ code }) => code);
const codes = (...permissionCodes: string[]) => Object.freeze(permissionCodes);

export const DEFAULT_ROLES: readonly DefaultRoleDefinition[] = Object.freeze([
  {
    key: "ORG_ADMIN",
    name: "Organization administrator",
    description: "Tenant administrator with every tenant permission.",
    permissionCodes: Object.freeze(tenantCodes),
  },
  {
    key: "WAREHOUSE_MANAGER",
    name: "Warehouse manager",
    description: "Site manager for assigned warehouses.",
    permissionCodes: codes(
      "admin.organization.read",
      "admin.membership.read",
      "admin.membership.invite",
      "admin.membership.update",
      "admin.role.read",
      "admin.device.manage",
      "admin.audit.read",
      "admin.supportGrant.read",
      "masterData.item.read",
      "masterData.item.manage",
      "masterData.item.deactivate",
      "masterData.supplier.read",
      "masterData.supplier.manage",
      "masterData.warehouse.read",
      "masterData.location.read",
      "masterData.location.manage",
      "masterData.storageClass.read",
      "masterData.storageClass.manage",
      "masterData.location.reparent",
      "masterData.lot.read",
      "masterData.lot.create",
      "masterData.lot.manage",
      "masterData.reasonCode.read",
      "masterData.reasonCode.manage",
      "masterData.import.execute",
      "masterData.owner.read",
      /*
       * A site manager sees what their floor is being asked to make and may issue
       * and acknowledge the packets, but holds no engineering code: releasing a
       * design is not a site decision, and a manager who could read drafts is a
       * route for an unapproved spec to reach a machine.
       */
      "sales.customer.read",
      "sales.order.read",
      "production.packet.read",
      "production.packet.issue",
      "production.packet.acknowledge",
      "purchasing.po.read",
      "purchasing.po.create",
      "purchasing.po.update",
      "purchasing.po.import",
      "purchasing.po.cancel",
      "purchasing.po.closeShort",
      "receiving.receipt.read",
      "receiving.receipt.post",
      "receiving.receipt.overTolerance",
      "receiving.receipt.unexpected",
      "receiving.receipt.blind",
      "receiving.receipt.cancelLine",
      "receiving.exception.manage",
      "quality.profile.read",
      "quality.profile.manage",
      "quality.inspection.read",
      "quality.inspection.execute",
      "quality.disposition.submit",
      "quality.disposition.approve",
      "quality.attachment.read",
      "handlingUnit.read",
      "handlingUnit.build",
      "handlingUnit.split",
      "handlingUnit.merge",
      "handlingUnit.relabel",
      "handlingUnit.nest",
      "handlingUnit.mixedContent",
      "label.template.read",
      "label.template.draft",
      "label.print.read",
      "label.print.execute",
      "label.print.reprint",
      "putaway.task.read",
      "putaway.task.claim",
      "putaway.task.confirm",
      "putaway.task.override",
      "putaway.policy.manage",
      "inventory.balance.read",
      "inventory.history.read",
      "inventory.transaction.post",
      "inventory.statusChange.submit",
      "inventory.statusChange.approve",
      "inventory.transaction.reverse",
      "reporting.dashboard.read",
      "reporting.export.execute",
      "reporting.export.read",
      "reporting.jobRun.read",
    ),
  },
  {
    key: "SUPERVISOR",
    name: "Supervisor",
    description: "Shift supervisor and approver.",
    permissionCodes: codes(
      "admin.membership.read",
      "admin.audit.read",
      "masterData.item.read",
      "masterData.supplier.read",
      "masterData.warehouse.read",
      "masterData.location.read",
      "masterData.storageClass.read",
      "masterData.lot.read",
      "masterData.lot.create",
      "masterData.lot.manage",
      "masterData.reasonCode.read",
      "purchasing.po.read",
      "purchasing.po.create",
      "purchasing.po.update",
      "purchasing.po.closeShort",
      "receiving.receipt.read",
      "receiving.receipt.post",
      "receiving.receipt.overTolerance",
      "receiving.receipt.unexpected",
      "receiving.receipt.cancelLine",
      "receiving.exception.manage",
      "quality.profile.read",
      "quality.inspection.read",
      "quality.inspection.execute",
      "quality.disposition.submit",
      "quality.disposition.approve",
      "quality.attachment.read",
      "handlingUnit.read",
      "handlingUnit.build",
      "handlingUnit.split",
      "handlingUnit.merge",
      "handlingUnit.relabel",
      "handlingUnit.nest",
      "label.template.read",
      "label.template.draft",
      "label.print.read",
      "label.print.execute",
      "label.print.reprint",
      "putaway.task.read",
      "putaway.task.claim",
      "putaway.task.confirm",
      "putaway.task.override",
      "inventory.balance.read",
      "inventory.history.read",
      "inventory.transaction.post",
      "inventory.statusChange.submit",
      "inventory.statusChange.approve",
      "reporting.dashboard.read",
      "reporting.export.execute",
      "reporting.export.read",
    ),
  },
  {
    key: "RECEIVER",
    name: "Receiver",
    description: "Inbound handheld operator.",
    permissionCodes: codes(
      "masterData.item.read",
      "masterData.supplier.read",
      "masterData.warehouse.read",
      "masterData.location.read",
      "masterData.storageClass.read",
      "masterData.lot.read",
      "masterData.lot.create",
      "masterData.reasonCode.read",
      "purchasing.po.read",
      "receiving.receipt.read",
      "receiving.receipt.post",
      "receiving.receipt.cancelLine",
      "receiving.exception.manage",
      "quality.inspection.read",
      "handlingUnit.read",
      "handlingUnit.build",
      "handlingUnit.split",
      "handlingUnit.merge",
      "handlingUnit.nest",
      "label.print.read",
      "label.print.execute",
      "label.print.reprint",
      "putaway.task.read",
      "putaway.task.claim",
      "putaway.task.confirm",
      "inventory.balance.read",
      "inventory.history.read",
      "reporting.dashboard.read",
    ),
  },
  {
    key: "QC_INSPECTOR",
    name: "QC inspector",
    description: "Incoming quality inspector.",
    permissionCodes: codes(
      "masterData.item.read",
      "masterData.supplier.read",
      "masterData.warehouse.read",
      "masterData.location.read",
      "masterData.storageClass.read",
      "masterData.lot.read",
      "masterData.reasonCode.read",
      "receiving.receipt.read",
      "quality.profile.read",
      "quality.inspection.read",
      "quality.inspection.execute",
      "quality.disposition.submit",
      "quality.attachment.read",
      "handlingUnit.read",
      "label.print.read",
      "label.print.execute",
      "inventory.balance.read",
      "inventory.history.read",
      "inventory.statusChange.submit",
      "reporting.dashboard.read",
    ),
  },
  {
    key: "PUTAWAY_OPERATOR",
    name: "Putaway operator",
    description: "Putaway handheld operator.",
    permissionCodes: codes(
      "masterData.item.read",
      "masterData.warehouse.read",
      "masterData.location.read",
      "masterData.storageClass.read",
      "masterData.lot.read",
      "masterData.reasonCode.read",
      "receiving.receipt.read",
      "handlingUnit.read",
      "handlingUnit.split",
      "handlingUnit.merge",
      "handlingUnit.nest",
      "label.print.read",
      "label.print.execute",
      "label.print.reprint",
      "putaway.task.read",
      "putaway.task.claim",
      "putaway.task.confirm",
      "putaway.task.override",
      "inventory.balance.read",
      "inventory.history.read",
      "reporting.dashboard.read",
    ),
  },
  {
    key: "INVENTORY_ANALYST",
    name: "Inventory analyst",
    description: "Inventory and planning analyst.",
    permissionCodes: codes(
      "admin.audit.read",
      "masterData.item.read",
      "masterData.supplier.read",
      "masterData.warehouse.read",
      "masterData.location.read",
      "masterData.storageClass.read",
      "masterData.lot.read",
      "masterData.reasonCode.read",
      "purchasing.po.read",
      "receiving.receipt.read",
      "quality.profile.read",
      "quality.inspection.read",
      "quality.attachment.read",
      "handlingUnit.read",
      "putaway.task.read",
      "inventory.balance.read",
      "inventory.history.read",
      "inventory.statusChange.submit",
      "reporting.dashboard.read",
      "reporting.export.execute",
      "reporting.export.read",
    ),
  },
  {
    key: "VIEWER",
    name: "Viewer",
    description: "Read-only warehouse stakeholder.",
    permissionCodes: codes(
      "masterData.item.read",
      "masterData.supplier.read",
      "masterData.warehouse.read",
      "masterData.location.read",
      "masterData.storageClass.read",
      "masterData.lot.read",
      "masterData.reasonCode.read",
      "production.packet.read",
      "purchasing.po.read",
      "receiving.receipt.read",
      "quality.inspection.read",
      "handlingUnit.read",
      "putaway.task.read",
      "inventory.balance.read",
      "inventory.history.read",
      "reporting.dashboard.read",
    ),
  },
  /*
   * The four roles below are the order-to-ship slice (ADR-0013). They are
   * separate roles rather than additions to the warehouse roles because the
   * separation is the control: an engineer who could also release a customer
   * order, or a planner who could read an unreleased revision, would defeat the
   * two rules the slice exists to hold — approve-your-own-work and
   * released-only visibility.
   */
  {
    key: "SALES_CUSTOMER_SERVICE",
    name: "Sales and customer service",
    description: "Takes customer orders and follows them to the factory floor.",
    permissionCodes: codes(
      "masterData.warehouse.read",
      "sales.customer.read",
      "sales.customer.manage",
      "sales.order.read",
      "sales.order.create",
      "sales.order.update",
      "sales.order.release",
      "sales.order.cancel",
      /*
       * Read-only on engineering, and no `engineering.file.read`. Sales needs to
       * tell a customer which revision their order is pinned to; they do not need
       * the dieline, and a customer-facing role holding artwork is how another
       * customer's artwork leaves the building.
       */
      "engineering.request.read",
      "engineering.masterCard.read",
      "production.packet.read",
      "reporting.dashboard.read",
    ),
  },
  {
    key: "ENGINEER",
    name: "Engineer",
    description: "Draws master cards and submits revisions for review.",
    permissionCodes: codes(
      "masterData.warehouse.read",
      "sales.customer.read",
      "sales.order.read",
      "engineering.request.read",
      "engineering.request.assign",
      "engineering.masterCard.read",
      "engineering.masterCard.draft",
      "engineering.masterCard.submit",
      "engineering.file.read",
      "engineering.file.attach",
      "reporting.dashboard.read",
    ),
  },
  {
    key: "ENGINEERING_APPROVER",
    name: "Engineering approver",
    description: "Reviews and releases master-card revisions.",
    permissionCodes: codes(
      "masterData.warehouse.read",
      "sales.customer.read",
      "sales.order.read",
      "engineering.request.read",
      "engineering.masterCard.read",
      "engineering.masterCard.release",
      "engineering.file.read",
      "reporting.dashboard.read",
      /*
       * Deliberately without `engineering.masterCard.draft` and `.submit`. A
       * checker who can also make is a checker who can approve their own work,
       * and holding the codes apart is what makes that impossible by role rather
       * than only by the runtime maker-checker guard.
       */
    ),
  },
  {
    key: "PRODUCTION_PLANNER",
    name: "Production planner",
    description: "Issues factory packets for design-ready order lines.",
    permissionCodes: codes(
      "masterData.warehouse.read",
      "sales.customer.read",
      "sales.order.read",
      "production.packet.read",
      "production.packet.issue",
      "production.packet.acknowledge",
      "reporting.dashboard.read",
      /*
       * No `engineering.masterCard.read` and no `engineering.file.read`: an
       * unreleased revision must never reach the floor. The packet carries a
       * snapshot of the released specification it pins, so production reads what
       * it needs from the packet and cannot reach a draft at all (INV-0013-04).
       */
    ),
  },
]);

export interface AuthorizationInput {
  readonly permissionCode: string;
  readonly actorUserId: string;
  readonly membershipStatus: "ACTIVE" | "SUSPENDED" | "REVOKED";
  readonly membershipEffectiveFrom: number;
  readonly membershipEffectiveTo?: number;
  readonly scopeMode: MembershipScopeMode;
  readonly warehouseIds: ReadonlySet<string>;
  readonly targetWarehouseId?: string;
  readonly grantedPermissionCodes: ReadonlySet<string>;
  readonly now: number;
  readonly reverifiedAt?: number;
  readonly maxStepUpAgeMs: number;
  readonly makerUserId?: string;
  readonly approvalSatisfied?: boolean;
  readonly thresholdExceeded?: boolean;
  readonly thresholdApproved?: boolean;
  readonly entitlementRequired?: boolean;
  readonly entitlementEnabled?: boolean;
}

export type AuthorizationDecision =
  | { readonly allowed: true; readonly permission: PermissionDefinition }
  | {
      readonly allowed: false;
      readonly permission?: PermissionDefinition;
      readonly reason: DenialReason;
    };

const denied = (
  reason: DenialReason,
  permissionDefinition?: PermissionDefinition,
): AuthorizationDecision => ({
  allowed: false,
  reason,
  ...(permissionDefinition === undefined
    ? {}
    : { permission: permissionDefinition }),
});

/** Pure, ordered and fail-closed authorization policy. Support grants are not an input. */
export function evaluateAuthorization(
  input: AuthorizationInput,
): AuthorizationDecision {
  const definition = PERMISSIONS_BY_CODE.get(input.permissionCode);
  if (definition === undefined || definition.scope === "PLATFORM") {
    return denied("NO_PERMISSION");
  }
  if (
    input.membershipStatus !== "ACTIVE" ||
    input.now < input.membershipEffectiveFrom ||
    (input.membershipEffectiveTo !== undefined &&
      input.now >= input.membershipEffectiveTo)
  ) {
    return denied("INACTIVE_MEMBERSHIP", definition);
  }
  if (!input.grantedPermissionCodes.has(definition.code)) {
    return denied("NO_PERMISSION", definition);
  }
  if (
    definition.scope === "WAREHOUSE" &&
    (input.targetWarehouseId === undefined ||
      (input.scopeMode === "WAREHOUSE_SCOPED" &&
        !input.warehouseIds.has(input.targetWarehouseId)))
  ) {
    return denied("OUT_OF_WAREHOUSE_SCOPE", definition);
  }
  if (input.entitlementRequired && !input.entitlementEnabled) {
    return denied("ENTITLEMENT_DISABLED", definition);
  }
  if (
    definition.requiresThreshold &&
    (input.thresholdExceeded === undefined ||
      (input.thresholdExceeded && !input.thresholdApproved))
  ) {
    return denied("THRESHOLD_EXCEEDED", definition);
  }
  if (
    definition.requiresMakerChecker &&
    (!input.approvalSatisfied ||
      input.makerUserId === undefined ||
      input.makerUserId === input.actorUserId)
  ) {
    return denied("APPROVAL_REQUIRED", definition);
  }
  if (
    definition.requiresStepUp &&
    (input.reverifiedAt === undefined ||
      input.reverifiedAt > input.now ||
      input.now - input.reverifiedAt > input.maxStepUpAgeMs)
  ) {
    return denied("REVERIFICATION_REQUIRED", definition);
  }
  return { allowed: true, permission: definition };
}

for (const role of DEFAULT_ROLES) {
  for (const code of role.permissionCodes) {
    const definition = PERMISSIONS_BY_CODE.get(code);
    if (definition === undefined || definition.scope === "PLATFORM") {
      throw new Error(
        `Default role ${role.key} contains an invalid permission.`,
      );
    }
  }
}
