import { v, type Infer, type VLiteral } from "convex/values";

type LiteralValidators<Values extends readonly string[]> = {
  -readonly [Index in keyof Values]: VLiteral<Values[Index], "required">;
};

const literalUnion = <const Values extends readonly [string, ...string[]]>(
  ...values: Values
) => {
  const members = values.map((value) =>
    v.literal(value),
  ) as unknown as LiteralValidators<Values>;
  return v.union(...members);
};

export const organizationStatus = literalUnion("ACTIVE", "SUSPENDED", "CLOSED");
export type OrganizationStatus = Infer<typeof organizationStatus>;

export const userStatus = literalUnion("ACTIVE", "DEACTIVATED");
export type UserStatus = Infer<typeof userStatus>;

export const membershipStatus = literalUnion("ACTIVE", "SUSPENDED", "REVOKED");
export type MembershipStatus = Infer<typeof membershipStatus>;

export const membershipScopeMode = literalUnion("ORG_WIDE", "WAREHOUSE_SCOPED");
export type MembershipScopeMode = Infer<typeof membershipScopeMode>;

export const permissionScope = literalUnion("ORG", "WAREHOUSE", "PLATFORM");
export type PermissionScope = Infer<typeof permissionScope>;

export const roleStatus = literalUnion("ACTIVE", "ARCHIVED");
export type RoleStatus = Infer<typeof roleStatus>;

export const warehouseStatus = literalUnion("ACTIVE", "INACTIVE");
export type WarehouseStatus = Infer<typeof warehouseStatus>;

export const deviceType = literalUnion("HANDHELD", "WORKSTATION", "TABLET");
export type DeviceType = Infer<typeof deviceType>;

export const deviceStatus = literalUnion("ACTIVE", "RETIRED");
export type DeviceStatus = Infer<typeof deviceStatus>;

export const operatorTaskKind = literalUnion("SUPERVISOR_ASSIGNED");
export type OperatorTaskKindValue = Infer<typeof operatorTaskKind>;

export const operatorTaskStatus = literalUnion(
  "AVAILABLE",
  "CLAIMED",
  "COMPLETED",
  "CANCELLED",
);
export type OperatorTaskStatusValue = Infer<typeof operatorTaskStatus>;

export const operatorTaskEvidenceKind = literalUnion(
  "QUANTITY",
  "SCAN",
  "NOTE",
  "HANDOVER",
);
export type OperatorTaskEvidenceKindValue = Infer<
  typeof operatorTaskEvidenceKind
>;

export const operatorTaskExceptionStatus = literalUnion(
  "OPEN",
  "RESOLVED",
  "WITHDRAWN",
);
export type OperatorTaskExceptionStatusValue = Infer<
  typeof operatorTaskExceptionStatus
>;

export const operatorTaskExceptionDisposition = literalUnion(
  "RESUME",
  "REASSIGN",
  "STOP",
  "ESCALATE",
);
export type OperatorTaskExceptionDispositionValue = Infer<
  typeof operatorTaskExceptionDisposition
>;

/** Evidence file categories kept deliberately broad across operator modules. */
export const operatorTaskAttachmentKind = literalUnion(
  "PHOTO",
  "DOCUMENT",
  "OTHER",
);
export type OperatorTaskAttachmentKindValue = Infer<
  typeof operatorTaskAttachmentKind
>;

export const quantityPlausibility = literalUnion(
  "PLAUSIBLE",
  "UNCHECKED",
  "IMPLAUSIBLE",
);
export type QuantityPlausibilityValue = Infer<typeof quantityPlausibility>;

export const stepUpDecision = literalUnion("APPROVED", "REJECTED");
export type StepUpDecisionValue = Infer<typeof stepUpDecision>;

export const actorKind = literalUnion("USER", "SYSTEM", "PLATFORM_SUPPORT");
export type ActorKind = Infer<typeof actorKind>;

export const auditOutcome = literalUnion("ALLOWED", "DENIED");
export type AuditOutcome = Infer<typeof auditOutcome>;

export const denialReason = literalUnion(
  "NO_PERMISSION",
  "OUT_OF_WAREHOUSE_SCOPE",
  "THRESHOLD_EXCEEDED",
  "APPROVAL_REQUIRED",
  "REVERIFICATION_REQUIRED",
  "ENTITLEMENT_DISABLED",
  "INACTIVE_MEMBERSHIP",
);
export type DenialReason = Infer<typeof denialReason>;

export const idempotencyStatus = literalUnion(
  "IN_PROGRESS",
  "SUCCEEDED",
  "FAILED",
);
export type IdempotencyStatus = Infer<typeof idempotencyStatus>;

export const sessionsAuditEventType = literalUnion(
  "SIGN_IN",
  "SIGN_OUT",
  "ORGANIZATION_SWITCH",
  "STEP_UP_VERIFIED",
  "STEP_UP_DENIED",
  "SESSION_REVOKED",
);
export type SessionsAuditEventType = Infer<typeof sessionsAuditEventType>;

export const supportGrantStatus = literalUnion(
  "REQUESTED",
  "APPROVED",
  "ACTIVE",
  "REJECTED",
  "EXPIRED",
  "REVOKED",
);
export type SupportGrantStatus = Infer<typeof supportGrantStatus>;

export const supportAccessMode = literalUnion("READ_ONLY", "READ_WRITE");
export type SupportAccessMode = Infer<typeof supportAccessMode>;

export const locale = literalUnion("th", "en");
export type Locale = Infer<typeof locale>;

export const currency = literalUnion("THB");
export type Currency = Infer<typeof currency>;

export const organizationSettings = v.object({
  timezone: v.string(),
  locale,
  currency,

  serialTrackingEnabled: v.boolean(),

  mixedContentEnabled: v.boolean(),

  consignedStockEnabled: v.boolean(),

  negativeAvailableAllowed: v.boolean(),

  supportGrantsEnabled: v.boolean(),
});
export type OrganizationSettings = Infer<typeof organizationSettings>;

export const masterDataStatus = literalUnion("ACTIVE", "INACTIVE");
export type MasterDataStatus = Infer<typeof masterDataStatus>;

export const storageLayoutStatus = literalUnion("DRAFT", "ACTIVE", "ARCHIVED");
export type StorageLayoutStatus = Infer<typeof storageLayoutStatus>;

export const itemTrackingMode = literalUnion("NONE", "LOT", "LOT_SERIAL");
export type ItemTrackingMode = Infer<typeof itemTrackingMode>;

export const locationType = literalUnion(
  "DOCK",
  "STAGING",
  "RACK_BIN",
  "FLOOR_BLOCK",
  "QUARANTINE",
  "OVERFLOW",
);
export type LocationType = Infer<typeof locationType>;

/** What a reason code may be cited for. Closed, so a code cannot drift in use. */
export const reasonCodeScope = literalUnion(
  "ADJUSTMENT",
  "SCRAP",
  "REVERSAL",
  "STATUS_CHANGE",
);
export type ReasonCodeScope = Infer<typeof reasonCodeScope>;

export const barcodeKind = literalUnion("GTIN", "SSCC", "INTERNAL", "SUPPLIER");
export type BarcodeKind = Infer<typeof barcodeKind>;

export const purchaseOrderStatus = literalUnion(
  "DRAFT",
  "OPEN",
  "CLOSED",
  "CANCELLED",
);
export type PurchaseOrderStatusValue = Infer<typeof purchaseOrderStatus>;

export const purchaseOrderLineStatus = literalUnion(
  "OPEN",
  "COMPLETE",
  "CLOSED_SHORT",
  "CANCELLED",
);
export type PurchaseOrderLineStatusValue = Infer<
  typeof purchaseOrderLineStatus
>;

export const receiptLineKind = literalUnion(
  "ORDERED",
  "UNEXPECTED",
  "CANCELLED_LINE",
  "BLIND",
);
export type ReceiptLineKindValue = Infer<typeof receiptLineKind>;

export const receiptClassification = literalUnion(
  "PARTIAL",
  "COMPLETE",
  "OVER_WITHIN_TOLERANCE",
  "OVER_BEYOND_TOLERANCE",
);
export type ReceiptClassificationValue = Infer<typeof receiptClassification>;

export const samplingStrategy = literalUnion("ALL", "FIXED", "PERCENT");
export type SamplingStrategyValue = Infer<typeof samplingStrategy>;

export const qcDisposition = literalUnion(
  "RELEASE",
  "QUARANTINE",
  "REJECT",
  "SCRAP",
  "REWORK",
);
export type QcDispositionValue = Infer<typeof qcDisposition>;

export const inspectionStatus = literalUnion(
  "OPEN",
  "PENDING_APPROVAL",
  "DISPOSED",
  "CANCELLED",
);
export type InspectionStatusValue = Infer<typeof inspectionStatus>;

export const printJobStatus = literalUnion("GENERATED", "DISPATCHED", "FAILED");
export type PrintJobStatusValue = Infer<typeof printJobStatus>;

export const printReason = literalUnion("INITIAL", "REPRINT", "PREVIEW");
export type PrintReasonValue = Infer<typeof printReason>;

export const putawayTaskStatus = literalUnion(
  "READY",
  "CLAIMED",
  "CONFIRMED",
  "CANCELLED",
);
export type PutawayTaskStatusValue = Infer<typeof putawayTaskStatus>;

export const receivingExceptionStatus = literalUnion(
  "RAISED",
  "CONSUMED",
  "WITHDRAWN",
);
export type ReceivingExceptionStatusValue = Infer<
  typeof receivingExceptionStatus
>;

export const importBatchStatus = literalUnion(
  "PREVIEWED",
  "APPLYING",
  "APPLIED",
  "ABANDONED",
);
export type ImportBatchStatusValue = Infer<typeof importBatchStatus>;

export const openingStockBatchStatus = literalUnion(
  "DRAFT",
  "READY_FOR_REVIEW",
  "APPROVED",
  "POSTING",
  "POSTED",
  "REJECTED",
);
export type OpeningStockBatchStatusValue = Infer<
  typeof openingStockBatchStatus
>;

export const openingStockRowStatus = literalUnion("VALID", "INVALID", "POSTED");
export type OpeningStockRowStatusValue = Infer<typeof openingStockRowStatus>;

export const openingStockPostChunkStatus = literalUnion("PENDING", "POSTED");
export type OpeningStockPostChunkStatusValue = Infer<
  typeof openingStockPostChunkStatus
>;

export const countScope = literalUnion("FULL", "CYCLE", "SPOT");
export type CountScopeValue = Infer<typeof countScope>;

export const countVisibility = literalUnion("BLIND", "VISIBLE");
export type CountVisibilityValue = Infer<typeof countVisibility>;

export const countMovementPolicy = literalUnion("FROZEN", "MOVEMENT_AWARE");
export type CountMovementPolicyValue = Infer<typeof countMovementPolicy>;

export const countPlanStatus = literalUnion(
  "DRAFT",
  "RELEASED",
  "IN_PROGRESS",
  "RECONCILING",
  "COMPLETED",
  "CANCELLED",
);
export type CountPlanStatusValue = Infer<typeof countPlanStatus>;

export const countTaskStatus = literalUnion(
  "AVAILABLE",
  "COUNTING",
  "SUBMITTED",
  "RECOUNT_REQUIRED",
  "RECOUNTING",
  "RECONCILED",
  "CANCELLED",
);
export type CountTaskStatusValue = Infer<typeof countTaskStatus>;

export const countEntrySource = literalUnion("HANDHELD", "PAPER_REENTRY");
export type CountEntrySourceValue = Infer<typeof countEntrySource>;

export const countReconciliationStatus = literalUnion(
  "PENDING",
  "RECOUNT_REQUIRED",
  "PENDING_APPROVAL",
  "APPROVED",
  "POSTED",
  "MATCHED",
);
export type CountReconciliationStatusValue = Infer<
  typeof countReconciliationStatus
>;

export const varianceRisk = literalUnion("MATCH", "STANDARD", "HIGH");
export type VarianceRiskValue = Infer<typeof varianceRisk>;

export const labelTemplateFormat = literalUnion("ZPL", "PDF");
export type LabelTemplateFormat = Infer<typeof labelTemplateFormat>;

export const labelTemplateStatus = literalUnion("DRAFT", "ACTIVE", "RETIRED");
export type LabelTemplateStatus = Infer<typeof labelTemplateStatus>;

export const stockStatus = literalUnion(
  "AVAILABLE",
  "QC_HOLD",
  "QUARANTINE",
  "REJECTED",
  "SCRAP",
  "EXPIRED",
);
export type StockStatusValue = Infer<typeof stockStatus>;

export const ledgerLocationKind = literalUnion("PHYSICAL", "VIRTUAL");
export type LedgerLocationKindValue = Infer<typeof ledgerLocationKind>;

export const virtualBoundaryCode = literalUnion(
  "SUPPLIER_RECEIPT",
  "CUSTOMER_SHIPMENT",
  "CUSTOMER_RETURN",
  "PRODUCTION_ISSUE",
  "PRODUCTION_RECEIPT",
  "INVENTORY_ADJUSTMENT",
  "SCRAP_DAMAGE",
  "RECONCILIATION",
  "TRANSFER_IN_TRANSIT",
);
export type VirtualBoundaryCodeValue = Infer<typeof virtualBoundaryCode>;

export const inventoryTransactionType = literalUnion(
  "RECEIPT",
  "PUTAWAY",
  "MOVE",
  "STATUS_CHANGE",
  "ADJUSTMENT",
  "SCRAP",
  "SHIPMENT",
  "PRODUCTION_ISSUE",
  "PRODUCTION_RECEIPT",
  "REVERSAL",
);
export type InventoryTransactionTypeValue = Infer<
  typeof inventoryTransactionType
>;

export const inventoryTransactionSource = v.object({
  type: v.string(),
  id: v.string(),
});
export type InventoryTransactionSource = Infer<
  typeof inventoryTransactionSource
>;

export const signedQuantity = v.object({
  uom: v.string(),
  minorUnits: v.number(),
});
export type SignedQuantity = Infer<typeof signedQuantity>;

export const rollupMetric = literalUnion(
  "RECEIPTS_OPENED",
  "RECEIPT_LINES_POSTED",
  "QC_PENDING",
  "QC_PARKED",
  "PUTAWAY_READY",
  "PUTAWAY_CLAIMED",
  "LOCATION_OCCUPANCY",
);
export type RollupMetricValue = Infer<typeof rollupMetric>;

/** What an export contains. Closed, because each kind names its own columns. */
export const reportKind = literalUnion(
  "INVENTORY_BALANCES",
  "RECEIPT_LINES",
  "PUTAWAY_TASKS",
);
export type ReportKindValue = Infer<typeof reportKind>;

export const reportJobStatus = literalUnion(
  "QUEUED",
  "RUNNING",
  "COMPLETE",
  "FAILED",
);
export type ReportJobStatusValue = Infer<typeof reportJobStatus>;

export const customerOrderStatus = literalUnion(
  "DRAFT",
  "RELEASED",
  "CANCELLED",
);
export type CustomerOrderStatusValue = Infer<typeof customerOrderStatus>;

export const customerOrderLineStatus = literalUnion(
  "AWAITING_DESIGN",
  "DESIGN_READY",
  "HANDED_OFF",
  "CANCELLED",
);
export type CustomerOrderLineStatusValue = Infer<
  typeof customerOrderLineStatus
>;

export const fulfillmentOrderStatus = literalUnion(
  "DRAFT",
  "RELEASED",
  "IN_FULFILLMENT",
  "PARTIALLY_COMPLETE",
  "COMPLETE",
  "CANCELLED",
);
export type FulfillmentOrderStatusValue = Infer<typeof fulfillmentOrderStatus>;

export const fulfillmentRouteDecision = literalUnion(
  "AVAILABLE_STOCK",
  "PRODUCTION",
);
export type FulfillmentRouteDecisionValue = Infer<
  typeof fulfillmentRouteDecision
>;

export const fulfillmentOrderRouteDecision = v.union(
  fulfillmentRouteDecision,
  v.literal("MIXED"),
);
export type FulfillmentOrderRouteDecisionValue = Infer<
  typeof fulfillmentOrderRouteDecision
>;

export const fulfillmentLineStatus = literalUnion(
  "UNPLANNED",
  "BACKORDERED",
  "RESERVED",
  "PICKING",
  "STAGED",
  "ISSUED",
  "LOADED",
  "PARTIALLY_DELIVERED",
  "DELIVERED",
  "RETURNED",
  "CANCELLED",
);
export type FulfillmentLineStatusValue = Infer<typeof fulfillmentLineStatus>;

export const allocationStrategy = literalUnion("FIFO", "FEFO");
export type AllocationStrategyValue = Infer<typeof allocationStrategy>;

export const inventoryReservationStatus = literalUnion(
  "ACTIVE",
  "PICKING",
  "CONSUMED",
  "RELEASED",
  "EXPIRED",
);
export type InventoryReservationStatusValue = Infer<
  typeof inventoryReservationStatus
>;

export const pickWaveStatus = literalUnion(
  "DRAFT",
  "RELEASED",
  "IN_PROGRESS",
  "COMPLETE",
  "CANCELLED",
);
export type PickWaveStatusValue = Infer<typeof pickWaveStatus>;

export const pickTaskStatus = literalUnion(
  "AVAILABLE",
  "IN_PROGRESS",
  "PICKED",
  "CHECKED",
  "PACKED",
  "STAGED",
  "ISSUED",
  "CANCELLED",
);
export type PickTaskStatusValue = Infer<typeof pickTaskStatus>;

export const pickTaskLineStatus = literalUnion("OPEN", "COMPLETE");
export type PickTaskLineStatusValue = Infer<typeof pickTaskLineStatus>;

export const pickEventKind = literalUnion("PICK", "SHORT", "DAMAGED");
export type PickEventKindValue = Infer<typeof pickEventKind>;

export const fulfillmentPackageStatus = literalUnion(
  "PACKED",
  "STAGED",
  "ISSUED",
);
export type FulfillmentPackageStatusValue = Infer<
  typeof fulfillmentPackageStatus
>;

export const shipmentStatus = literalUnion(
  "DRAFT",
  "READY_TO_LOAD",
  "LOADING",
  "LOADED",
  "GATED_OUT",
  "IN_TRANSIT",
  "DELIVERED",
  "DELIVERY_FAILED",
  "RETURNED",
  "CANCELLED",
);
export type ShipmentStatusValue = Infer<typeof shipmentStatus>;

export const shipmentPackageStatus = literalUnion(
  "EXPECTED",
  "LOADED",
  "DELIVERED",
  "RETURNED",
);
export type ShipmentPackageStatusValue = Infer<typeof shipmentPackageStatus>;

export const tripStatus = literalUnion(
  "DRAFT",
  "READY_TO_LOAD",
  "LOADING",
  "SEALED",
  "GATED_OUT",
  "IN_TRANSIT",
  "COMPLETE",
  "CANCELLED",
);
export type TripStatusValue = Infer<typeof tripStatus>;

export const deliveryMilestoneKind = literalUnion(
  "DEPARTED",
  "ARRIVED",
  "DELIVERED",
  "FAILED",
  "RETURNED_TO_WAREHOUSE",
);
export type DeliveryMilestoneKindValue = Infer<typeof deliveryMilestoneKind>;

export const transferSourceKind = literalUnion(
  "SALES_ORDER",
  "INVOICE",
  "PREPARATION",
  "REPLENISHMENT",
  "OTHER",
);
export type TransferSourceKindValue = Infer<typeof transferSourceKind>;

export const transferStatus = literalUnion(
  "DRAFT",
  "APPROVED",
  "DISPATCHING",
  "DISPATCHED",
  "PARTIALLY_RECEIVED",
  "DISCREPANCY",
  "COMPLETE",
  "CANCELLED",
);
export type TransferStatusValue = Infer<typeof transferStatus>;

export const transferDiscrepancyStatus = literalUnion(
  "OPEN",
  "RESOLVED_RECEIVED",
  "RESOLVED_RETURNED",
  "WRITTEN_OFF",
);
export type TransferDiscrepancyStatusValue = Infer<
  typeof transferDiscrepancyStatus
>;

export const proofOfDeliveryStatus = literalUnion(
  "CAPTURED",
  "ACCEPTED",
  "REJECTED",
);
export type ProofOfDeliveryStatusValue = Infer<typeof proofOfDeliveryStatus>;

export const documentReturnStatus = literalUnion(
  "EXPECTED",
  "RETURNED",
  "WAIVED",
);
export type DocumentReturnStatusValue = Infer<typeof documentReturnStatus>;

export const transportFileKind = literalUnion(
  "POD",
  "GATE_EVIDENCE",
  "DELIVERY_NOTE",
  "DOCUMENT_RETURN",
);
export type TransportFileKindValue = Infer<typeof transportFileKind>;

export const transportFileStorageState = literalUnion(
  "RESERVED",
  "AVAILABLE",
  "DELETED",
);
export type TransportFileStorageStateValue = Infer<
  typeof transportFileStorageState
>;

export const designSource = literalUnion("EXISTING", "NEW");
export type DesignSourceValue = Infer<typeof designSource>;

export const designRequestStatus = literalUnion(
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "IN_REVIEW",
  "FULFILLED",
  "CANCELLED",
);
export type DesignRequestStatusValue = Infer<typeof designRequestStatus>;

export const designRequestPriority = literalUnion(
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
);
export type DesignRequestPriorityValue = Infer<typeof designRequestPriority>;

export const designRequirementKey = literalUnion(
  "CUSTOMER_PRODUCT_IDENTITY",
  "DIMENSIONS",
  "CONSTRUCTION",
  "PRINT",
  "PACKING",
  "ROUTE",
  "MATERIALS",
  "QUALITY",
);

export const designRequirementConfirmations = v.object({
  CUSTOMER_PRODUCT_IDENTITY: v.boolean(),
  DIMENSIONS: v.boolean(),
  CONSTRUCTION: v.boolean(),
  PRINT: v.boolean(),
  PACKING: v.boolean(),
  ROUTE: v.boolean(),
  MATERIALS: v.boolean(),
  QUALITY: v.boolean(),
});

export const masterCardRevisionStatus = literalUnion(
  "DRAFT",
  "IN_REVIEW",
  "RELEASED",
  "REJECTED",
  "SUPERSEDED",
);
export type MasterCardRevisionStatusValue = Infer<
  typeof masterCardRevisionStatus
>;

export const masterCardFileKind = literalUnion(
  "DIELINE",
  "ARTWORK",
  "PHOTO",
  "OTHER",
);
export type MasterCardFileKindValue = Infer<typeof masterCardFileKind>;

export const masterCardFileStorageState = literalUnion(
  "REGISTERED",
  "AVAILABLE",
  "FAILED",
);
export type MasterCardFileStorageStateValue = Infer<
  typeof masterCardFileStorageState
>;

export const factoryPacketStatus = literalUnion(
  "ISSUED",
  "ACKNOWLEDGED",
  "CANCELLED",
);
export type FactoryPacketStatusValue = Infer<typeof factoryPacketStatus>;

export const productionOrderStatus = literalUnion(
  "DRAFT",
  "RELEASED",
  "IN_PROGRESS",
  "QC_PENDING",
  "COMPLETE",
  "CLOSED_REJECTED",
  "CANCELLED",
);
export type ProductionOrderStatusValue = Infer<typeof productionOrderStatus>;

export const productionOutputDisposition = literalUnion(
  "QC_HOLD",
  "AVAILABLE",
  "REJECTED",
);
export type ProductionOutputDispositionValue = Infer<
  typeof productionOutputDisposition
>;

export const employmentStatus = literalUnion("ACTIVE", "INACTIVE");
export const attendanceEventKind = literalUnion(
  "CLOCK_IN",
  "BREAK_START",
  "BREAK_END",
  "CLOCK_OUT",
  "CORRECTION_APPLIED",
);
export const attendanceDayStatus = literalUnion(
  "OPEN",
  "ON_BREAK",
  "CLOSED",
  "CORRECTED",
  "ANOMALY",
);
export const hrRequestStatus = literalUnion(
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
);
export const leaveType = literalUnion(
  "ANNUAL",
  "SICK",
  "PERSONAL",
  "UNPAID",
  "OTHER",
);
export const leaveDurationKind = literalUnion(
  "FULL_DAY",
  "HALF_DAY_AM",
  "HALF_DAY_PM",
  "HOURS",
);

export const integrationAdapterKind = literalUnion(
  "WEBHOOK",
  "ERP",
  "EMAIL",
  "LINE",
  "PRINTER",
);
export const integrationAdapterStatus = literalUnion(
  "ENABLED",
  "DEGRADED",
  "DISABLED",
);
export const integrationMessageStatus = literalUnion(
  "PENDING",
  "DELIVERING",
  "RETRY_WAIT",
  "DELIVERED",
  "DEAD_LETTER",
  "CANCELLED",
);
export const integrationAttemptOutcome = literalUnion(
  "DELIVERED",
  "RETRYABLE_FAILURE",
  "PERMANENT_FAILURE",
  "LEASE_EXPIRED",
);

export const boxSpecification = v.object({
  styleCode: v.string(),
  internalLengthMm: v.number(),
  internalWidthMm: v.number(),
  internalHeightMm: v.number(),
  boardGrade: v.string(),
  printColourCount: v.number(),
  finishedGoodItemCode: v.optional(v.string()),
  boxType: v.optional(v.string()),
  productNameEn: v.optional(v.string()),
  productNameTh: v.optional(v.string()),
  sheetLengthMm: v.optional(v.number()),
  sheetWidthMm: v.optional(v.number()),
  piecesPerSheet: v.optional(v.number()),
  piecesPerSet: v.optional(v.number()),
  lengthToleranceMm: v.optional(v.number()),
  widthToleranceMm: v.optional(v.number()),
  heightToleranceMm: v.optional(v.number()),
  fluteCode: v.optional(v.string()),
  layers: v.optional(
    v.array(
      v.object({
        position: v.number(),
        paperCode: v.string(),
        grammageGsm: v.number(),
      }),
    ),
  ),
  printMethod: v.optional(v.string()),
  printColours: v.optional(v.array(v.string())),
  printSide: v.optional(v.string()),
  coatingSide: v.optional(v.string()),
  creaseSide: v.optional(v.string()),
  dieBlockCode: v.optional(v.string()),
  dieBlockStorageLocation: v.optional(v.string()),
  printingPlateCode: v.optional(v.string()),
  printingPlateStorageLocation: v.optional(v.string()),
  finishing: v.optional(v.array(v.string())),
  jointType: v.optional(v.string()),
  glueType: v.optional(v.string()),
  wirePerCarton: v.optional(v.number()),
  unitsPerCarton: v.optional(v.number()),
  bundleQuantity: v.optional(v.number()),
  palletQuantity: v.optional(v.number()),
  packingInstructions: v.optional(v.string()),
  route: v.optional(
    v.array(
      v.object({
        sequence: v.number(),
        workCenterCode: v.string(),
        operationCode: v.string(),
        instruction: v.optional(v.string()),
      }),
    ),
  ),
  materials: v.optional(
    v.array(
      v.object({
        itemCode: v.string(),
        description: v.string(),
        quantityPerUnit: v.number(),
        uom: v.string(),
        wastePercent: v.optional(v.number()),
      }),
    ),
  ),
  qualityRequirements: v.optional(
    v.array(
      v.object({
        code: v.string(),
        description: v.string(),
        target: v.string(),
        tolerance: v.optional(v.string()),
      }),
    ),
  ),
  calculations: v.optional(
    v.array(
      v.object({
        name: v.string(),
        formulaVersion: v.string(),
        inputs: v.array(
          v.object({
            name: v.string(),
            value: v.number(),
            unit: v.string(),
          }),
        ),
        result: v.number(),
        unit: v.string(),
        passed: v.boolean(),
        verifiedByUserId: v.string(),
        verifiedAt: v.number(),
      }),
    ),
  ),
  notes: v.optional(v.string()),
});
export type BoxSpecificationValue = Infer<typeof boxSpecification>;
