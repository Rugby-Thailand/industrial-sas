import { defineSchema, defineTable } from "convex/server";
import type { DataModelFromSchemaDefinition } from "convex/server";
import { v } from "convex/values";

import { byOrg, tenantFields } from "./lib/tenantTable";
import {
  actorKind,
  auditOutcome,
  denialReason,
  deviceStatus,
  deviceType,
  idempotencyStatus,
  locale,
  locationType,
  masterDataStatus,
  membershipScopeMode,
  membershipStatus,
  organizationSettings,
  organizationStatus,
  permissionScope,
  roleStatus,
  sessionsAuditEventType,
  storageLayoutStatus,
  supportAccessMode,
  supportGrantStatus,
  userStatus,
  warehouseStatus,
} from "./lib/validators";

const batchFormat = v.union(
  v.literal("PALLET"),
  v.literal("BOX"),
  v.literal("OTHER"),
);
const batchPackage = v.object({
  quantity: v.optional(v.number()),
  lengthMm: v.optional(v.number()),
  widthMm: v.optional(v.number()),
  heightMm: v.optional(v.number()),
  weightKg: v.optional(v.number()),
  dimensionsChecked: v.boolean(),
});
const batchFields = {
  warehouseId: v.id("warehouses"),
  productId: v.id("finishedGoodsProducts"),
  revision: v.number(),
  status: v.union(v.literal("DRAFT"), v.literal("CREATED")),
  totalQuantity: v.optional(v.number()),
  storageFormat: batchFormat,
  lot: v.optional(v.string()),
  splitMode: v.optional(
    v.union(v.literal("CAPACITY"), v.literal("EQUAL"), v.literal("MANUAL")),
  ),
  capacity: v.optional(v.number()),
  unitCount: v.optional(v.number()),
  packages: v.array(batchPackage),
  createdAt: v.number(),
  createdByUserId: v.id("users"),
  updatedAt: v.number(),
  updatedByUserId: v.id("users"),
};

const schema = defineSchema({
  finishedGoodsBatches: defineTable(tenantFields(batchFields)).index(
    "by_orgId_productId",
    byOrg("productId"),
  ),
  finishedGoodsBatchRevisions: defineTable(
    tenantFields({
      ...batchFields,
      batchId: v.id("finishedGoodsBatches"),
      requestId: v.string(),
      palletIds: v.array(v.id("finishedGoodsPallets")),
    }),
  ).index("by_orgId_batchId_revision", byOrg("batchId", "revision")),
  organizations: defineTable({
    clerkOrganizationId: v.string(),

    name: v.string(),
    status: organizationStatus,

    clerkLastEventId: v.optional(v.string()),
    /** Millisecond watermark; equal or older deliveries cannot regress state. */
    clerkLastEventAt: v.optional(v.number()),

    settings: organizationSettings,
  })
    // The only supported way to resolve a tenant from a webhook or token claim.
    // Without this index, provisioning replay would scan every tenant (§5 Q2).
    .index("by_clerkOrganizationId", ["clerkOrganizationId"])
    .index("by_status", ["status"]),
  users: defineTable({
    clerkUserId: v.string(),

    displayName: v.string(),
    status: userStatus,

    clerkLastEventId: v.optional(v.string()),
    /** Millisecond watermark; equal or older deliveries cannot regress state. */
    clerkLastEventAt: v.optional(v.number()),

    preferredLocale: v.optional(locale),
  })
    // Resolving the actor from a verified Clerk token happens on every request,
    // so it must be a single indexed lookup.
    .index("by_clerkUserId", ["clerkUserId"]),
  permissions: defineTable({
    code: v.string(),
    scope: permissionScope,

    requiresStepUp: v.boolean(),

    requiresMakerChecker: v.boolean(),

    requiresThreshold: v.boolean(),
  })
    // Permission checks resolve by code, never by document ID, because the code
    // is the stable identifier that functions, tests, and audit rows cite.
    .index("by_code", ["code"])
    .index("by_scope_code", ["scope", "code"]),
  warehouses: defineTable(
    tenantFields({
      code: v.string(),
      name: v.string(),
      status: warehouseStatus,
    }),
  )
    .index("by_orgId_code", byOrg("code"))
    .index("by_orgId_status_code", byOrg("status", "code")),
  memberships: defineTable(
    tenantFields({
      userId: v.id("users"),

      clerkMembershipId: v.string(),
      status: membershipStatus,

      clerkLastEventId: v.optional(v.string()),
      /** Millisecond watermark; equal or older deliveries cannot regress state. */
      clerkLastEventAt: v.optional(v.number()),
      scopeMode: membershipScopeMode,

      effectiveFrom: v.number(),
      effectiveTo: v.optional(v.number()),
    }),
  )
    // Actor resolution: given the active organization and the mirrored user,
    // find the membership. Bounded, and the pair is unique by contract.
    .index("by_orgId_userId", byOrg("userId"))
    // Idempotent webhook application resolves the organization from the payload
    // first, then the membership within it (`INV-0001-04`).
    .index("by_orgId_clerkMembershipId", byOrg("clerkMembershipId"))
    .index("by_orgId_status_userId", byOrg("status", "userId")),
  membershipRoles: defineTable(
    tenantFields({
      membershipId: v.id("memberships"),
      roleId: v.id("roles"),
      grantedAt: v.number(),

      grantedByUserId: v.optional(v.id("users")),
    }),
  )
    // Prefix-serves "roles of this membership" and exact-serves the uniqueness
    // check for the triple.
    .index("by_orgId_membershipId_roleId", byOrg("membershipId", "roleId"))
    // "Which memberships hold this role" — needed before a role is archived.
    .index("by_orgId_roleId", byOrg("roleId")),
  membershipWarehouses: defineTable(
    tenantFields({
      membershipId: v.id("memberships"),
      warehouseId: v.id("warehouses"),
    }),
  )
    .index(
      "by_orgId_membershipId_warehouseId",
      byOrg("membershipId", "warehouseId"),
    )
    .index("by_orgId_warehouseId", byOrg("warehouseId")),
  roles: defineTable(
    tenantFields({
      key: v.string(),

      name: v.string(),
      description: v.optional(v.string()),
      status: roleStatus,
      seeded: v.boolean(),
    }),
  )
    .index("by_orgId_key", byOrg("key"))
    .index("by_orgId_status_key", byOrg("status", "key")),
  rolePermissions: defineTable(
    tenantFields({
      roleId: v.id("roles"),
      permissionCode: v.string(),
    }),
  )
    .index("by_orgId_roleId_permissionCode", byOrg("roleId", "permissionCode"))
    // "Who can do X in this tenant" — an administration and audit question.
    .index("by_orgId_permissionCode", byOrg("permissionCode")),
  entitlements: defineTable(
    tenantFields({
      key: v.string(),
      enabled: v.boolean(),

      limit: v.optional(v.number()),

      note: v.optional(v.string()),
    }),
  ).index("by_orgId_key", byOrg("key")),
  auditEvents: defineTable(
    tenantFields({
      occurredAt: v.number(),
      actorKind,

      actorUserId: v.optional(v.id("users")),

      actorPlatformRef: v.optional(v.string()),

      action: v.string(),

      permissionCode: v.optional(v.string()),
      /** Target table name; a string, because targets span every table. */
      entityTable: v.string(),

      entityId: v.optional(v.string()),

      warehouseId: v.optional(v.id("warehouses")),
      outcome: auditOutcome,

      denialReason: v.optional(denialReason),

      requestId: v.string(),
      deviceId: v.optional(v.id("devices")),

      supportGrantId: v.optional(v.id("supportGrants")),

      changes: v.optional(
        v.array(
          v.object({
            field: v.string(),
            from: v.optional(v.string()),
            to: v.optional(v.string()),
          }),
        ),
      ),
    }),
  )
    .index("by_orgId_occurredAt", byOrg("occurredAt"))
    .index(
      "by_orgId_entityTable_entityId_occurredAt",
      byOrg("entityTable", "entityId", "occurredAt"),
    )
    .index(
      "by_orgId_actorUserId_occurredAt",
      byOrg("actorUserId", "occurredAt"),
    )
    .index("by_orgId_requestId", byOrg("requestId"))
    // The tenant's own view of support access under an enabled grant
    // (`INV-0006-09`).
    .index(
      "by_orgId_supportGrantId_occurredAt",
      byOrg("supportGrantId", "occurredAt"),
    ),
  idempotencyRecords: defineTable(
    tenantFields({
      operation: v.string(),

      requestId: v.string(),
      status: idempotencyStatus,

      requestHash: v.string(),

      resultRef: v.optional(v.string()),

      resultHash: v.optional(v.string()),
      actorUserId: v.optional(v.id("users")),
      deviceId: v.optional(v.id("devices")),
      firstSeenAt: v.number(),
      completedAt: v.optional(v.number()),

      expiresAt: v.number(),
    }),
  )
    .index("by_orgId_operation_requestId", byOrg("operation", "requestId"))
    .index("by_orgId_expiresAt", byOrg("expiresAt")),
  devices: defineTable(
    tenantFields({
      label: v.string(),
      deviceType,
      status: deviceStatus,

      warehouseId: v.optional(v.id("warehouses")),

      installationId: v.optional(v.string()),
      lastSeenAt: v.optional(v.number()),

      registeredByUserId: v.optional(v.id("users")),

      retiredAt: v.optional(v.number()),
      retiredByUserId: v.optional(v.id("users")),
    }),
  )
    .index("by_orgId_installationId", byOrg("installationId"))
    .index("by_orgId_label", byOrg("label"))
    .index("by_orgId_status_label", byOrg("status", "label"))
    .index("by_orgId_warehouseId_status", byOrg("warehouseId", "status")),
  sessionsAudit: defineTable(
    tenantFields({
      userId: v.id("users"),
      eventType: sessionsAuditEventType,
      occurredAt: v.number(),
      /** Opaque Clerk session reference for correlation. Cannot authenticate. */
      clerkSessionId: v.optional(v.string()),
      deviceId: v.optional(v.id("devices")),
      requestId: v.optional(v.string()),

      reverifiedAt: v.optional(v.number()),
      outcome: auditOutcome,
    }),
  )
    .index("by_orgId_occurredAt", byOrg("occurredAt"))
    .index("by_orgId_userId_occurredAt", byOrg("userId", "occurredAt"))
    .index("by_orgId_clerkSessionId", byOrg("clerkSessionId"))
    .index("by_orgId_deviceId_occurredAt", byOrg("deviceId", "occurredAt")),
  supportGrants: defineTable(
    tenantFields({
      status: supportGrantStatus,
      accessMode: supportAccessMode,

      reason: v.string(),

      ticketRef: v.string(),

      requestedBy: v.string(),
      requestedAt: v.number(),

      firstApprovalBy: v.optional(v.string()),
      firstApprovalAt: v.optional(v.number()),

      secondApprovalBy: v.optional(v.string()),
      secondApprovalAt: v.optional(v.number()),

      tenantApprovalByUserId: v.optional(v.id("users")),
      tenantApprovalAt: v.optional(v.number()),

      expiresAt: v.number(),
      revokedAt: v.optional(v.number()),
      revokedBy: v.optional(v.string()),
      rejectedAt: v.optional(v.number()),
      rejectedReason: v.optional(v.string()),
    }),
  )
    // Expiry sweep and "is there an active grant right now" both read this.
    .index("by_orgId_status_expiresAt", byOrg("status", "expiresAt"))
    // Ticket history: every grant raised against one ticket, bounded. A lookup
    // index, not a uniqueness index — see `ticketRef` above.
    .index("by_orgId_ticketRef", byOrg("ticketRef"))
    .index("by_orgId_expiresAt", byOrg("expiresAt")),
  locations: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),

      code: v.string(),
      locationType,
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_warehouseId_code", byOrg("warehouseId", "code"))
    .index(
      "by_orgId_warehouseId_status_code",
      byOrg("warehouseId", "status", "code"),
    )
    /**
     * Active locations of one type, in code order.
     *
     * Receiving needs "the docks and staging lanes at this site" and nothing
     * else. Without the type in the prefix that question is a scan of every
     * active location filtered afterwards — and a warehouse with a thousand
     * racks would hide its own dock behind them, which reads to an operator
     * standing on that dock as "this site has no receiving location".
     */
    .index(
      "by_orgId_warehouseId_status_locationType_code",
      byOrg("warehouseId", "status", "locationType", "code"),
    ),
  finishedGoodsProducts: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      sku: v.string(),
      name: v.string(),
      unit: v.string(),
      storageFormat: v.union(
        v.literal("PALLET"),
        v.literal("BOX"),
        v.literal("OTHER"),
      ),
      defaultQuantity: v.optional(v.number()),
      storageCondition: v.string(),
      notes: v.optional(v.string()),
      customerReference: v.optional(v.string()),
      productReference: v.optional(v.string()),
      status: v.union(v.literal("DRAFT"), v.literal("ACTIVE")),
      createdAt: v.number(),
      createdByUserId: v.id("users"),
      updatedAt: v.number(),
      updatedByUserId: v.id("users"),
    }),
  ).index("by_orgId_warehouseId_sku", byOrg("warehouseId", "sku")),
  finishedGoodsPallets: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      productId: v.id("finishedGoodsProducts"),
      code: v.string(),
      quantity: v.number(),
      packingBatchId: v.optional(v.string()),
      preparationBatchId: v.optional(v.id("finishedGoodsBatches")),
      batchRevision: v.optional(v.number()),
      storageFormat: v.optional(batchFormat),
      retiredAt: v.optional(v.number()),
      retirementReason: v.optional(v.string()),
      lot: v.optional(v.string()),
      lengthMm: v.optional(v.number()),
      widthMm: v.optional(v.number()),
      heightMm: v.optional(v.number()),
      weightKg: v.optional(v.number()),
      stackable: v.optional(v.boolean()),
      maxStackLevels: v.optional(v.number()),
      status: v.union(
        v.literal("AWAITING_MEASUREMENT"),
        v.literal("AWAITING_PLACEMENT"),
        v.literal("RESERVED"),
        v.literal("STORED"),
      ),
      placementId: v.optional(v.id("finishedGoodsPlacements")),
      createdAt: v.number(),
      createdByUserId: v.id("users"),
      updatedAt: v.number(),
      updatedByUserId: v.id("users"),
    }),
  )
    .index("by_orgId_warehouseId_code", byOrg("warehouseId", "code"))
    .index("by_orgId_productId", byOrg("productId"))
    .index("by_orgId_packingBatchId", byOrg("packingBatchId"))
    .index("by_orgId_preparationBatchId", byOrg("preparationBatchId")),
  finishedGoodsPlacements: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      palletId: v.id("finishedGoodsPallets"),
      buildingId: v.id("storageBuildings"),
      floorId: v.id("storageFloors"),
      zoneId: v.id("storageZones"),
      locationId: v.id("locations"),
      supportPositionId: v.optional(v.id("storagePositions")),
      supportPalletId: v.optional(v.id("finishedGoodsPallets")),
      positionCode: v.string(),
      qrValue: v.string(),
      xMm: v.number(),
      yMm: v.number(),
      zMm: v.number(),
      widthMm: v.number(),
      depthMm: v.number(),
      heightMm: v.number(),
      rotation: v.union(v.literal(0), v.literal(90)),
      status: v.union(
        v.literal("RESERVED"),
        v.literal("STORED"),
        v.literal("RELEASED"),
      ),
      verifiedAt: v.optional(v.number()),
      verifiedByUserId: v.optional(v.id("users")),
      verificationMethod: v.optional(
        v.union(v.literal("SCAN"), v.literal("MANUAL")),
      ),
      createdAt: v.number(),
      createdByUserId: v.id("users"),
      updatedAt: v.number(),
      updatedByUserId: v.id("users"),
    }),
  )
    .index("by_orgId_supportPalletId", byOrg("supportPalletId"))
    .index("by_orgId_zoneId_status", byOrg("zoneId", "status"))
    .index("by_orgId_buildingId_status", byOrg("buildingId", "status"))
    .index("by_orgId_palletId", byOrg("palletId"))
    .index(
      "by_orgId_warehouseId_positionCode",
      byOrg("warehouseId", "positionCode"),
    ),
  finishedGoodsMoves: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      palletId: v.id("finishedGoodsPallets"),
      sourcePlacementId: v.id("finishedGoodsPlacements"),
      targetPlacementId: v.id("finishedGoodsPlacements"),
      sourceUpdatedAt: v.number(),
      palletUpdatedAt: v.number(),
      targetUpdatedAt: v.number(),
      ownerUserId: v.id("users"),
      status: v.union(
        v.literal("RESERVED"),
        v.literal("IN_TRANSIT"),
        v.literal("COMPLETED"),
        v.literal("CANCELLED"),
        v.literal("RETURNED"),
      ),
      reason: v.optional(v.string()),
      issue: v.optional(v.string()),
      verifiedAt: v.optional(v.number()),
      verifiedByUserId: v.optional(v.id("users")),
      verifiedTargetUpdatedAt: v.optional(v.number()),
      verificationMethod: v.optional(
        v.union(v.literal("SCAN"), v.literal("MANUAL")),
      ),
      pickupConfirmationMethod: v.optional(
        v.union(
          v.literal("ACKNOWLEDGEMENT"),
          v.literal("SCAN"),
          v.literal("MANUAL"),
        ),
      ),
      completionConfirmationMethod: v.optional(
        v.union(
          v.literal("ACKNOWLEDGEMENT"),
          v.literal("SCAN"),
          v.literal("MANUAL"),
        ),
      ),
      pickedUpAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      createdAt: v.number(),
      createdByUserId: v.id("users"),
      updatedAt: v.number(),
      updatedByUserId: v.id("users"),
    }),
  )
    .index("by_orgId_palletId", byOrg("palletId"))
    .index("by_orgId_warehouseId_status", byOrg("warehouseId", "status")),
  finishedGoodsCounters: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      palletSequence: v.number(),
      positionSequence: v.number(),
    }),
  ).index("by_orgId_warehouseId", byOrg("warehouseId")),
  storageBuildings: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      code: v.string(),
      name: v.string(),
      widthMm: v.number(),
      depthMm: v.number(),
      defaultFloorHeightMm: v.number(),
      floorCount: v.number(),
      totalHeightMm: v.number(),
      grossAreaSqMm: v.number(),
      reservedAreaSqMm: v.number(),
      usableAreaSqMm: v.number(),
      status: storageLayoutStatus,
      version: v.number(),
      createdAt: v.number(),
      createdByUserId: v.id("users"),
      updatedAt: v.number(),
      updatedByUserId: v.id("users"),
      activatedAt: v.optional(v.number()),
      activatedByUserId: v.optional(v.id("users")),
    }),
  )
    .index("by_orgId_warehouseId_code", byOrg("warehouseId", "code"))
    .index(
      "by_orgId_warehouseId_status_code",
      byOrg("warehouseId", "status", "code"),
    ),
  storageFloors: defineTable(
    tenantFields({
      buildingId: v.id("storageBuildings"),
      warehouseId: v.id("warehouses"),
      floorNumber: v.number(),
      widthMm: v.optional(v.number()),
      depthMm: v.optional(v.number()),
      heightMm: v.optional(v.number()),
      offsetXMm: v.optional(v.number()),
      offsetYMm: v.optional(v.number()),
      grossAreaSqMm: v.number(),
      reservedAreaSqMm: v.number(),
      usableAreaSqMm: v.number(),
      version: v.number(),
      updatedAt: v.number(),
      updatedByUserId: v.id("users"),
    }),
  )
    .index(
      "by_orgId_buildingId_floorNumber",
      byOrg("buildingId", "floorNumber"),
    )
    .index(
      "by_orgId_warehouseId_buildingId_floorNumber",
      byOrg("warehouseId", "buildingId", "floorNumber"),
    ),
  storageFloorReservedBlocks: defineTable(
    tenantFields({
      buildingId: v.id("storageBuildings"),
      floorId: v.id("storageFloors"),
      warehouseId: v.id("warehouses"),
      label: v.string(),
      xMm: v.number(),
      yMm: v.number(),
      widthMm: v.number(),
      depthMm: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  )
    .index("by_orgId_floorId", byOrg("floorId"))
    .index("by_orgId_buildingId_floorId", byOrg("buildingId", "floorId")),
  storageZones: defineTable(
    tenantFields({
      buildingId: v.id("storageBuildings"),
      floorId: v.id("storageFloors"),
      warehouseId: v.id("warehouses"),
      locationId: v.id("locations"),
      code: v.string(),
      label: v.string(),
      qrValue: v.string(),
      /**
       * Optional for online migration: a missing value is the original SIMPLE
       * one-area/one-position behaviour.
       */
      mode: v.optional(
        v.union(
          v.literal("SIMPLE"),
          v.literal("FLOOR_POSITIONS"),
          v.literal("RACK"),
          v.literal("PLATFORM"),
        ),
      ),
      baseElevationMm: v.optional(v.number()),
      xMm: v.number(),
      yMm: v.number(),
      widthMm: v.number(),
      depthMm: v.number(),
      maxStackHeightMm: v.number(),
      storageCondition: v.optional(v.string()),
      status: masterDataStatus,
      createdAt: v.number(),
      createdByUserId: v.id("users"),
      updatedAt: v.number(),
      updatedByUserId: v.id("users"),
    }),
  )
    .index("by_orgId_floorId_status_code", byOrg("floorId", "status", "code"))
    .index("by_orgId_locationId", byOrg("locationId"))
    .index("by_orgId_qrValue", byOrg("qrValue"))
    .index("by_orgId_warehouseId_code", byOrg("warehouseId", "code")),
  storagePositions: defineTable(
    tenantFields({
      buildingId: v.id("storageBuildings"),
      floorId: v.id("storageFloors"),
      zoneId: v.id("storageZones"),
      warehouseId: v.id("warehouses"),
      locationId: v.id("locations"),
      code: v.string(),
      label: v.string(),
      qrValue: v.string(),
      kind: v.union(
        v.literal("DEFAULT"),
        v.literal("FLOOR"),
        v.literal("RACK_SLOT"),
        v.literal("PLATFORM"),
      ),
      isDefault: v.boolean(),
      xMm: v.optional(v.number()),
      yMm: v.optional(v.number()),
      widthMm: v.optional(v.number()),
      depthMm: v.optional(v.number()),
      fixtureCode: v.optional(v.string()),
      bayIndex: v.optional(v.number()),
      levelIndex: v.optional(v.number()),
      slotIndex: v.optional(v.number()),
      /** Derived from rack level or the platform base, never free-form floor Z. */
      elevationMm: v.optional(v.number()),
      status: masterDataStatus,
      createdAt: v.number(),
      createdByUserId: v.id("users"),
      updatedAt: v.number(),
      updatedByUserId: v.id("users"),
    }),
  )
    .index("by_orgId_zoneId_status_code", byOrg("zoneId", "status", "code"))
    .index("by_orgId_locationId", byOrg("locationId"))
    .index("by_orgId_qrValue", byOrg("qrValue"))
    .index("by_orgId_warehouseId_code", byOrg("warehouseId", "code"))
    .index(
      "by_orgId_zoneId_fixtureCode_bayIndex_levelIndex_slotIndex",
      byOrg("zoneId", "fixtureCode", "bayIndex", "levelIndex", "slotIndex"),
    ),
});

export default schema;

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
