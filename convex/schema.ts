import { defineSchema, defineTable } from "convex/server";
import type { DataModelFromSchemaDefinition } from "convex/server";
import { v } from "convex/values";

import { byOrg, tenantFields } from "./lib/tenantTable";
import {
  actorKind,
  auditOutcome,
  barcodeKind,
  boxSpecification,
  customerOrderLineStatus,
  customerOrderStatus,
  countEntrySource,
  countMovementPolicy,
  countPlanStatus,
  countReconciliationStatus,
  countScope,
  countTaskStatus,
  countVisibility,
  deliveryMilestoneKind,
  denialReason,
  designRequirementConfirmations,
  designRequirementKey,
  designRequestPriority,
  designRequestStatus,
  designSource,
  deviceStatus,
  deviceType,
  documentReturnStatus,
  employmentStatus,
  factoryPacketStatus,
  fulfillmentLineStatus,
  fulfillmentOrderRouteDecision,
  fulfillmentOrderStatus,
  fulfillmentRouteDecision,
  fulfillmentPackageStatus,
  attendanceDayStatus,
  attendanceEventKind,
  hrRequestStatus,
  idempotencyStatus,
  importBatchStatus,
  inspectionStatus,
  integrationAdapterKind,
  integrationAdapterStatus,
  integrationAttemptOutcome,
  integrationMessageStatus,
  inventoryTransactionSource,
  inventoryTransactionType,
  inventoryReservationStatus,
  itemTrackingMode,
  ledgerLocationKind,
  locale,
  leaveDurationKind,
  leaveType,
  labelTemplateFormat,
  labelTemplateStatus,
  locationType,
  masterCardFileKind,
  masterCardFileStorageState,
  masterCardRevisionStatus,
  masterDataStatus,
  membershipScopeMode,
  membershipStatus,
  operatorTaskEvidenceKind,
  operatorTaskExceptionDisposition,
  operatorTaskExceptionStatus,
  operatorTaskAttachmentKind,
  operatorTaskKind,
  operatorTaskStatus,
  pickEventKind,
  pickTaskLineStatus,
  pickTaskStatus,
  pickWaveStatus,
  openingStockBatchStatus,
  openingStockPostChunkStatus,
  openingStockRowStatus,
  organizationSettings,
  organizationStatus,
  permissionScope,
  quantityPlausibility,
  printJobStatus,
  printReason,
  proofOfDeliveryStatus,
  productionOrderStatus,
  productionOutputDisposition,
  purchaseOrderLineStatus,
  purchaseOrderStatus,
  putawayTaskStatus,
  reportJobStatus,
  reportKind,
  rollupMetric,
  qcDisposition,
  reasonCodeScope,
  receiptClassification,
  receiptLineKind,
  receivingExceptionStatus,
  roleStatus,
  samplingStrategy,
  sessionsAuditEventType,
  shipmentPackageStatus,
  shipmentStatus,
  signedQuantity,
  stepUpDecision,
  stockStatus,
  storageLayoutStatus,
  supportAccessMode,
  supportGrantStatus,
  transportFileKind,
  transportFileStorageState,
  transferDiscrepancyStatus,
  transferSourceKind,
  transferStatus,
  tripStatus,
  userStatus,
  varianceRisk,
  virtualBoundaryCode,
  warehouseStatus,
  allocationStrategy,
} from "./lib/validators";

const schema = defineSchema({
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

  operatorTasks: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),

      taskNumber: v.string(),
      kind: operatorTaskKind,

      instruction: v.string(),
      status: operatorTaskStatus,

      itemId: v.optional(v.id("items")),

      locationId: v.optional(v.id("locations")),

      expectedBaseMinorUnits: v.optional(v.number()),

      dueAt: v.optional(v.number()),
      claimedByUserId: v.optional(v.id("users")),
      claimedAt: v.optional(v.number()),
      leaseExpiresAt: v.optional(v.number()),
      heartbeatAt: v.optional(v.number()),

      evidenceCount: v.number(),
      createdByUserId: v.id("users"),
      completedByUserId: v.optional(v.id("users")),
      completedAt: v.optional(v.number()),
      cancelledByUserId: v.optional(v.id("users")),
      cancelledAt: v.optional(v.number()),
    }),
  )
    .index("by_orgId_taskNumber", byOrg("taskNumber"))
    // The site board, by state. What a supervisor opens.
    .index("by_orgId_warehouseId_status", byOrg("warehouseId", "status"))
    // "My work" — the first screen an operator sees, and the reason the holder
    // is in the index prefix rather than filtered out of a site-wide page.
    .index(
      "by_orgId_claimedByUserId_status",
      byOrg("claimedByUserId", "status"),
    ),

  operatorTaskEvidence: defineTable(
    tenantFields({
      operatorTaskId: v.id("operatorTasks"),

      sequence: v.number(),
      kind: operatorTaskEvidenceKind,
      capturedByUserId: v.id("users"),

      capturedAt: v.number(),

      deviceId: v.optional(v.id("devices")),

      enteredQuantity: v.optional(signedQuantity),

      baseMinorUnits: v.optional(v.number()),

      plausibility: v.optional(quantityPlausibility),

      stepUpApprovalId: v.optional(v.id("stepUpApprovals")),

      scanValue: v.optional(v.string()),

      resolvedItemId: v.optional(v.id("items")),

      resolvedSku: v.optional(v.string()),
      scanVia: v.optional(v.union(v.literal("BARCODE"), v.literal("SKU"))),
      scanInputMethod: v.optional(
        v.union(v.literal("HID"), v.literal("MANUAL")),
      ),

      manualEntryReason: v.optional(v.string()),

      note: v.optional(v.string()),

      previousHolderUserId: v.optional(v.id("users")),
    }),
  ).index(
    "by_orgId_operatorTaskId_sequence",
    byOrg("operatorTaskId", "sequence"),
  ),

  operatorTaskExceptions: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      operatorTaskId: v.id("operatorTasks"),
      reasonCodeId: v.id("reasonCodes"),

      reasonCode: v.string(),
      reasonName: v.string(),
      summary: v.string(),
      evidence: v.string(),
      proposedDisposition: operatorTaskExceptionDisposition,
      proposedRecoveryAction: v.string(),
      status: operatorTaskExceptionStatus,
      reportedByUserId: v.id("users"),
      reportedAt: v.number(),
      finalDisposition: v.optional(operatorTaskExceptionDisposition),
      recoveryAction: v.optional(v.string()),
      approverNote: v.optional(v.string()),
      resolvedByUserId: v.optional(v.id("users")),
      resolvedAt: v.optional(v.number()),
    }),
  )
    .index(
      "by_orgId_operatorTaskId_reportedAt",
      byOrg("operatorTaskId", "reportedAt"),
    )
    .index(
      "by_orgId_warehouseId_status_reportedAt",
      byOrg("warehouseId", "status", "reportedAt"),
    ),

  operatorTaskAttachments: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      operatorTaskId: v.id("operatorTasks"),
      fileName: v.string(),
      kind: operatorTaskAttachmentKind,
      contentType: v.string(),
      byteSize: v.number(),
      contentDigest: v.string(),
      uploadThingKey: v.string(),
      note: v.optional(v.string()),
      verifiedAt: v.number(),
      attachedByUserId: v.id("users"),
      attachedAt: v.number(),
    }),
  ).index(
    "by_orgId_operatorTaskId_attachedAt",
    byOrg("operatorTaskId", "attachedAt"),
  ),

  operatorTaskUploadGrants: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      operatorTaskId: v.id("operatorTasks"),
      authorizedByUserId: v.id("users"),
      authorizedClerkUserId: v.string(),
      expiresAt: v.number(),
      uploadStartedAt: v.number(),
      consumedUploadThingKey: v.optional(v.string()),
      consumedContentDigest: v.optional(v.string()),
      consumedContentType: v.optional(v.string()),
      consumedByteSize: v.optional(v.number()),
      consumedAt: v.optional(v.number()),
      attachedAt: v.optional(v.number()),
    }),
  ).index("by_orgId_expiresAt", byOrg("expiresAt")),

  operatorTaskFileAccessGrants: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      operatorTaskAttachmentId: v.id("operatorTaskAttachments"),
      issuedToUserId: v.id("users"),
      expiresAt: v.number(),
      consumedAt: v.optional(v.number()),
    }),
  ).index(
    "by_orgId_operatorTaskAttachmentId_expiresAt",
    byOrg("operatorTaskAttachmentId", "expiresAt"),
  ),

  stepUpApprovals: defineTable(
    tenantFields({
      operation: v.string(),

      targetRef: v.string(),

      operatorUserId: v.id("users"),

      approverUserId: v.id("users"),

      deviceId: v.id("devices"),
      decision: stepUpDecision,

      reason: v.string(),
      grantedAt: v.number(),

      expiresAt: v.number(),
      consumedAt: v.optional(v.number()),
      /** The request that spent it, so a replay is traceable to one command. */
      consumedRequestId: v.optional(v.string()),
    }),
  )
    // "Which approvals is this operator holding right now" — the screen's read,
    // and the expiry sweep's.
    .index(
      "by_orgId_operatorUserId_expiresAt",
      byOrg("operatorUserId", "expiresAt"),
    )
    // The review question: every decision made about one document.
    .index("by_orgId_targetRef_grantedAt", byOrg("targetRef", "grantedAt")),

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

  items: defineTable(
    tenantFields({
      sku: v.string(),

      name: v.string(),

      baseUom: v.string(),
      trackingMode: itemTrackingMode,
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_sku", byOrg("sku"))
    .index("by_orgId_status_sku", byOrg("status", "sku")),

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

  storageStackPlacements: defineTable(
    tenantFields({
      zoneId: v.id("storageZones"),
      /** Optional only for placements created before storage-position backfill. */
      positionId: v.optional(v.id("storagePositions")),
      locationId: v.id("locations"),
      warehouseId: v.id("warehouses"),
      handlingUnitId: v.id("handlingUnits"),
      levelIndex: v.number(),
      widthMm: v.number(),
      depthMm: v.number(),
      heightMm: v.number(),
      orientation: v.union(v.literal("DEFAULT"), v.literal("ROTATED")),
      status: v.union(v.literal("ACTIVE"), v.literal("REMOVED")),
      transactionId: v.id("inventoryTransactions"),
      placedAt: v.number(),
      placedByUserId: v.id("users"),
      removedAt: v.optional(v.number()),
      removedByUserId: v.optional(v.id("users")),
    }),
  )
    .index(
      "by_orgId_zoneId_status_levelIndex",
      byOrg("zoneId", "status", "levelIndex"),
    )
    .index(
      "by_orgId_positionId_status_levelIndex",
      byOrg("positionId", "status", "levelIndex"),
    )
    .index("by_orgId_handlingUnitId_status", byOrg("handlingUnitId", "status"))
    .index("by_orgId_locationId_status", byOrg("locationId", "status")),

  lots: defineTable(
    tenantFields({
      itemId: v.id("items"),

      lotCode: v.string(),

      manufactureDate: v.optional(v.string()),
      expirationDate: v.optional(v.string()),
      bestBeforeDate: v.optional(v.string()),
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_itemId_lotCode", byOrg("itemId", "lotCode"))
    /*
     * The status-carrying variant of the line above, for "this item's ACTIVE
     * lots". Status has to be *in* the index rather than a predicate over a page:
     * a page is drawn before a filter runs, so filtering afterwards returns a
     * short page — sometimes an empty one — while the envelope still reports more
     * to come, and the screen reads that as "this item has no lots"
     * (`INV-0002-04`).
     */
    .index(
      "by_orgId_itemId_status_lotCode",
      byOrg("itemId", "status", "lotCode"),
    )
    .index("by_orgId_itemId_expirationDate", byOrg("itemId", "expirationDate")),

  handlingUnits: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),

      lpn: v.string(),

      currentLocationId: v.optional(v.id("locations")),

      widthMm: v.optional(v.number()),
      depthMm: v.optional(v.number()),
      heightMm: v.optional(v.number()),
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_lpn", byOrg("lpn"))
    .index(
      "by_orgId_warehouseId_status_lpn",
      byOrg("warehouseId", "status", "lpn"),
    ),

  owners: defineTable(
    tenantFields({
      code: v.string(),
      name: v.string(),
      status: masterDataStatus,
    }),
  ).index("by_orgId_code", byOrg("code")),

  reasonCodes: defineTable(
    tenantFields({
      code: v.string(),
      name: v.string(),
      scope: reasonCodeScope,
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_code", byOrg("code"))
    .index("by_orgId_scope_code", byOrg("scope", "code")),

  suppliers: defineTable(
    tenantFields({
      code: v.string(),
      name: v.string(),
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_code", byOrg("code"))
    .index("by_orgId_status_code", byOrg("status", "code")),

  itemBarcodes: defineTable(
    tenantFields({
      itemId: v.id("items"),

      barcode: v.string(),
      kind: barcodeKind,
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_barcode", byOrg("barcode"))
    .index("by_orgId_itemId_barcode", byOrg("itemId", "barcode"))
    /* The status-carrying variant; see the note on `lots` above. */
    .index(
      "by_orgId_itemId_status_barcode",
      byOrg("itemId", "status", "barcode"),
    ),

  itemUoms: defineTable(
    tenantFields({
      itemId: v.id("items"),

      uom: v.string(),

      toBaseNumerator: v.number(),
      toBaseDenominator: v.number(),
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_itemId_uom", byOrg("itemId", "uom"))
    .index("by_orgId_itemId_status_uom", byOrg("itemId", "status", "uom")),

  storageClasses: defineTable(
    tenantFields({
      code: v.string(),
      name: v.string(),
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_code", byOrg("code"))
    .index("by_orgId_status_code", byOrg("status", "code")),

  labelTemplates: defineTable(
    tenantFields({
      code: v.string(),

      version: v.number(),
      name: v.string(),
      format: labelTemplateFormat,

      body: v.string(),
      status: labelTemplateStatus,

      draftedByUserId: v.id("users"),

      publishedByUserId: v.optional(v.id("users")),
    }),
  )
    .index("by_orgId_code_version", byOrg("code", "version"))
    .index("by_orgId_status_code", byOrg("status", "code")),

  purchaseOrders: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),

      poNumber: v.string(),
      supplierId: v.id("suppliers"),
      status: purchaseOrderStatus,

      externalRef: v.optional(v.string()),

      importBatchId: v.optional(v.id("poImportBatches")),
    }),
  )
    .index("by_orgId_poNumber", byOrg("poNumber"))
    .index("by_orgId_externalRef", byOrg("externalRef"))
    .index(
      "by_orgId_warehouseId_status_poNumber",
      byOrg("warehouseId", "status", "poNumber"),
    ),

  purchaseOrderLines: defineTable(
    tenantFields({
      purchaseOrderId: v.id("purchaseOrders"),

      lineNumber: v.number(),
      itemId: v.id("items"),

      orderedQuantity: signedQuantity,

      orderedBaseMinorUnits: v.number(),

      receivedBaseMinorUnits: v.number(),
      status: purchaseOrderLineStatus,

      closeReasonCodeId: v.optional(v.id("reasonCodes")),

      sourceRowRef: v.optional(v.string()),
    }),
  )
    .index(
      "by_orgId_purchaseOrderId_lineNumber",
      byOrg("purchaseOrderId", "lineNumber"),
    )
    .index(
      "by_orgId_purchaseOrderId_status",
      byOrg("purchaseOrderId", "status"),
    )
    .index("by_orgId_sourceRowRef", byOrg("sourceRowRef")),

  poImportBatches: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),

      batchRef: v.string(),
      supplierId: v.id("suppliers"),
      status: importBatchStatus,
      acceptedCount: v.number(),
      rejectedCount: v.number(),

      appliedCount: v.number(),
    }),
  )
    .index("by_orgId_batchRef", byOrg("batchRef"))
    .index("by_orgId_status_batchRef", byOrg("status", "batchRef")),

  receipts: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      purchaseOrderId: v.optional(v.id("purchaseOrders")),

      receiptNumber: v.string(),
      receivedByUserId: v.id("users"),

      occurredAt: v.number(),

      businessDate: v.string(),
    }),
  )
    .index("by_orgId_receiptNumber", byOrg("receiptNumber"))
    .index(
      "by_orgId_warehouseId_occurredAt",
      byOrg("warehouseId", "occurredAt"),
    )
    .index("by_orgId_purchaseOrderId", byOrg("purchaseOrderId")),

  receiptLines: defineTable(
    tenantFields({
      receiptId: v.id("receipts"),
      purchaseOrderLineId: v.optional(v.id("purchaseOrderLines")),
      itemId: v.id("items"),
      lotId: v.optional(v.id("lots")),
      handlingUnitId: v.optional(v.id("handlingUnits")),

      locationId: v.id("locations"),

      capturedQuantity: signedQuantity,

      baseMinorUnits: v.number(),
      kind: receiptLineKind,
      classification: receiptClassification,

      stockStatus,

      transactionId: v.id("inventoryTransactions"),

      overToleranceApproved: v.boolean(),
    }),
  )
    .index("by_orgId_receiptId", byOrg("receiptId"))
    .index("by_orgId_purchaseOrderLineId", byOrg("purchaseOrderLineId"))
    .index("by_orgId_itemId_stockStatus", byOrg("itemId", "stockStatus")),

  receivingExceptions: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      kind: receiptLineKind,

      itemId: v.optional(v.id("items")),
      purchaseOrderId: v.optional(v.id("purchaseOrders")),
      reasonCodeId: v.id("reasonCodes"),

      raisedByUserId: v.id("users"),
      raisedAt: v.optional(v.number()),
      status: receivingExceptionStatus,
      note: v.optional(v.string()),
    }),
  )
    .index(
      "by_orgId_warehouseId_status_kind",
      byOrg("warehouseId", "status", "kind"),
    )
    .index("by_orgId_itemId_status", byOrg("itemId", "status")),

  qcProfiles: defineTable(
    tenantFields({
      itemId: v.optional(v.id("items")),
      supplierId: v.optional(v.id("suppliers")),
      enabled: v.boolean(),
      strategy: samplingStrategy,

      parameter: v.optional(v.number()),
    }),
  )
    .index("by_orgId_itemId", byOrg("itemId"))
    .index("by_orgId_supplierId", byOrg("supplierId")),

  qcInspections: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      receiptLineId: v.id("receiptLines"),
      itemId: v.id("items"),
      status: inspectionStatus,
      strategy: samplingStrategy,
      sampleSize: v.number(),
      lotSize: v.number(),

      disposition: v.optional(qcDisposition),
      reasonCodeId: v.optional(v.id("reasonCodes")),

      submittedByUserId: v.optional(v.id("users")),
      approvedByUserId: v.optional(v.id("users")),

      transactionId: v.optional(v.id("inventoryTransactions")),
    }),
  )
    .index("by_orgId_receiptLineId", byOrg("receiptLineId"))
    .index("by_orgId_warehouseId_status", byOrg("warehouseId", "status")),

  labelPrintJobs: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      labelTemplateId: v.id("labelTemplates"),

      templateCode: v.string(),
      templateVersion: v.number(),

      targetKind: v.string(),
      targetId: v.string(),
      payload: v.string(),
      payloadHash: v.string(),
      reason: printReason,
      status: printJobStatus,
      requestedByUserId: v.id("users"),
      occurredAt: v.number(),
    }),
  )
    .index(
      "by_orgId_warehouseId_occurredAt",
      byOrg("warehouseId", "occurredAt"),
    )
    .index("by_orgId_targetKind_targetId", byOrg("targetKind", "targetId"))
    .index("by_orgId_payloadHash", byOrg("payloadHash")),

  putawayTasks: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      receiptLineId: v.id("receiptLines"),
      itemId: v.id("items"),
      lotId: v.optional(v.id("lots")),
      handlingUnitId: v.optional(v.id("handlingUnits")),

      baseMinorUnits: v.number(),

      fromLocationId: v.id("locations"),
      status: putawayTaskStatus,
      claimedByUserId: v.optional(v.id("users")),
      claimedAt: v.optional(v.number()),

      recommendedLocationId: v.optional(v.id("locations")),

      recommendationTrace: v.optional(v.string()),

      chosenLocationId: v.optional(v.id("locations")),

      overrideReasonCodeId: v.optional(v.id("reasonCodes")),

      transactionId: v.optional(v.id("inventoryTransactions")),
    }),
  )
    .index("by_orgId_warehouseId_status", byOrg("warehouseId", "status"))
    .index("by_orgId_receiptLineId", byOrg("receiptLineId"))
    .index(
      "by_orgId_claimedByUserId_status",
      byOrg("claimedByUserId", "status"),
    ),

  operationsRollups: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      metric: rollupMetric,

      subjectKey: v.string(),

      count: v.number(),
      updatedAt: v.number(),

      underflowAt: v.optional(v.number()),
    }),
  )
    // One row per (site, metric, subject); also the bounded per-metric page.
    .index(
      "by_orgId_warehouseId_metric_subjectKey",
      byOrg("warehouseId", "metric", "subjectKey"),
    ),

  dashboardPreferences: defineTable(
    tenantFields({
      membershipId: v.id("memberships"),
      pageKey: v.string(),
      presetVersion: v.number(),
      quickActionIds: v.array(v.string()),
      widgetIds: v.array(v.string()),
      hiddenWidgetIds: v.array(v.string()),
      updatedAt: v.number(),
    }),
  ).index("by_orgId_membershipId_pageKey", byOrg("membershipId", "pageKey")),

  reportJobs: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      kind: reportKind,
      status: reportJobStatus,

      requestedByUserId: v.id("users"),
      requestedAt: v.number(),

      requestId: v.string(),

      cursor: v.optional(v.string()),
      rowCount: v.number(),

      artifact: v.string(),
      artifactBytes: v.number(),

      checksum: v.optional(v.string()),
      completedAt: v.optional(v.number()),

      failureCode: v.optional(v.string()),
    }),
  )
    // The register: this site's exports, newest handled by the caller's ordering.
    .index("by_orgId_warehouseId_status", byOrg("warehouseId", "status"))
    // Replay-by-reconstruction for a repeated request (`INV-0011-02`).
    .index("by_orgId_requestId", byOrg("requestId")),

  openingStockBatches: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),

      batchRef: v.string(),
      status: openingStockBatchStatus,
      sourceFileName: v.string(),

      sourceHash: v.string(),
      cutoffAt: v.number(),
      reasonCodeId: v.id("reasonCodes"),
      declaredRowCount: v.number(),
      importedRowCount: v.number(),
      validRowCount: v.number(),
      validationErrorCount: v.number(),
      postedRowCount: v.number(),
      createdByUserId: v.id("users"),
      createdAt: v.number(),
      submittedByUserId: v.optional(v.id("users")),
      submittedAt: v.optional(v.number()),
      approvedByUserId: v.optional(v.id("users")),
      approvedAt: v.optional(v.number()),
      postingStartedAt: v.optional(v.number()),
      postedByUserId: v.optional(v.id("users")),
      postedAt: v.optional(v.number()),
      rejectedByUserId: v.optional(v.id("users")),
      rejectedAt: v.optional(v.number()),
      rejectionReason: v.optional(v.string()),
    }),
  )
    .index("by_orgId_batchRef", byOrg("batchRef"))
    .index(
      "by_orgId_warehouseId_status_createdAt",
      byOrg("warehouseId", "status", "createdAt"),
    ),

  openingStockRows: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      openingStockBatchId: v.id("openingStockBatches"),
      sourceRowNumber: v.number(),
      status: openingStockRowStatus,
      sourceSku: v.string(),
      sourceLocationCode: v.string(),
      sourceLotCode: v.optional(v.string()),
      sourceStockStatus: v.string(),
      entryUom: v.string(),
      entryMinorUnits: v.number(),
      itemId: v.optional(v.id("items")),
      locationId: v.optional(v.id("locations")),
      lotId: v.optional(v.id("lots")),
      baseUom: v.optional(v.string()),
      baseMinorUnits: v.optional(v.number()),

      validationCode: v.optional(v.string()),
      postedTransactionId: v.optional(v.id("inventoryTransactions")),
      importedAt: v.number(),
    }),
  )
    .index(
      "by_orgId_openingStockBatchId_sourceRowNumber",
      byOrg("openingStockBatchId", "sourceRowNumber"),
    )
    .index(
      "by_orgId_openingStockBatchId_status_sourceRowNumber",
      byOrg("openingStockBatchId", "status", "sourceRowNumber"),
    ),

  /** Durable replay result for one bounded row-import command. */
  openingStockImportChunks: defineTable(
    tenantFields({
      openingStockBatchId: v.id("openingStockBatches"),
      startSourceRowNumber: v.number(),
      requestId: v.string(),
      rowCount: v.number(),
      validRowCount: v.number(),
      validationErrorCount: v.number(),
      importedByUserId: v.id("users"),
      importedAt: v.number(),
    }),
  )
    .index(
      "by_orgId_openingStockBatchId_startSourceRowNumber",
      byOrg("openingStockBatchId", "startSourceRowNumber"),
    )
    .index("by_orgId_requestId", byOrg("requestId")),

  /** One ledger-sized posting chunk; the stable request ID makes retries replay. */
  openingStockPostChunks: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      openingStockBatchId: v.id("openingStockBatches"),
      chunkNumber: v.number(),
      firstSourceRowNumber: v.number(),
      lastSourceRowNumber: v.number(),
      rowCount: v.number(),
      requestId: v.string(),
      status: openingStockPostChunkStatus,
      transactionId: v.optional(v.id("inventoryTransactions")),
      postedByUserId: v.optional(v.id("users")),
      postedAt: v.optional(v.number()),
    }),
  )
    .index(
      "by_orgId_openingStockBatchId_chunkNumber",
      byOrg("openingStockBatchId", "chunkNumber"),
    )
    .index(
      "by_orgId_openingStockBatchId_status_chunkNumber",
      byOrg("openingStockBatchId", "status", "chunkNumber"),
    )
    .index("by_orgId_requestId", byOrg("requestId")),

  countPlans: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      planNumber: v.string(),
      status: countPlanStatus,
      scope: countScope,
      visibility: countVisibility,
      movementPolicy: countMovementPolicy,
      freezeExpiresAt: v.optional(v.number()),
      quantityThresholdBaseMinorUnits: v.number(),
      valueThresholdMinorUnits: v.number(),
      taskCount: v.number(),
      completedTaskCount: v.number(),
      varianceTaskCount: v.number(),
      createdByUserId: v.id("users"),
      createdAt: v.number(),
      releasedByUserId: v.optional(v.id("users")),
      releasedAt: v.optional(v.number()),
      completedByUserId: v.optional(v.id("users")),
      completedAt: v.optional(v.number()),
      cancelledByUserId: v.optional(v.id("users")),
      cancelledAt: v.optional(v.number()),
      cancellationReason: v.optional(v.string()),
    }),
  )
    .index("by_orgId_planNumber", byOrg("planNumber"))
    .index(
      "by_orgId_warehouseId_status_createdAt",
      byOrg("warehouseId", "status", "createdAt"),
    ),

  countTasks: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      countPlanId: v.id("countPlans"),
      taskNumber: v.number(),
      locationId: v.id("locations"),
      status: countTaskStatus,
      firstCounterUserId: v.optional(v.id("users")),
      secondCounterUserId: v.optional(v.id("users")),
      activeCounterUserId: v.optional(v.id("users")),
      activeCountOrdinal: v.optional(v.number()),
      submittedCountOrdinal: v.optional(v.number()),
      firstSubmittedAt: v.optional(v.number()),
      secondSubmittedAt: v.optional(v.number()),
      entryCount: v.number(),
      recountRequestedByUserId: v.optional(v.id("users")),
      recountRequestedAt: v.optional(v.number()),
      recountReason: v.optional(v.string()),
      lastDiscardedByUserId: v.optional(v.id("users")),
      lastDiscardedAt: v.optional(v.number()),
      lastDiscardReason: v.optional(v.string()),
      reconciledByUserId: v.optional(v.id("users")),
      reconciledAt: v.optional(v.number()),
    }),
  )
    .index(
      "by_orgId_countPlanId_taskNumber",
      byOrg("countPlanId", "taskNumber"),
    )
    .index(
      "by_orgId_warehouseId_status_taskNumber",
      byOrg("warehouseId", "status", "taskNumber"),
    ),

  countSnapshots: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      countPlanId: v.id("countPlans"),
      countTaskId: v.id("countTasks"),
      bucketKey: v.string(),
      itemId: v.id("items"),
      locationId: v.id("locations"),
      lotId: v.optional(v.id("lots")),
      stockStatus,
      baseUom: v.string(),
      systemBaseMinorUnits: v.number(),
      inCountMovementBaseMinorUnits: v.number(),
      itemClass: v.string(),
      unitValueMinorUnits: v.number(),
      lastLedgerTransactionId: v.optional(v.id("inventoryTransactions")),
      capturedAt: v.number(),
    }),
  )
    .index("by_orgId_countTaskId_bucketKey", byOrg("countTaskId", "bucketKey"))
    .index("by_orgId_countPlanId_bucketKey", byOrg("countPlanId", "bucketKey")),

  countEntries: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      countPlanId: v.id("countPlans"),
      countTaskId: v.id("countTasks"),
      countSnapshotId: v.id("countSnapshots"),
      countOrdinal: v.number(),
      source: countEntrySource,
      entryUom: v.string(),
      entryMinorUnits: v.number(),
      baseUom: v.string(),
      baseMinorUnits: v.number(),
      capturedByUserId: v.id("users"),
      capturedAt: v.number(),
      paperEvidenceId: v.optional(v.string()),
    }),
  ).index(
    "by_orgId_countSnapshotId_countOrdinal",
    byOrg("countSnapshotId", "countOrdinal"),
  ),

  countReconciliations: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      countPlanId: v.id("countPlans"),
      countTaskId: v.id("countTasks"),
      countSnapshotId: v.id("countSnapshots"),
      status: countReconciliationStatus,
      risk: varianceRisk,
      systemSnapshotBaseMinorUnits: v.number(),
      inCountMovementBaseMinorUnits: v.number(),
      physicalBaseMinorUnits: v.number(),
      varianceBaseMinorUnits: v.number(),
      absoluteVarianceValueMinorUnits: v.number(),
      rootCauseCode: v.optional(v.string()),
      counterUserId: v.id("users"),
      approvedByUserId: v.optional(v.id("users")),
      approvedAt: v.optional(v.number()),
      stepUpApprovalId: v.optional(v.id("stepUpApprovals")),
      postRequestId: v.optional(v.string()),
      transactionId: v.optional(v.id("inventoryTransactions")),
      postedAt: v.optional(v.number()),
    }),
  )
    .index("by_orgId_countSnapshotId", byOrg("countSnapshotId"))
    .index("by_orgId_warehouseId_status", byOrg("warehouseId", "status")),

  countPaperCaptures: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      countTaskId: v.id("countTasks"),
      captureOrdinal: v.number(),
      sheetHash: v.string(),
      lineCount: v.number(),
      evidenceId: v.string(),
      enteredByUserId: v.id("users"),
      enteredAt: v.number(),
    }),
  ).index(
    "by_orgId_countTaskId_captureOrdinal",
    byOrg("countTaskId", "captureOrdinal"),
  ),

  inventoryTransactions: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      type: inventoryTransactionType,

      operation: v.string(),

      requestId: v.string(),
      actorUserId: v.id("users"),
      deviceId: v.optional(v.id("devices")),

      occurredAt: v.number(),

      businessDate: v.string(),
      source: inventoryTransactionSource,

      reversalOfTransactionId: v.optional(v.id("inventoryTransactions")),
      reasonCodeId: v.optional(v.id("reasonCodes")),
      lineCount: v.number(),
      conservationGroupCount: v.number(),
    }),
  )
    // The replay check on the hot path of every posting, and the uniqueness
    // contract the mutation owes.
    .index("by_orgId_operation_requestId", byOrg("operation", "requestId"))
    // History for one site, newest last. The screens in §7.3 read this.
    .index(
      "by_orgId_warehouseId_occurredAt",
      byOrg("warehouseId", "occurredAt"),
    )
    // "Has this transaction already been reversed?" — one bounded read
    // (`INV-0003-08`).
    .index("by_orgId_reversalOfTransactionId", byOrg("reversalOfTransactionId"))
    // Tenant-wide chronological paging, for reconciliation and export.
    .index("by_orgId_occurredAt", byOrg("occurredAt")),

  inventoryLedgerLines: defineTable(
    tenantFields({
      transactionId: v.id("inventoryTransactions"),

      lineIndex: v.number(),

      warehouseId: v.id("warehouses"),
      occurredAt: v.number(),
      itemId: v.id("items"),
      locationKind: ledgerLocationKind,

      locationId: v.optional(v.id("locations")),

      virtualBoundary: v.optional(virtualBoundaryCode),
      lotId: v.optional(v.id("lots")),

      serialId: v.optional(v.string()),
      handlingUnitId: v.optional(v.id("handlingUnits")),
      ownerId: v.optional(v.id("owners")),
      stockStatus,

      bucketKey: v.string(),

      conservationKey: v.string(),

      quantity: signedQuantity,
    }),
  )
    // The lines of one transaction, in canonical order. Also the uniqueness
    // contract for `(transactionId, lineIndex)`.
    .index(
      "by_orgId_transactionId_lineIndex",
      byOrg("transactionId", "lineIndex"),
    )
    // Replay of one bucket, oldest first: what reconciliation pages.
    .index("by_orgId_bucketKey_occurredAt", byOrg("bucketKey", "occurredAt"))
    // Item and lot history for the inventory screens (`inventory.history.read`).
    .index(
      "by_orgId_warehouseId_itemId_occurredAt",
      byOrg("warehouseId", "itemId", "occurredAt"),
    )
    .index(
      "by_orgId_warehouseId_occurredAt",
      byOrg("warehouseId", "occurredAt"),
    ),

  inventoryBalances: defineTable(
    tenantFields({
      bucketKey: v.string(),
      warehouseId: v.id("warehouses"),
      itemId: v.id("items"),
      locationKind: ledgerLocationKind,
      locationId: v.optional(v.id("locations")),
      virtualBoundary: v.optional(virtualBoundaryCode),
      lotId: v.optional(v.id("lots")),
      serialId: v.optional(v.string()),
      handlingUnitId: v.optional(v.id("handlingUnits")),
      ownerId: v.optional(v.id("owners")),
      stockStatus,

      quantity: signedQuantity,

      lastTransactionId: v.id("inventoryTransactions"),
      updatedAt: v.number(),
    }),
  )
    // The posting path's lookup, and the uniqueness contract it owes.
    .index("by_orgId_bucketKey", byOrg("bucketKey"))
    // Bounded pages for reconciliation and for a warehouse's balance screen.
    .index("by_orgId_warehouseId_bucketKey", byOrg("warehouseId", "bucketKey"))
    .index(
      "by_orgId_handlingUnitId_bucketKey",
      byOrg("handlingUnitId", "bucketKey"),
    )
    .index("by_orgId_locationId_bucketKey", byOrg("locationId", "bucketKey"))
    // "What is on hand for this item, in this status, at this site" — the
    // question `inventory.balance.read` answers.
    .index(
      "by_orgId_warehouseId_itemId_stockStatus",
      byOrg("warehouseId", "itemId", "stockStatus"),
    ),

  customers: defineTable(
    tenantFields({
      code: v.string(),

      name: v.string(),
      status: masterDataStatus,
    }),
  )
    .index("by_orgId_code", byOrg("code"))
    .index("by_orgId_status_code", byOrg("status", "code")),

  customerOrders: defineTable(
    tenantFields({
      orderNumber: v.string(),
      customerId: v.id("customers"),

      customerReference: v.optional(v.string()),
      status: customerOrderStatus,

      orderedAt: v.number(),
    }),
  )
    .index("by_orgId_orderNumber", byOrg("orderNumber"))
    .index(
      "by_orgId_customerId_customerReference",
      byOrg("customerId", "customerReference"),
    )
    .index("by_orgId_status_orderNumber", byOrg("status", "orderNumber")),

  customerOrderLines: defineTable(
    tenantFields({
      customerOrderId: v.id("customerOrders"),

      lineNumber: v.number(),

      customerProductCode: v.string(),
      specification: boxSpecification,

      designKey: v.string(),
      designSource,
      status: customerOrderLineStatus,

      orderedQuantity: v.number(),

      masterCardRevisionId: v.optional(v.id("masterCardRevisions")),
    }),
  )
    .index(
      "by_orgId_customerOrderId_lineNumber",
      byOrg("customerOrderId", "lineNumber"),
    )
    .index(
      "by_orgId_customerOrderId_status",
      byOrg("customerOrderId", "status"),
    )
    .index("by_orgId_status_designKey", byOrg("status", "designKey")),

  fulfillmentOrders: defineTable(
    tenantFields({
      fulfillmentNumber: v.string(),
      customerOrderId: v.id("customerOrders"),
      customerId: v.id("customers"),
      warehouseId: v.id("warehouses"),
      status: fulfillmentOrderStatus,
      routeDecision: fulfillmentOrderRouteDecision,
      routeVersion: v.number(),
      allowPartial: v.boolean(),
      requestedDeliveryAt: v.optional(v.number()),
      shipTo: v.object({
        name: v.string(),
        addressLine1: v.string(),
        addressLine2: v.optional(v.string()),
        district: v.optional(v.string()),
        province: v.string(),
        postalCode: v.optional(v.string()),
        countryCode: v.string(),
        recipientName: v.optional(v.string()),
        recipientPhone: v.optional(v.string()),
      }),
      releasedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      cancelledAt: v.optional(v.number()),
      createdByUserId: v.id("users"),
    }),
  )
    .index("by_orgId_fulfillmentNumber", byOrg("fulfillmentNumber"))
    .index(
      "by_orgId_customerOrderId_warehouseId",
      byOrg("customerOrderId", "warehouseId"),
    )
    .index(
      "by_orgId_warehouseId_status_fulfillmentNumber",
      byOrg("warehouseId", "status", "fulfillmentNumber"),
    ),

  fulfillmentLines: defineTable(
    tenantFields({
      fulfillmentOrderId: v.id("fulfillmentOrders"),
      customerOrderLineId: v.id("customerOrderLines"),
      warehouseId: v.id("warehouses"),
      itemId: v.id("items"),
      baseUom: v.string(),
      orderedBaseMinorUnits: v.number(),
      routeDecision: v.optional(fulfillmentRouteDecision),
      routeVersion: v.optional(v.number()),
      routedAt: v.optional(v.number()),
      productionShortageBaseMinorUnits: v.optional(v.number()),
      availableStockPlannedBaseMinorUnits: v.optional(v.number()),
      status: fulfillmentLineStatus,
      quantities: v.object({
        DEMAND: v.number(),
        RESERVED: v.number(),
        PICKING: v.number(),
        STAGED: v.number(),
        ISSUED: v.number(),
        LOADED: v.number(),
        DELIVERED: v.number(),
        RETURNED: v.number(),
        BACKORDERED: v.number(),
        CANCELLED: v.number(),
      }),
      cancellationReason: v.optional(v.string()),
      cancelledAt: v.optional(v.number()),
      cancelledByUserId: v.optional(v.id("users")),
      createdByUserId: v.id("users"),
    }),
  )
    .index(
      "by_orgId_fulfillmentOrderId_customerOrderLineId",
      byOrg("fulfillmentOrderId", "customerOrderLineId"),
    )
    .index("by_orgId_customerOrderLineId", byOrg("customerOrderLineId"))
    .index(
      "by_orgId_warehouseId_itemId_routedAt",
      byOrg("warehouseId", "itemId", "routedAt"),
    )
    .index(
      "by_orgId_warehouseId_status_fulfillmentOrderId",
      byOrg("warehouseId", "status", "fulfillmentOrderId"),
    ),

  fulfillmentAllocationRuns: defineTable(
    tenantFields({
      fulfillmentLineId: v.id("fulfillmentLines"),
      warehouseId: v.id("warehouses"),
      itemId: v.id("items"),
      strategy: allocationStrategy,
      allowPartial: v.boolean(),
      asOfBusinessDate: v.string(),
      requestedBaseMinorUnits: v.number(),
      atpBaseMinorUnits: v.number(),
      reservedBaseMinorUnits: v.number(),
      backorderedBaseMinorUnits: v.number(),
      reservationCount: v.number(),
      createdAt: v.number(),
      createdByUserId: v.id("users"),
    }),
  ).index(
    "by_orgId_fulfillmentLineId_createdAt",
    byOrg("fulfillmentLineId", "createdAt"),
  ),

  inventoryReservations: defineTable(
    tenantFields({
      allocationRunId: v.id("fulfillmentAllocationRuns"),
      fulfillmentOrderId: v.id("fulfillmentOrders"),
      fulfillmentLineId: v.id("fulfillmentLines"),
      warehouseId: v.id("warehouses"),
      itemId: v.id("items"),
      bucketKey: v.string(),
      locationId: v.id("locations"),
      lotId: v.optional(v.id("lots")),
      baseUom: v.string(),
      baseMinorUnits: v.number(),
      status: inventoryReservationStatus,
      expiresAt: v.number(),
      rotationRank: v.number(),
      rotationExplanation: v.array(
        v.object({ criterion: v.string(), value: v.string() }),
      ),
      consumedBaseMinorUnits: v.number(),
      releasedBaseMinorUnits: v.number(),
      createdAt: v.number(),
      createdByUserId: v.id("users"),
      releasedAt: v.optional(v.number()),
      releaseReason: v.optional(v.string()),
    }),
  )
    .index(
      "by_orgId_allocationRunId_bucketKey",
      byOrg("allocationRunId", "bucketKey"),
    )
    .index(
      "by_orgId_fulfillmentLineId_status_bucketKey",
      byOrg("fulfillmentLineId", "status", "bucketKey"),
    )
    .index(
      "by_orgId_fulfillmentOrderId_status_bucketKey",
      byOrg("fulfillmentOrderId", "status", "bucketKey"),
    )
    .index(
      "by_orgId_warehouseId_itemId_status_expiresAt",
      byOrg("warehouseId", "itemId", "status", "expiresAt"),
    )
    .index(
      "by_orgId_warehouseId_status_itemId",
      byOrg("warehouseId", "status", "itemId"),
    )
    .index(
      "by_orgId_warehouseId_bucketKey_status",
      byOrg("warehouseId", "bucketKey", "status"),
    ),

  pickWaves: defineTable(
    tenantFields({
      waveNumber: v.string(),
      warehouseId: v.id("warehouses"),
      fulfillmentOrderId: v.id("fulfillmentOrders"),
      status: pickWaveStatus,
      taskCount: v.number(),
      completedTaskCount: v.number(),
      createdByUserId: v.id("users"),
      createdAt: v.number(),
      releasedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
    }),
  )
    .index("by_orgId_waveNumber", byOrg("waveNumber"))
    .index(
      "by_orgId_fulfillmentOrderId_waveNumber",
      byOrg("fulfillmentOrderId", "waveNumber"),
    )
    .index(
      "by_orgId_warehouseId_status_waveNumber",
      byOrg("warehouseId", "status", "waveNumber"),
    ),

  pickTasks: defineTable(
    tenantFields({
      pickWaveId: v.id("pickWaves"),
      taskNumber: v.number(),
      warehouseId: v.id("warehouses"),
      fulfillmentOrderId: v.id("fulfillmentOrders"),
      fulfillmentLineId: v.id("fulfillmentLines"),
      status: pickTaskStatus,
      lineCount: v.number(),
      eventCount: v.number(),
      pickerUserId: v.optional(v.id("users")),
      checkerUserId: v.optional(v.id("users")),
      packerUserId: v.optional(v.id("users")),
      stagingLocationId: v.optional(v.id("locations")),
      startedAt: v.optional(v.number()),
      pickedAt: v.optional(v.number()),
      checkedAt: v.optional(v.number()),
      packedAt: v.optional(v.number()),
      stagedAt: v.optional(v.number()),
      issuedAt: v.optional(v.number()),
    }),
  )
    .index("by_orgId_pickWaveId_taskNumber", byOrg("pickWaveId", "taskNumber"))
    .index(
      "by_orgId_pickWaveId_fulfillmentLineId",
      byOrg("pickWaveId", "fulfillmentLineId"),
    )
    .index(
      "by_orgId_warehouseId_status_taskNumber",
      byOrg("warehouseId", "status", "taskNumber"),
    ),

  pickTaskLines: defineTable(
    tenantFields({
      pickTaskId: v.id("pickTasks"),
      lineNumber: v.number(),
      inventoryReservationId: v.id("inventoryReservations"),
      warehouseId: v.id("warehouses"),
      itemId: v.id("items"),
      locationId: v.id("locations"),
      lotId: v.optional(v.id("lots")),
      bucketKey: v.string(),
      baseUom: v.string(),
      plannedBaseMinorUnits: v.number(),
      pickedBaseMinorUnits: v.number(),
      shortBaseMinorUnits: v.number(),
      damagedBaseMinorUnits: v.number(),
      status: pickTaskLineStatus,
    }),
  )
    .index("by_orgId_pickTaskId_lineNumber", byOrg("pickTaskId", "lineNumber"))
    .index("by_orgId_inventoryReservationId", byOrg("inventoryReservationId")),

  pickEvents: defineTable(
    tenantFields({
      pickTaskId: v.id("pickTasks"),
      pickTaskLineId: v.id("pickTaskLines"),
      sequence: v.number(),
      kind: pickEventKind,
      baseUom: v.string(),
      baseMinorUnits: v.number(),
      reason: v.optional(v.string()),
      actorUserId: v.id("users"),
      occurredAt: v.number(),
    }),
  ).index("by_orgId_pickTaskId_sequence", byOrg("pickTaskId", "sequence")),

  fulfillmentPackages: defineTable(
    tenantFields({
      packageNumber: v.string(),
      pickTaskId: v.id("pickTasks"),
      fulfillmentOrderId: v.id("fulfillmentOrders"),
      warehouseId: v.id("warehouses"),
      status: fulfillmentPackageStatus,
      baseUom: v.string(),
      packedBaseMinorUnits: v.number(),
      stagingLocationId: v.optional(v.id("locations")),
      packedByUserId: v.id("users"),
      packedAt: v.number(),
      stagedAt: v.optional(v.number()),
      issuedTransactionId: v.optional(v.id("inventoryTransactions")),
      issueReversalTransactionId: v.optional(v.id("inventoryTransactions")),
      issueReversedAt: v.optional(v.number()),
    }),
  )
    .index("by_orgId_packageNumber", byOrg("packageNumber"))
    .index("by_orgId_pickTaskId", byOrg("pickTaskId"))
    .index(
      "by_orgId_warehouseId_status_packageNumber",
      byOrg("warehouseId", "status", "packageNumber"),
    ),

  shipments: defineTable(
    tenantFields({
      shipmentNumber: v.string(),
      fulfillmentOrderId: v.id("fulfillmentOrders"),
      warehouseId: v.id("warehouses"),
      status: shipmentStatus,
      expectedPackageCount: v.number(),
      loadedPackageCount: v.number(),
      tripId: v.optional(v.id("trips")),
      requestedDeliveryAt: v.optional(v.number()),
      createdByUserId: v.id("users"),
      createdAt: v.number(),
      releasedAt: v.optional(v.number()),
      loadedAt: v.optional(v.number()),
      gatedOutAt: v.optional(v.number()),
      departedAt: v.optional(v.number()),
      deliveredAt: v.optional(v.number()),
      failedAt: v.optional(v.number()),
      failureReason: v.optional(v.string()),
      returnedAt: v.optional(v.number()),
      returnLocationId: v.optional(v.id("locations")),
      returnTransactionId: v.optional(v.id("inventoryTransactions")),
      returnReason: v.optional(v.string()),
    }),
  )
    .index("by_orgId_shipmentNumber", byOrg("shipmentNumber"))
    .index(
      "by_orgId_fulfillmentOrderId_shipmentNumber",
      byOrg("fulfillmentOrderId", "shipmentNumber"),
    )
    .index(
      "by_orgId_warehouseId_status_shipmentNumber",
      byOrg("warehouseId", "status", "shipmentNumber"),
    )
    .index("by_orgId_tripId_shipmentNumber", byOrg("tripId", "shipmentNumber")),

  shipmentPackages: defineTable(
    tenantFields({
      shipmentId: v.id("shipments"),
      fulfillmentPackageId: v.id("fulfillmentPackages"),
      warehouseId: v.id("warehouses"),
      status: shipmentPackageStatus,
      loadedByUserId: v.optional(v.id("users")),
      loadedAt: v.optional(v.number()),
      deliveredAt: v.optional(v.number()),
      returnedAt: v.optional(v.number()),
    }),
  )
    .index(
      "by_orgId_shipmentId_fulfillmentPackageId",
      byOrg("shipmentId", "fulfillmentPackageId"),
    )
    .index("by_orgId_fulfillmentPackageId", byOrg("fulfillmentPackageId")),

  trips: defineTable(
    tenantFields({
      tripNumber: v.string(),
      warehouseId: v.id("warehouses"),
      status: tripStatus,
      vehicleRegistration: v.string(),
      driverName: v.string(),
      driverPhone: v.optional(v.string()),
      expectedShipmentCount: v.number(),
      expectedPackageCount: v.number(),
      loadedPackageCount: v.number(),
      sealNumber: v.optional(v.string()),
      createdByUserId: v.id("users"),
      createdAt: v.number(),
      releasedAt: v.optional(v.number()),
      loadingStartedAt: v.optional(v.number()),
      sealedAt: v.optional(v.number()),
      gatedOutAt: v.optional(v.number()),
      departedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
    }),
  )
    .index("by_orgId_tripNumber", byOrg("tripNumber"))
    .index(
      "by_orgId_warehouseId_status_tripNumber",
      byOrg("warehouseId", "status", "tripNumber"),
    ),

  tripShipments: defineTable(
    tenantFields({
      tripId: v.id("trips"),
      shipmentId: v.id("shipments"),
      warehouseId: v.id("warehouses"),
      sequence: v.number(),
    }),
  )
    .index("by_orgId_tripId_sequence", byOrg("tripId", "sequence"))
    .index("by_orgId_shipmentId", byOrg("shipmentId")),

  loadEvents: defineTable(
    tenantFields({
      tripId: v.id("trips"),
      shipmentId: v.id("shipments"),
      shipmentPackageId: v.id("shipmentPackages"),
      sequence: v.number(),
      actorUserId: v.id("users"),
      occurredAt: v.number(),
    }),
  ).index("by_orgId_tripId_sequence", byOrg("tripId", "sequence")),

  gatePasses: defineTable(
    tenantFields({
      gatePassNumber: v.string(),
      tripId: v.id("trips"),
      warehouseId: v.id("warehouses"),
      sealNumber: v.string(),
      vehicleRegistration: v.string(),
      releasedByUserId: v.id("users"),
      releasedAt: v.number(),
    }),
  )
    .index("by_orgId_gatePassNumber", byOrg("gatePassNumber"))
    .index("by_orgId_tripId", byOrg("tripId")),

  /** Append-only driver milestones, including failed and return events. */
  deliveryMilestones: defineTable(
    tenantFields({
      tripId: v.id("trips"),
      shipmentId: v.id("shipments"),
      sequence: v.number(),
      kind: deliveryMilestoneKind,
      latitudeE6: v.optional(v.number()),
      longitudeE6: v.optional(v.number()),
      note: v.optional(v.string()),
      actorUserId: v.id("users"),
      capturedAt: v.number(),
      receivedAt: v.number(),
    }),
  ).index("by_orgId_shipmentId_sequence", byOrg("shipmentId", "sequence")),

  transportFiles: defineTable(
    tenantFields({
      shipmentId: v.id("shipments"),
      warehouseId: v.id("warehouses"),
      kind: transportFileKind,
      fileName: v.string(),
      mimeType: v.string(),
      sizeBytes: v.number(),
      digest: v.string(),
      storageObjectId: v.string(),
      storageState: transportFileStorageState,
      createdByUserId: v.id("users"),
      createdAt: v.number(),
    }),
  )
    .index(
      "by_orgId_shipmentId_kind_createdAt",
      byOrg("shipmentId", "kind", "createdAt"),
    )
    .index("by_orgId_storageObjectId", byOrg("storageObjectId")),

  transportFileUploadGrants: defineTable(
    tenantFields({
      shipmentId: v.id("shipments"),
      warehouseId: v.id("warehouses"),
      kind: transportFileKind,
      authorizedByUserId: v.id("users"),
      authorizedClerkUserId: v.string(),
      expiresAt: v.number(),
      uploadStartedAt: v.number(),
      consumedUploadThingKey: v.optional(v.string()),
      consumedContentDigest: v.optional(v.string()),
      consumedContentType: v.optional(v.string()),
      consumedByteSize: v.optional(v.number()),
      consumedAt: v.optional(v.number()),
      attachedAt: v.optional(v.number()),
    }),
  ).index("by_orgId_shipmentId_expiresAt", byOrg("shipmentId", "expiresAt")),

  transportFileAccessGrants: defineTable(
    tenantFields({
      transportFileId: v.id("transportFiles"),
      warehouseId: v.id("warehouses"),
      issuedToUserId: v.id("users"),
      expiresAt: v.number(),
      consumedAt: v.optional(v.number()),
    }),
  ).index(
    "by_orgId_transportFileId_expiresAt",
    byOrg("transportFileId", "expiresAt"),
  ),

  proofOfDeliveries: defineTable(
    tenantFields({
      shipmentId: v.id("shipments"),
      tripId: v.id("trips"),
      warehouseId: v.id("warehouses"),
      status: proofOfDeliveryStatus,
      recipientName: v.string(),
      recipientNote: v.optional(v.string()),
      transportFileId: v.id("transportFiles"),
      capturedByUserId: v.id("users"),
      capturedAt: v.number(),
      reviewedByUserId: v.optional(v.id("users")),
      reviewedAt: v.optional(v.number()),
      rejectionReason: v.optional(v.string()),
    }),
  )
    .index("by_orgId_shipmentId", byOrg("shipmentId"))
    .index(
      "by_orgId_warehouseId_status_capturedAt",
      byOrg("warehouseId", "status", "capturedAt"),
    ),

  documentReturns: defineTable(
    tenantFields({
      shipmentId: v.id("shipments"),
      warehouseId: v.id("warehouses"),
      status: documentReturnStatus,
      documentType: v.string(),
      transportFileId: v.optional(v.id("transportFiles")),
      receivedByUserId: v.optional(v.id("users")),
      receivedAt: v.optional(v.number()),
      note: v.optional(v.string()),
    }),
  ).index(
    "by_orgId_shipmentId_documentType",
    byOrg("shipmentId", "documentType"),
  ),

  transferRequests: defineTable(
    tenantFields({
      transferNumber: v.string(),
      sourceWarehouseId: v.id("warehouses"),
      destinationWarehouseId: v.id("warehouses"),
      sourceKind: transferSourceKind,
      sourceReference: v.optional(v.string()),
      purpose: v.string(),
      status: transferStatus,
      lineCount: v.number(),
      sealNumber: v.optional(v.string()),
      carrierName: v.optional(v.string()),
      expectedArrivalAt: v.optional(v.number()),
      discrepancyOwnerUserId: v.optional(v.id("users")),
      createdByUserId: v.id("users"),
      createdAt: v.number(),
      approvedByUserId: v.optional(v.id("users")),
      approvedAt: v.optional(v.number()),
      dispatchedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
    }),
  )
    .index("by_orgId_transferNumber", byOrg("transferNumber"))
    .index(
      "by_orgId_sourceWarehouseId_transferNumber",
      byOrg("sourceWarehouseId", "transferNumber"),
    )
    .index(
      "by_orgId_destinationWarehouseId_transferNumber",
      byOrg("destinationWarehouseId", "transferNumber"),
    )
    .index(
      "by_orgId_sourceWarehouseId_status_transferNumber",
      byOrg("sourceWarehouseId", "status", "transferNumber"),
    )
    .index(
      "by_orgId_destinationWarehouseId_status_transferNumber",
      byOrg("destinationWarehouseId", "status", "transferNumber"),
    ),

  transferLines: defineTable(
    tenantFields({
      transferRequestId: v.id("transferRequests"),
      lineNumber: v.number(),
      itemId: v.id("items"),
      baseUom: v.string(),
      quantities: v.object({
        REQUESTED: v.number(),
        DISPATCHED: v.number(),
        RECEIVED: v.number(),
        RETURNED: v.number(),
        DISCREPANCY: v.number(),
        CANCELLED: v.number(),
      }),
      sourceBucketKey: v.optional(v.string()),
      sourceLocationId: v.optional(v.id("locations")),
      lotId: v.optional(v.id("lots")),
      destinationLocationId: v.optional(v.id("locations")),
      dispatchTransactionId: v.optional(v.id("inventoryTransactions")),
      receiptTransactionId: v.optional(v.id("inventoryTransactions")),
      returnTransactionId: v.optional(v.id("inventoryTransactions")),
    }),
  )
    .index(
      "by_orgId_transferRequestId_lineNumber",
      byOrg("transferRequestId", "lineNumber"),
    )
    .index(
      "by_orgId_itemId_transferRequestId",
      byOrg("itemId", "transferRequestId"),
    ),

  /** Quantity that cannot be silently accepted or closed after destination receipt. */
  transferDiscrepancies: defineTable(
    tenantFields({
      transferRequestId: v.id("transferRequests"),
      transferLineId: v.id("transferLines"),
      kind: v.union(
        v.literal("MISSING"),
        v.literal("DAMAGED"),
        v.literal("WRONG_TAG"),
      ),
      baseUom: v.string(),
      baseMinorUnits: v.number(),
      status: transferDiscrepancyStatus,
      note: v.string(),
      resolutionNote: v.optional(v.string()),
      ownerUserId: v.id("users"),
      createdAt: v.number(),
      resolvedAt: v.optional(v.number()),
      resolvedByUserId: v.optional(v.id("users")),
      resolutionTransactionId: v.optional(v.id("inventoryTransactions")),
    }),
  )
    .index(
      "by_orgId_transferRequestId_status",
      byOrg("transferRequestId", "status"),
    )
    .index("by_orgId_ownerUserId_status", byOrg("ownerUserId", "status")),

  designRequests: defineTable(
    tenantFields({
      requestNumber: v.string(),

      customerOrderLineId: v.id("customerOrderLines"),
      status: designRequestStatus,
      priority: designRequestPriority,
      dueAt: v.optional(v.number()),

      assignedToUserId: v.optional(v.id("users")),

      masterCardRevisionId: v.optional(v.id("masterCardRevisions")),

      latestRequirementVersion: v.optional(v.number()),
      requirementReadiness: v.optional(
        v.union(v.literal("INCOMPLETE"), v.literal("READY")),
      ),
      missingRequirements: v.optional(v.array(designRequirementKey)),
      requirementsRecordedByUserId: v.optional(v.id("users")),
      requirementsRecordedAt: v.optional(v.number()),

      similarityConfirmation: v.optional(
        v.object({
          score: v.number(),
          reason: v.string(),
          confirmedByUserId: v.id("users"),
          confirmedAt: v.number(),
        }),
      ),
    }),
  )
    .index("by_orgId_requestNumber", byOrg("requestNumber"))
    .index("by_orgId_customerOrderLineId", byOrg("customerOrderLineId"))
    .index("by_orgId_status_requestNumber", byOrg("status", "requestNumber")),

  designRequirementVersions: defineTable(
    tenantFields({
      designRequestId: v.id("designRequests"),
      version: v.number(),
      confirmations: designRequirementConfirmations,
      status: v.union(v.literal("INCOMPLETE"), v.literal("READY")),
      missing: v.array(designRequirementKey),
      note: v.optional(v.string()),
      recordedByUserId: v.id("users"),
      recordedAt: v.number(),
    }),
  ).index(
    "by_orgId_designRequestId_version",
    byOrg("designRequestId", "version"),
  ),

  masterCards: defineTable(
    tenantFields({
      cardNumber: v.string(),
      customerId: v.id("customers"),

      customerProductCode: v.string(),

      designKey: v.string(),

      name: v.string(),

      legacySourceReference: v.optional(v.string()),
      status: masterDataStatus,

      releasedRevisionId: v.optional(v.id("masterCardRevisions")),
    }),
  )
    .index("by_orgId_cardNumber", byOrg("cardNumber"))
    .index(
      "by_orgId_customerId_customerProductCode",
      byOrg("customerId", "customerProductCode"),
    )
    .index("by_orgId_customerId_designKey", byOrg("customerId", "designKey"))
    .index("by_orgId_status_cardNumber", byOrg("status", "cardNumber")),

  masterCardRevisions: defineTable(
    tenantFields({
      masterCardId: v.id("masterCards"),

      revisionNumber: v.number(),
      status: masterCardRevisionStatus,
      specification: boxSpecification,

      designKey: v.string(),

      authoredByUserId: v.id("users"),

      submittedByUserId: v.optional(v.id("users")),

      decidedByUserId: v.optional(v.id("users")),
      decidedAt: v.optional(v.number()),

      decisionNote: v.optional(v.string()),

      supersededByRevisionId: v.optional(v.id("masterCardRevisions")),
      legacySourceReference: v.optional(v.string()),
    }),
  )
    .index(
      "by_orgId_masterCardId_revisionNumber",
      byOrg("masterCardId", "revisionNumber"),
    )
    .index("by_orgId_masterCardId_status", byOrg("masterCardId", "status"))
    .index("by_orgId_status_masterCardId", byOrg("status", "masterCardId")),

  designChangeImpacts: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      masterCardId: v.id("masterCards"),
      fromRevisionId: v.id("masterCardRevisions"),
      toRevisionId: v.id("masterCardRevisions"),
      productionOrderId: v.id("productionOrders"),
      productionOrderNumber: v.string(),
      productionOrderStatus: v.string(),
      severity: v.union(
        v.literal("NO_IMPACT"),
        v.literal("REVIEW_REQUIRED"),
        v.literal("BLOCKING"),
      ),
      changedFields: v.array(v.string()),
      categories: v.array(v.string()),
      status: v.union(v.literal("OPEN"), v.literal("ACKNOWLEDGED")),
      createdByUserId: v.id("users"),
      createdAt: v.number(),
      acknowledgedByUserId: v.optional(v.id("users")),
      acknowledgedAt: v.optional(v.number()),
      acknowledgementNote: v.optional(v.string()),
    }),
  )
    .index(
      "by_orgId_toRevisionId_productionOrderId",
      byOrg("toRevisionId", "productionOrderId"),
    )
    .index("by_orgId_status_createdAt", byOrg("status", "createdAt"))
    .index(
      "by_orgId_warehouseId_status_createdAt",
      byOrg("warehouseId", "status", "createdAt"),
    )
    .index(
      "by_orgId_productionOrderId_createdAt",
      byOrg("productionOrderId", "createdAt"),
    ),

  masterCardFiles: defineTable(
    tenantFields({
      masterCardRevisionId: v.id("masterCardRevisions"),

      fileKey: v.string(),

      fileName: v.string(),
      kind: masterCardFileKind,

      contentType: v.string(),

      byteSize: v.number(),

      contentDigest: v.string(),

      uploadThingKey: v.optional(v.string()),
      storageId: v.optional(v.id("_storage")),
      verifiedAt: v.optional(v.number()),
      storageState: masterCardFileStorageState,
      attachedByUserId: v.id("users"),
    }),
  )
    .index(
      "by_orgId_masterCardRevisionId_fileKey",
      byOrg("masterCardRevisionId", "fileKey"),
    )
    .index(
      "by_orgId_masterCardRevisionId_storageState",
      byOrg("masterCardRevisionId", "storageState"),
    ),

  masterCardUploadGrants: defineTable(
    tenantFields({
      masterCardRevisionId: v.optional(v.id("masterCardRevisions")),
      batchRef: v.optional(v.string()),
      sourceRow: v.optional(v.number()),
      authorizedByUserId: v.id("users"),

      authorizedClerkUserId: v.optional(v.string()),
      expiresAt: v.number(),
      uploadStartedAt: v.optional(v.number()),
      consumedStorageId: v.optional(v.id("_storage")),
      consumedUploadThingKey: v.optional(v.string()),
      consumedContentDigest: v.optional(v.string()),
      consumedContentType: v.optional(v.string()),
      consumedByteSize: v.optional(v.number()),
      consumedAt: v.optional(v.number()),
      attachedAt: v.optional(v.number()),
    }),
  )
    .index("by_orgId_expiresAt", byOrg("expiresAt"))
    .index(
      "by_orgId_masterCardRevisionId_expiresAt",
      byOrg("masterCardRevisionId", "expiresAt"),
    )
    .index(
      "by_orgId_batchRef_sourceRow_expiresAt",
      byOrg("batchRef", "sourceRow", "expiresAt"),
    ),

  masterCardFileAccessGrants: defineTable(
    tenantFields({
      masterCardFileId: v.id("masterCardFiles"),
      warehouseId: v.optional(v.id("warehouses")),
      issuedToUserId: v.id("users"),
      expiresAt: v.number(),
      consumedAt: v.optional(v.number()),
    }),
  ).index(
    "by_orgId_masterCardFileId_expiresAt",
    byOrg("masterCardFileId", "expiresAt"),
  ),

  masterCardImportChunks: defineTable(
    tenantFields({
      batchRef: v.string(),
      startSourceRow: v.number(),
      nextSourceRow: v.number(),
      importedCount: v.number(),
      releasedCount: v.number(),
      draftCount: v.number(),
      importedByUserId: v.id("users"),
      completedAt: v.number(),
    }),
  )
    .index(
      "by_orgId_batchRef_startSourceRow",
      byOrg("batchRef", "startSourceRow"),
    )
    .index(
      "by_orgId_batchRef_nextSourceRow",
      byOrg("batchRef", "nextSourceRow"),
    ),

  factoryPackets: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),

      packetNumber: v.string(),

      customerOrderLineId: v.id("customerOrderLines"),

      fulfillmentLineId: v.optional(v.id("fulfillmentLines")),

      masterCardRevisionId: v.id("masterCardRevisions"),
      status: factoryPacketStatus,
      issuedByUserId: v.id("users"),
      acknowledgedByUserId: v.optional(v.id("users")),
      acknowledgedAt: v.optional(v.number()),
    }),
  )
    .index("by_orgId_packetNumber", byOrg("packetNumber"))
    .index("by_orgId_customerOrderLineId", byOrg("customerOrderLineId"))
    .index(
      "by_orgId_warehouseId_status_packetNumber",
      byOrg("warehouseId", "status", "packetNumber"),
    ),

  factoryPacketFiles: defineTable(
    tenantFields({
      factoryPacketId: v.id("factoryPackets"),
      masterCardFileId: v.id("masterCardFiles"),
    }),
  )
    .index(
      "by_orgId_factoryPacketId_masterCardFileId",
      byOrg("factoryPacketId", "masterCardFileId"),
    )
    .index(
      "by_orgId_masterCardFileId_factoryPacketId",
      byOrg("masterCardFileId", "factoryPacketId"),
    ),

  productionOrders: defineTable(
    tenantFields({
      warehouseId: v.id("warehouses"),
      productionOrderNumber: v.string(),
      factoryPacketId: v.id("factoryPackets"),
      customerOrderLineId: v.id("customerOrderLines"),
      fulfillmentLineId: v.optional(v.id("fulfillmentLines")),
      planningSource: v.optional(
        v.union(v.literal("ROUTED_SHORTAGE"), v.literal("LEGACY_PACKET")),
      ),
      masterCardRevisionId: v.id("masterCardRevisions"),
      revisionNumber: v.number(),
      outputItemId: v.id("items"),
      outputBaseUom: v.string(),
      targetBaseMinorUnits: v.number(),
      quantities: v.object({
        target: v.number(),
        good: v.number(),
        scrap: v.number(),
        rework: v.number(),
        received: v.number(),
        qcReleased: v.number(),
        qcRejected: v.number(),
      }),
      route: v.array(
        v.object({
          sequence: v.number(),
          workCenterCode: v.string(),
          operationCode: v.string(),
          instruction: v.optional(v.string()),
        }),
      ),
      status: productionOrderStatus,
      dueAt: v.number(),
      createdByUserId: v.id("users"),
      createdAt: v.number(),
      releasedByUserId: v.optional(v.id("users")),
      releasedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
    }),
  )
    .index("by_orgId_productionOrderNumber", byOrg("productionOrderNumber"))
    .index("by_orgId_factoryPacketId", byOrg("factoryPacketId"))
    .index(
      "by_orgId_masterCardRevisionId_dueAt",
      byOrg("masterCardRevisionId", "dueAt"),
    )
    .index(
      "by_orgId_warehouseId_status_dueAt",
      byOrg("warehouseId", "status", "dueAt"),
    )
    .index("by_orgId_warehouseId_dueAt", byOrg("warehouseId", "dueAt")),

  productionMaterialRequirements: defineTable(
    tenantFields({
      productionOrderId: v.id("productionOrders"),
      lineNumber: v.number(),
      itemId: v.id("items"),
      materialCode: v.string(),
      description: v.string(),
      baseUom: v.string(),
      requiredBaseMinorUnits: v.number(),
      issuedBaseMinorUnits: v.number(),
      sourceBucketKey: v.optional(v.string()),
      sourceLotId: v.optional(v.id("lots")),
      issueTransactionId: v.optional(v.id("inventoryTransactions")),
    }),
  )
    .index(
      "by_orgId_productionOrderId_lineNumber",
      byOrg("productionOrderId", "lineNumber"),
    )
    .index(
      "by_orgId_itemId_productionOrderId",
      byOrg("itemId", "productionOrderId"),
    ),

  productionMaterialIssues: defineTable(
    tenantFields({
      productionOrderId: v.id("productionOrders"),
      productionMaterialRequirementId: v.id("productionMaterialRequirements"),
      itemId: v.id("items"),
      sourceBucketKey: v.string(),
      sourceLotId: v.optional(v.id("lots")),
      baseUom: v.string(),
      baseMinorUnits: v.number(),
      issueTransactionId: v.id("inventoryTransactions"),
      issuedByUserId: v.id("users"),
      issuedAt: v.number(),
    }),
  ).index(
    "by_orgId_productionOrderId_issuedAt",
    byOrg("productionOrderId", "issuedAt"),
  ),

  productionOperationReports: defineTable(
    tenantFields({
      productionOrderId: v.id("productionOrders"),
      operationSequence: v.number(),
      workCenterCode: v.string(),
      operationCode: v.string(),
      goodBaseMinorUnits: v.number(),
      scrapBaseMinorUnits: v.number(),
      reworkBaseMinorUnits: v.number(),
      downtimeMinutes: v.number(),
      downtimeReason: v.optional(v.string()),
      operatorUserId: v.id("users"),
      reportedAt: v.number(),
    }),
  ).index(
    "by_orgId_productionOrderId_operationSequence_reportedAt",
    byOrg("productionOrderId", "operationSequence", "reportedAt"),
  ),

  productionOutputReceipts: defineTable(
    tenantFields({
      productionOrderId: v.id("productionOrders"),
      warehouseId: v.id("warehouses"),
      outputItemId: v.id("items"),
      outputLotId: v.id("lots"),
      destinationLocationId: v.id("locations"),
      baseUom: v.string(),
      baseMinorUnits: v.number(),
      disposition: productionOutputDisposition,
      receiptTransactionId: v.id("inventoryTransactions"),
      receivedByUserId: v.id("users"),
      receivedAt: v.number(),
      qualityTransactionId: v.optional(v.id("inventoryTransactions")),
      qualityDecidedByUserId: v.optional(v.id("users")),
      qualityDecidedAt: v.optional(v.number()),
      qualityNote: v.optional(v.string()),
    }),
  )
    .index(
      "by_orgId_productionOrderId_receivedAt",
      byOrg("productionOrderId", "receivedAt"),
    )
    .index(
      "by_orgId_warehouseId_disposition_receivedAt",
      byOrg("warehouseId", "disposition", "receivedAt"),
    ),

  /** HR person record, deliberately distinct from authentication identity. */
  employees: defineTable(
    tenantFields({
      employeeNumber: v.string(),
      userId: v.optional(v.id("users")),
      displayName: v.string(),
      warehouseId: v.id("warehouses"),
      teamId: v.optional(v.id("hrTeams")),
      supervisorEmployeeId: v.optional(v.id("employees")),
      status: employmentStatus,
      startedOn: v.string(),
      endedOn: v.optional(v.string()),
      createdByUserId: v.id("users"),
      createdAt: v.number(),
    }),
  )
    .index("by_orgId_employeeNumber", byOrg("employeeNumber"))
    .index("by_orgId_userId", byOrg("userId"))
    .index(
      "by_orgId_warehouseId_status_employeeNumber",
      byOrg("warehouseId", "status", "employeeNumber"),
    )
    .index(
      "by_orgId_teamId_status_employeeNumber",
      byOrg("teamId", "status", "employeeNumber"),
    ),

  hrTeams: defineTable(
    tenantFields({
      code: v.string(),
      name: v.string(),
      warehouseId: v.id("warehouses"),
      supervisorEmployeeId: v.optional(v.id("employees")),
      status: employmentStatus,
      createdByUserId: v.id("users"),
      createdAt: v.number(),
    }),
  )
    .index("by_orgId_code", byOrg("code"))
    .index(
      "by_orgId_warehouseId_status_code",
      byOrg("warehouseId", "status", "code"),
    ),

  attendanceEvents: defineTable(
    tenantFields({
      employeeId: v.id("employees"),
      warehouseId: v.id("warehouses"),
      attendanceDayId: v.id("attendanceDays"),
      businessDate: v.string(),
      kind: attendanceEventKind,
      commandId: v.string(),
      deviceOccurredAt: v.optional(v.number()),
      serverReceivedAt: v.number(),
      timezone: v.string(),
      actorUserId: v.id("users"),
      correctionRequestId: v.optional(v.id("attendanceCorrections")),
    }),
  )
    .index("by_orgId_commandId", byOrg("commandId"))
    .index(
      "by_orgId_employeeId_serverReceivedAt",
      byOrg("employeeId", "serverReceivedAt"),
    )
    .index(
      "by_orgId_attendanceDayId_serverReceivedAt",
      byOrg("attendanceDayId", "serverReceivedAt"),
    ),

  attendanceDays: defineTable(
    tenantFields({
      employeeId: v.id("employees"),
      warehouseId: v.id("warehouses"),
      businessDate: v.string(),
      status: attendanceDayStatus,
      clockInAt: v.optional(v.number()),
      breakStartedAt: v.optional(v.number()),
      breakMinutes: v.number(),
      clockOutAt: v.optional(v.number()),
      lastEventAt: v.number(),
      timezone: v.string(),
    }),
  )
    .index(
      "by_orgId_employeeId_businessDate",
      byOrg("employeeId", "businessDate"),
    )
    .index(
      "by_orgId_warehouseId_businessDate_status",
      byOrg("warehouseId", "businessDate", "status"),
    ),

  attendanceCorrections: defineTable(
    tenantFields({
      requestId: v.string(),
      employeeId: v.id("employees"),
      warehouseId: v.id("warehouses"),
      attendanceDayId: v.id("attendanceDays"),
      requestedClockInAt: v.number(),
      requestedClockOutAt: v.number(),
      requestedBreakMinutes: v.number(),
      reason: v.string(),
      status: hrRequestStatus,
      requestedByUserId: v.id("users"),
      requestedAt: v.number(),
      decidedByUserId: v.optional(v.id("users")),
      decidedAt: v.optional(v.number()),
      decisionNote: v.optional(v.string()),
    }),
  )
    .index("by_orgId_requestId", byOrg("requestId"))
    .index(
      "by_orgId_employeeId_status_requestedAt",
      byOrg("employeeId", "status", "requestedAt"),
    )
    .index(
      "by_orgId_warehouseId_status_requestedAt",
      byOrg("warehouseId", "status", "requestedAt"),
    ),

  leaveRequests: defineTable(
    tenantFields({
      requestId: v.string(),
      employeeId: v.id("employees"),
      warehouseId: v.id("warehouses"),
      startDate: v.string(),
      endDate: v.string(),
      leaveType,
      durationKind: leaveDurationKind,
      hours: v.optional(v.number()),
      privateReason: v.optional(v.string()),
      status: hrRequestStatus,
      requestedByUserId: v.id("users"),
      requestedAt: v.number(),
      decidedByUserId: v.optional(v.id("users")),
      decidedAt: v.optional(v.number()),
      decisionNote: v.optional(v.string()),
    }),
  )
    .index("by_orgId_requestId", byOrg("requestId"))
    .index(
      "by_orgId_employeeId_status_startDate",
      byOrg("employeeId", "status", "startDate"),
    )
    .index(
      "by_orgId_warehouseId_status_startDate",
      byOrg("warehouseId", "status", "startDate"),
    ),

  integrationAdapters: defineTable(
    tenantFields({
      code: v.string(),
      displayName: v.string(),
      kind: integrationAdapterKind,
      status: integrationAdapterStatus,
      configurationKey: v.string(),
      lastSuccessAt: v.optional(v.number()),
      lastFailureAt: v.optional(v.number()),
      lastFailureCode: v.optional(v.string()),
      updatedByUserId: v.id("users"),
      updatedAt: v.number(),
    }),
  )
    .index("by_orgId_code", byOrg("code"))
    .index("by_orgId_status_code", byOrg("status", "code")),

  integrationOutboxMessages: defineTable(
    tenantFields({
      eventKey: v.string(),
      adapterId: v.id("integrationAdapters"),
      eventType: v.string(),
      schemaVersion: v.number(),
      sourceTable: v.string(),
      sourceId: v.string(),
      payloadJson: v.string(),
      payloadDigest: v.string(),
      status: integrationMessageStatus,
      attemptCount: v.number(),
      availableAt: v.number(),
      claimedAt: v.optional(v.number()),
      claimRequestId: v.optional(v.string()),
      resultRequestId: v.optional(v.string()),
      leaseExpiresAt: v.optional(v.number()),
      deliveredAt: v.optional(v.number()),
      lastFailureCode: v.optional(v.string()),
      createdAt: v.number(),
    }),
  )
    .index("by_orgId_eventKey", byOrg("eventKey"))
    .index(
      "by_orgId_adapterId_status_availableAt",
      byOrg("adapterId", "status", "availableAt"),
    ),

  /** Append-only delivery evidence; response bodies and provider secrets are never stored. */
  integrationDeliveryAttempts: defineTable(
    tenantFields({
      messageId: v.id("integrationOutboxMessages"),
      adapterId: v.id("integrationAdapters"),
      attemptNumber: v.number(),
      correlationId: v.string(),
      outcome: integrationAttemptOutcome,
      startedAt: v.number(),
      finishedAt: v.number(),
      errorCode: v.optional(v.string()),
      responseStatus: v.optional(v.number()),
      actorUserId: v.id("users"),
    }),
  )
    .index(
      "by_orgId_messageId_attemptNumber",
      byOrg("messageId", "attemptNumber"),
    )
    .index("by_orgId_adapterId_finishedAt", byOrg("adapterId", "finishedAt")),
});

export default schema;

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
