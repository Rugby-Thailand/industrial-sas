/**
 * Closed value validators for the tenant security schema.
 *
 * Status: **schema foundation only.** These validators are referenced by
 * `convex/schema.ts`. No Convex function, wrapper, or policy evaluator consumes
 * them yet.
 *
 * Why closed unions rather than `v.string()`: a status, locale, currency, scope
 * mode, support access mode, or device type is a decision surface. An open
 * string lets a caller invent a state that no policy handles, and a schema
 * migration is the only way to notice. Every set below is enumerable, so a test
 * can read its members (`VUnion.members`) and assert the set has not silently
 * grown.
 *
 * Single-member unions (`currency`) are deliberate: they stay closed, and
 * adding a member later is a visible one-line diff rather than a type change.
 *
 * Vocabulary follows the [domain glossary](../../docs/domain-glossary.md).
 * Identifiers are English (D-06); Thai belongs in UI copy and bilingual master
 * data only.
 */
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

/* -------------------------------------------------------------------------- */
/* Tenancy and identity                                                        */
/* -------------------------------------------------------------------------- */

/** Lifecycle of a tenant (`G-001`). Mirrored from onboarding, not from Clerk. */
export const organizationStatus = literalUnion("ACTIVE", "SUSPENDED", "CLOSED");
export type OrganizationStatus = Infer<typeof organizationStatus>;

/**
 * Lifecycle of a mirrored Clerk user (`G-003`). Clerk owns the account; this is
 * only the mirror's view of whether the person is still usable as an actor.
 */
export const userStatus = literalUnion("ACTIVE", "DEACTIVATED");
export type UserStatus = Infer<typeof userStatus>;

/**
 * Lifecycle of a membership (`G-004`). `REVOKED` is terminal: revocation must be
 * observable locally so a request can fail closed without calling Clerk
 * (`INV-0001-03`).
 */
export const membershipStatus = literalUnion("ACTIVE", "SUSPENDED", "REVOKED");
export type MembershipStatus = Infer<typeof membershipStatus>;

/**
 * Whether a membership acts across the whole organization or only in the
 * warehouses named by its `membershipWarehouses` rows (`G-007`, §5 Q13).
 *
 * This is an explicit mode rather than "empty warehouse set means all", because
 * an accidentally empty set must deny, not escalate.
 */
export const membershipScopeMode = literalUnion("ORG_WIDE", "WAREHOUSE_SCOPED");
export type MembershipScopeMode = Infer<typeof membershipScopeMode>;

/* -------------------------------------------------------------------------- */
/* Authorization                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The scope a permission code is decided in
 * ([catalogue](../../docs/permissions.md) §2).
 *
 * `WAREHOUSE` is the catalogue's `WH` column: the target warehouse participates
 * in the decision. `PLATFORM` codes are never granted to a tenant role.
 */
export const permissionScope = literalUnion("ORG", "WAREHOUSE", "PLATFORM");
export type PermissionScope = Infer<typeof permissionScope>;

/** Lifecycle of a tenant-editable role (`G-005`). Roles are archived, not deleted. */
export const roleStatus = literalUnion("ACTIVE", "ARCHIVED");
export type RoleStatus = Infer<typeof roleStatus>;

/* -------------------------------------------------------------------------- */
/* Warehouses and devices                                                      */
/* -------------------------------------------------------------------------- */

/** Lifecycle of a warehouse (`G-020`). Minimal: this slice needs it for scope only. */
export const warehouseStatus = literalUnion("ACTIVE", "INACTIVE");
export type WarehouseStatus = Infer<typeof warehouseStatus>;

/**
 * Form factor of a registered device (`G-013`, D-02, D-03). A device is context
 * recorded on transactions, never an authorization subject.
 */
export const deviceType = literalUnion("HANDHELD", "WORKSTATION", "TABLET");
export type DeviceType = Infer<typeof deviceType>;

/** Lifecycle of a registered device. Retired devices keep their audit history. */
export const deviceStatus = literalUnion("ACTIVE", "RETIRED");
export type DeviceStatus = Infer<typeof deviceStatus>;

/* -------------------------------------------------------------------------- */
/* Shared operator work (Phase 1 — FF-P1-09, FF-P1-10, FF-P1-11)               */
/* -------------------------------------------------------------------------- */

/**
 * Where a unit of operator work came from (`FF-P1-09`).
 *
 * One member today, deliberately. Phase 1 owns the shared claim/lease/evidence
 * contract, and the only thing that creates a task in this repository is a
 * supervisor planning work. A `COUNT_TASK` or `PICK_TASK` member declared now
 * would be a state nothing writes and nothing reads — the same "invented
 * domain" this schema refuses elsewhere. Each later phase adds its own member
 * with the flow that produces it (P2 count, P3 pick, P4 transfer).
 *
 * Single-member unions stay closed and grow by a visible one-line diff, exactly
 * as `currency` does above.
 */
export const operatorTaskKind = literalUnion("SUPERVISOR_ASSIGNED");
export type OperatorTaskKindValue = Infer<typeof operatorTaskKind>;

/**
 * A shared task's state.
 *
 * `AVAILABLE` covers both "never claimed" and "claimed, then released or
 * lapsed": the lease, not the status, is what says whether somebody is holding
 * it right now (`convex/model/platform/taskAssignment.ts`). A separate
 * `RELEASED` member would be a second way to spell the same fact, and the two
 * would drift the first time a lease expired without anyone writing a row.
 */
export const operatorTaskStatus = literalUnion(
  "AVAILABLE",
  "CLAIMED",
  "COMPLETED",
  "CANCELLED",
);
export type OperatorTaskStatusValue = Infer<typeof operatorTaskStatus>;

/**
 * What one piece of partial evidence records.
 *
 * `HANDOVER` is the member that makes invariant 18 checkable: when a lease
 * lapses or a supervisor reassigns a task, the change of hands is appended to
 * the same evidence stream as the work itself, so partial evidence and the
 * reason it changed owner are read in one place and in one order.
 */
export const operatorTaskEvidenceKind = literalUnion(
  "QUANTITY",
  "SCAN",
  "NOTE",
  "HANDOVER",
);
export type OperatorTaskEvidenceKindValue = Infer<
  typeof operatorTaskEvidenceKind
>;

/** The lifecycle of a problem raised from shared operator work (`FF-P1-03`). */
export const operatorTaskExceptionStatus = literalUnion(
  "OPEN",
  "RESOLVED",
  "WITHDRAWN",
);
export type OperatorTaskExceptionStatusValue = Infer<
  typeof operatorTaskExceptionStatus
>;

/** What the supervisor decided should happen after reviewing an exception. */
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

/** How a captured quantity compared with what the task expected (`FF-P1-10`). */
export const quantityPlausibility = literalUnion(
  "PLAUSIBLE",
  "UNCHECKED",
  "IMPLAUSIBLE",
);
export type QuantityPlausibilityValue = Infer<typeof quantityPlausibility>;

/**
 * A supervisor's on-device decision (`FF-P1-11`).
 *
 * `REJECTED` is stored rather than discarded: "the supervisor looked and said
 * no" is the evidence an exception review needs, and a table that only held
 * approvals would make refusals invisible.
 */
export const stepUpDecision = literalUnion("APPROVED", "REJECTED");
export type StepUpDecisionValue = Infer<typeof stepUpDecision>;

/* -------------------------------------------------------------------------- */
/* Audit, denial, and idempotency                                              */
/* -------------------------------------------------------------------------- */

/**
 * What kind of actor is credited with an event (`G-012`). `PLATFORM_SUPPORT`
 * exists so support access is attributable, and it is only reachable under an
 * enabled support grant, which ships disabled (`ADR-0006` §7).
 */
export const actorKind = literalUnion("USER", "SYSTEM", "PLATFORM_SUPPORT");
export type ActorKind = Infer<typeof actorKind>;

/** Whether the audited attempt was permitted. Denials are audited too (`INV-0006-10`). */
export const auditOutcome = literalUnion("ALLOWED", "DENIED");
export type AuditOutcome = Infer<typeof auditOutcome>;

/**
 * Why an attempt was denied ([catalogue](../../docs/permissions.md) §4.6).
 *
 * The reasons are distinguished because an operator needs to know which one
 * applies: "ask for the permission", "you are at the wrong site", "get an
 * approval", "reverify". Collapsing them into one message is a support cost.
 */
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

/**
 * State of an idempotency record (§5 Q30, Q35). `IN_PROGRESS` is recorded before
 * the effect so a concurrent replay can be rejected rather than duplicated.
 */
export const idempotencyStatus = literalUnion(
  "IN_PROGRESS",
  "SUCCEEDED",
  "FAILED",
);
export type IdempotencyStatus = Infer<typeof idempotencyStatus>;

/* -------------------------------------------------------------------------- */
/* Session audit                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Security-relevant session events recorded in `sessionsAudit` alongside — never
 * instead of — Clerk's own session state (§7.1, §5 Q16).
 *
 * `STEP_UP_VERIFIED` and `STEP_UP_DENIED` exist so step-up freshness
 * (`INV-0006-07`) has an auditable history on shared handhelds.
 */
export const sessionsAuditEventType = literalUnion(
  "SIGN_IN",
  "SIGN_OUT",
  "ORGANIZATION_SWITCH",
  "STEP_UP_VERIFIED",
  "STEP_UP_DENIED",
  "SESSION_REVOKED",
);
export type SessionsAuditEventType = Infer<typeof sessionsAuditEventType>;

/* -------------------------------------------------------------------------- */
/* Support access                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Lifecycle of a support grant (`G-010`, `ADR-0006` §7).
 *
 * There is no `PERMANENT` state and no state that outlives `expiresAt`:
 * `ACTIVE` is only reachable with an expiry in the future, and expiry is a
 * transition, not an absence of one.
 */
export const supportGrantStatus = literalUnion(
  "REQUESTED",
  "APPROVED",
  "ACTIVE",
  "REJECTED",
  "EXPIRED",
  "REVOKED",
);
export type SupportGrantStatus = Infer<typeof supportGrantStatus>;

/**
 * What a support grant may do. `READ_ONLY` is the default; `READ_WRITE` requires
 * two distinct platform approvals plus tenant approval (`INV-0006-09`).
 */
export const supportAccessMode = literalUnion("READ_ONLY", "READ_WRITE");
export type SupportAccessMode = Infer<typeof supportAccessMode>;

/* -------------------------------------------------------------------------- */
/* Organization configuration                                                  */
/* -------------------------------------------------------------------------- */

/** Interface locale: Thai first, English fallback (D-06, B-10). */
export const locale = literalUnion("th", "en");
export type Locale = Infer<typeof locale>;

/** Currency. MVP is single-currency per organization, THB (D-07). */
export const currency = literalUnion("THB");
export type Currency = Infer<typeof currency>;

/**
 * Organization configuration (§7.1).
 *
 * Every capability flag is a *capability*, not a preference: each one is `false`
 * by default and each one unlocks behaviour the MVP deliberately does not ship
 * (D-09, D-10, D-11, D-12, `ADR-0006` §7). Defaults live in
 * `organizationDefaults.ts` so "safe" is asserted in one place.
 *
 * `timezone` is an IANA name and stays an open string: adding a second Thai or
 * regional site is configuration, not a decision surface (D-05). Business dates
 * are derived from it (`G-105`), never from the UTC date.
 */
export const organizationSettings = v.object({
  timezone: v.string(),
  locale,
  currency,
  /** `LOT_SERIAL` tracking. Schema-ready, flows disabled (D-09). */
  serialTrackingEnabled: v.boolean(),
  /** Mixed SKU/lot handling-unit content (D-10). */
  mixedContentEnabled: v.boolean(),
  /** Client-owned / consigned stock as a bucket dimension (D-11). */
  consignedStockEnabled: v.boolean(),
  /** Negative `AVAILABLE` balances. Forbidden unless explicitly enabled (D-12). */
  negativeAvailableAllowed: v.boolean(),
  /** Cross-tenant support grants. Disabled by organization policy (`ADR-0006` §7). */
  supportGrantsEnabled: v.boolean(),
});
export type OrganizationSettings = Infer<typeof organizationSettings>;

/* -------------------------------------------------------------------------- */
/* Inventory: reference data                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Lifecycle of a minimal reference row (item, location, lot, handling unit,
 * owner, reason code).
 *
 * One validator for six tables rather than six near-identical ones. These rows
 * exist in this slice for a single purpose — proving that a ledger line's
 * references belong to the active organization and to each other
 * (`INV-0003-04`, `INV-0003-05`) — so the only lifecycle question the ledger asks
 * is "may this still be posted against". The fuller master-data model
 * (`ADR-0005`: hierarchy, capacity, storage classes, LPN lifecycle) brings its own
 * states with it.
 */
export const masterDataStatus = literalUnion("ACTIVE", "INACTIVE");
export type MasterDataStatus = Infer<typeof masterDataStatus>;

/** Lifecycle of a warehouse storage-layout plan. */
export const storageLayoutStatus = literalUnion("DRAFT", "ACTIVE", "ARCHIVED");
export type StorageLayoutStatus = Infer<typeof storageLayoutStatus>;

/**
 * SKU tracking mode (D-09, B-06). `LOT_SERIAL` is declared and its flows stay
 * disabled (`INV-0005-08`); declaring it now is what keeps enabling serials from
 * re-keying the ledger later.
 */
export const itemTrackingMode = literalUnion("NONE", "LOT", "LOT_SERIAL");
export type ItemTrackingMode = Infer<typeof itemTrackingMode>;

/**
 * Semantic classification of a physical location (`G-022`, §5 Q22).
 *
 * Deliberately excludes the glossary's "virtual boundary": a boundary is a
 * code-owned constant in `convex/model/inventory/stockIdentity.ts`, not a row
 * (`ADR-0003` §2). A tenant that could deactivate or re-parent the counterparty
 * the ledger balances against could make its own history unbalanced.
 */
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

/**
 * How a barcode identifies what it is stuck to (`ADR-0005`, D-15).
 *
 * A closed set, because the scan resolver decides what a string *is* before it
 * decides what it points at: a GTIN is check-digit verified, an SSCC names a
 * logistic unit rather than an item, and a supplier alias is whatever the
 * supplier printed. Storing a barcode without its kind would make an SSCC and a
 * GTIN indistinguishable at the moment a receipt has to resolve one.
 */
export const barcodeKind = literalUnion("GTIN", "SSCC", "INTERNAL", "SUPPLIER");
export type BarcodeKind = Infer<typeof barcodeKind>;

/**
 * A label template's payload format (D-16).
 *
 * `ZPL` is the primary printer payload and `PDF` the preview/fallback. Neither
 * is rendered, transmitted, or printed by this repository — the format is stored
 * so a future `PrinterTransportPort` knows what it is holding.
 */
/* -------------------------------------------------------------------------- */
/* Inbound slice (ADR-0007)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A purchase order's life (`ADR-0007` §1–3).
 *
 * `CLOSED` and `CANCELLED` are separate terminal states because they mean
 * opposite things to a buyer: one says the order ran its course, the other says
 * somebody stopped it. A reconciliation that merged them would report a
 * fulfilment rate that is simply false.
 */
export const purchaseOrderStatus = literalUnion(
  "DRAFT",
  "OPEN",
  "CLOSED",
  "CANCELLED",
);
export type PurchaseOrderStatusValue = Infer<typeof purchaseOrderStatus>;

/** Mirrors `PurchaseOrderLineStatus` in `convex/model/inbound/receiptPolicy.ts`. */
export const purchaseOrderLineStatus = literalUnion(
  "OPEN",
  "COMPLETE",
  "CLOSED_SHORT",
  "CANCELLED",
);
export type PurchaseOrderLineStatusValue = Infer<
  typeof purchaseOrderLineStatus
>;

/** How a receipt line came to exist (`INV-0007-04`). Mirrors `ReceiptLineKind`. */
export const receiptLineKind = literalUnion(
  "ORDERED",
  "UNEXPECTED",
  "CANCELLED_LINE",
  "BLIND",
);
export type ReceiptLineKindValue = Infer<typeof receiptLineKind>;

/** What `assessReceipt` decided about a posting. Stored as receipt evidence. */
export const receiptClassification = literalUnion(
  "PARTIAL",
  "COMPLETE",
  "OVER_WITHIN_TOLERANCE",
  "OVER_BEYOND_TOLERANCE",
);
export type ReceiptClassificationValue = Infer<typeof receiptClassification>;

/** The sampling strategies this repository implements (`ADR-0007` §5). */
export const samplingStrategy = literalUnion("ALL", "FIXED", "PERCENT");
export type SamplingStrategyValue = Infer<typeof samplingStrategy>;

/** Where held stock may go (`ADR-0007` §6). Mirrors `QcDisposition`. */
export const qcDisposition = literalUnion(
  "RELEASE",
  "QUARANTINE",
  "REJECT",
  "SCRAP",
  "REWORK",
);
export type QcDispositionValue = Infer<typeof qcDisposition>;

/** An inspection's state. Mirrors `InspectionStatus`. */
export const inspectionStatus = literalUnion(
  "OPEN",
  "PENDING_APPROVAL",
  "DISPOSED",
  "CANCELLED",
);
export type InspectionStatusValue = Infer<typeof inspectionStatus>;

/**
 * What a print job can honestly be said to be.
 *
 * There is deliberately no `PRINTED`: nothing in this repository can observe a
 * printer (`INT-04` absent, `RG-004` open), so the status would be a claim no
 * code here is in a position to make. `DISPATCHED` and `FAILED` are declared so
 * the state machine is complete rather than retrofitted, and are unreachable
 * until a transport exists.
 */
export const printJobStatus = literalUnion("GENERATED", "DISPATCHED", "FAILED");
export type PrintJobStatusValue = Infer<typeof printJobStatus>;

/** Why a payload was generated. A reprint is audited *as* a reprint (§10). */
export const printReason = literalUnion("INITIAL", "REPRINT", "PREVIEW");
export type PrintReasonValue = Infer<typeof printReason>;

/** A putaway task's state. Mirrors `PutawayTaskStatus`. */
export const putawayTaskStatus = literalUnion(
  "READY",
  "CLAIMED",
  "CONFIRMED",
  "CANCELLED",
);
export type PutawayTaskStatusValue = Infer<typeof putawayTaskStatus>;

/**
 * A raised receiving exception (`INV-0007-04`).
 *
 * `receiving.receipt.unexpected` and `receiving.receipt.blind` both carry
 * maker-checker in the catalogue, and maker-checker needs a *maker*. This is it:
 * one actor raises the exception with a reason, a different actor posts the
 * stock against it. Without the record there is no maker, the evaluator denies
 * fail-closed, and an unexpected delivery could not be received at all.
 */
export const receivingExceptionStatus = literalUnion(
  "RAISED",
  "CONSUMED",
  "WITHDRAWN",
);
export type ReceivingExceptionStatusValue = Infer<
  typeof receivingExceptionStatus
>;

/** An import batch's state (`INV-0007-12`). */
export const importBatchStatus = literalUnion(
  "PREVIEWED",
  "APPLYING",
  "APPLIED",
  "ABANDONED",
);
export type ImportBatchStatusValue = Infer<typeof importBatchStatus>;

/* -------------------------------------------------------------------------- */
/* Inventory truth: opening stock and counting                                */
/* -------------------------------------------------------------------------- */

/** Reviewed opening-stock import lifecycle (`FF-P2-01`). */
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

/** One import row is either postable or retained with a named validation fault. */
export const openingStockRowStatus = literalUnion("VALID", "INVALID", "POSTED");
export type OpeningStockRowStatusValue = Infer<typeof openingStockRowStatus>;

/** Durable result of one bounded opening-stock ledger chunk. */
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

/**
 * A label template version's lifecycle.
 *
 * `DRAFT` is authored by one actor; `ACTIVE` is published by a *different* one,
 * because `label.template.manage` carries maker-checker (catalogue §2).
 * `RETIRED` is withdrawn. A published version is never edited in place: a
 * printed label is audit evidence, and evidence whose template changed
 * underneath it proves nothing.
 */
export const labelTemplateStatus = literalUnion("DRAFT", "ACTIVE", "RETIRED");
export type LabelTemplateStatus = Infer<typeof labelTemplateStatus>;

/* -------------------------------------------------------------------------- */
/* Inventory: ledger                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The quality/availability dimension of an inventory bucket (`G-053`, D-11).
 *
 * Must stay identical to `STOCK_STATUSES` in
 * `convex/model/inventory/stockIdentity.ts`, which is where the domain meaning
 * lives. The two are asserted equal by
 * `tests/integration/schema-contracts.integration.test.ts` rather than derived
 * from one another, because deriving would mean this file importing a pure module
 * or that pure module importing `convex/values` — and plan §6.2 forbids the
 * second.
 */
export const stockStatus = literalUnion(
  "AVAILABLE",
  "QC_HOLD",
  "QUARANTINE",
  "REJECTED",
  "SCRAP",
  "EXPIRED",
);
export type StockStatusValue = Infer<typeof stockStatus>;

/**
 * Whether a ledger line sits inside the warehouse or on a virtual boundary
 * (`ADR-0003` §2, `G-023`).
 *
 * A discriminant, not an inference from which of `locationId`/`virtualBoundary` is
 * present. Both fields are optional in the schema — Convex has no dependent
 * optionality — so the kind is the field that decides, and the store refuses a row
 * whose kind and payload disagree.
 */
export const ledgerLocationKind = literalUnion("PHYSICAL", "VIRTUAL");
export type LedgerLocationKindValue = Infer<typeof ledgerLocationKind>;

/** Code-owned counterparties outside the warehouse. Mirrors `VIRTUAL_BOUNDARIES`. */
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

/** What kind of movement a transaction records. Mirrors `INVENTORY_TRANSACTION_TYPES`. */
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

/**
 * Where a transaction came from (plan §7.4 `source`).
 *
 * A tag and an opaque reference, both strings, deliberately not a document ID: the
 * originating aggregate may be a purchase order, a putaway task, a cycle count, a
 * scheduled job, or an imported file, and a `v.id()` would have to name one table.
 * The store validates the shape; the pure model validates the grammar.
 */
export const inventoryTransactionSource = v.object({
  type: v.string(),
  id: v.string(),
});
export type InventoryTransactionSource = Infer<
  typeof inventoryTransactionSource
>;

/**
 * A signed quantity in integer thousandths of an item's base UOM (`ADR-0004`,
 * D-08, B-12).
 *
 * Signed because a ledger line is a signed posting and a reversal is its negation.
 * Never a float, and never a decimal string: `minorUnits` is the whole value and
 * `uom` is the unit it is counted in. The magnitude bound is the pure module's
 * (`MAX_QUANTITY_MINOR_UNITS`), because a schema validator cannot express it.
 */
export const signedQuantity = v.object({
  uom: v.string(),
  minorUnits: v.number(),
});
export type SignedQuantity = Infer<typeof signedQuantity>;

/* -------------------------------------------------------------------------- */
/* Reporting (`ADR-0011`)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What a maintained counter counts (`ADR-0011` §6).
 *
 * A closed set, because each metric is also a *contract with a recomputation*:
 * `reporting/rollups:verifyRollups` knows how to derive every one of these from
 * the tables it summarises, and a metric that could be invented at a call site
 * would be a number nothing could check (`INV-0011-09`).
 *
 * `LOCATION_OCCUPANCY` is the only per-subject metric; the rest are site totals.
 */
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

/**
 * Where an export has got to.
 *
 * `RUNNING` is distinct from `QUEUED` because a chunked job that has started has
 * a cursor somebody may need to resume from, and `FAILED` is distinct from a
 * missing job because a caller who asked for an export is owed the difference
 * (`INV-0011-03`).
 */
export const reportJobStatus = literalUnion(
  "QUEUED",
  "RUNNING",
  "COMPLETE",
  "FAILED",
);
export type ReportJobStatusValue = Infer<typeof reportJobStatus>;

/* -------------------------------------------------------------------------- */
/* Order to ship — sales, engineering, production hand-off (Phase 5A)          */
/* -------------------------------------------------------------------------- */

/**
 * Lifecycle of a customer order (`G-120`).
 *
 * Deliberately *not* `purchaseOrderStatus`, even though the member names would
 * have overlapped. A supplier purchase order is what the tenant sends out so
 * goods arrive at a dock; a customer order is what arrives so a box gets made.
 * Sharing one union would be the first step towards sharing one table, and a
 * receiving query that silently included sales demand is the failure that
 * separation exists to prevent.
 *
 * No `CLOSED`: an order is finished when its lines are, and Phase 5A stops at the
 * factory hand-off. Inventing a closure state before anything can close one would
 * be a status nothing sets.
 */
export const customerOrderStatus = literalUnion(
  "DRAFT",
  "RELEASED",
  "CANCELLED",
);
export type CustomerOrderStatusValue = Infer<typeof customerOrderStatus>;

/**
 * Lifecycle of one customer order line (`G-121`).
 *
 * The two middle members are the whole point of the slice: `AWAITING_DESIGN`
 * says engineering owes a drawing, `DESIGN_READY` says a released master-card
 * revision is pinned to this line. A single `OPEN` would collapse the one
 * distinction the factory hand-off depends on.
 */
export const customerOrderLineStatus = literalUnion(
  "AWAITING_DESIGN",
  "DESIGN_READY",
  "HANDED_OFF",
  "CANCELLED",
);
export type CustomerOrderLineStatusValue = Infer<
  typeof customerOrderLineStatus
>;

/* -------------------------------------------------------------------------- */
/* Available-stock fulfillment (Phase 3 — FF-P3-01)                           */
/* -------------------------------------------------------------------------- */

/** Commercial commitment lifecycle, kept separate from design and delivery. */
export const fulfillmentOrderStatus = literalUnion(
  "DRAFT",
  "RELEASED",
  "IN_FULFILLMENT",
  "PARTIALLY_COMPLETE",
  "COMPLETE",
  "CANCELLED",
);
export type FulfillmentOrderStatusValue = Infer<typeof fulfillmentOrderStatus>;

/** Route chosen for one customer-order demand before factory handoff. */
export const fulfillmentRouteDecision = literalUnion(
  "AVAILABLE_STOCK",
  "PRODUCTION",
);
export type FulfillmentRouteDecisionValue = Infer<
  typeof fulfillmentRouteDecision
>;

/** Aggregate route across every line on a fulfillment order. */
export const fulfillmentOrderRouteDecision = v.union(
  fulfillmentRouteDecision,
  v.literal("MIXED"),
);
export type FulfillmentOrderRouteDecisionValue = Infer<
  typeof fulfillmentOrderRouteDecision
>;

/** The dominant current stage shown for one fulfillment line. */
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

/** Stock rotation policy used for an allocation decision. */
export const allocationStrategy = literalUnion("FIFO", "FEFO");
export type AllocationStrategyValue = Infer<typeof allocationStrategy>;

/** A reservation remains active until picking consumes or an explicit action releases it. */
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

/**
 * Where a line's design came from (`G-124`).
 *
 * Two members, no third for "similar". `WF-04` — whether near-matches should be
 * suggested — is open, and a `SIMILAR` value would be a decision this repository
 * has not been given.
 */
export const designSource = literalUnion("EXISTING", "NEW");
export type DesignSourceValue = Infer<typeof designSource>;

/**
 * Lifecycle of a design request (`G-123`).
 *
 * `ASSIGNED` is distinct from `OPEN` because "nobody has picked this up" and
 * "someone owes it" are different answers for a sales person chasing a date.
 * `FULFILLED` means a released revision now exists and the line was pinned to it;
 * there is no `IN_PROGRESS`, because nothing observes it.
 */
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

/**
 * Lifecycle of a master-card revision (`G-127`).
 *
 * `RELEASED` is the only status a factory packet may pin, and a released
 * revision is immutable — that immutability is what makes the pin worth
 * anything. `REJECTED` is terminal rather than reopenable: the way forward is a
 * new revision with its own number, so "rev 3" names one document forever,
 * including on paper on a factory floor. `SUPERSEDED` records that a later
 * revision has been released without changing a single thing the packets that
 * pinned this one describe.
 */
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

/**
 * What an attached master-card file is (`G-128`).
 *
 * A closed set because each kind is read by a different person for a different
 * purpose — a die maker wants the `DIELINE`, a printer wants the `ARTWORK` — and
 * an open string would make "show me the dieline" a full scan of names somebody
 * typed. `OTHER` exists so a real attachment is never blocked by this list.
 */
export const masterCardFileKind = literalUnion(
  "DIELINE",
  "ARTWORK",
  "PHOTO",
  "OTHER",
);
export type MasterCardFileKindValue = Infer<typeof masterCardFileKind>;

/**
 * Whether a file's bytes exist anywhere yet (`ADR-0008`, `INT-03`).
 *
 * `REGISTERED` is metadata awaiting storage verification, `AVAILABLE` means the
 * private adapter can retrieve the object, and `FAILED` keeps a visible retryable
 * failure. Only `AVAILABLE` satisfies revision submission.
 */
export const masterCardFileStorageState = literalUnion(
  "REGISTERED",
  "AVAILABLE",
  "FAILED",
);
export type MasterCardFileStorageStateValue = Infer<
  typeof masterCardFileStorageState
>;

/**
 * Lifecycle of a factory packet (`G-129`).
 *
 * Three members and no `IN_PRODUCTION`: what happens after the factory
 * acknowledges the packet is a factory-order concern (`WF-02`, Phase 5B), and a
 * status nothing advances would be a screen telling a planner something the
 * system does not know.
 */
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

/** HR attendance and leave lifecycle values (Phase 8 bounded slice). */
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

/**
 * One packaging specification, exactly as ordered (`G-125`).
 *
 * Every field is tenant-supplied. `styleCode` and `boardGrade` are strings rather
 * than closed unions because this repository does not own the catalogue of box
 * styles or board grades a Thai converter uses, and a union would be a claim that
 * it does. Dimensions are whole millimetres — the unit a converting machine is
 * set to — and the magnitude bounds live in
 * `convex/model/orderToShip/designSpecification.ts`, which a schema validator
 * cannot express.
 *
 * Nothing computed appears here: blank size and board consumption need formulas
 * `WF-11` says must be confirmed with Engineering and QA before they are coded,
 * and an invented formula would be an authoritative-looking number with no author.
 */
export const boxSpecification = v.object({
  styleCode: v.string(),
  internalLengthMm: v.number(),
  internalWidthMm: v.number(),
  internalHeightMm: v.number(),
  boardGrade: v.string(),
  printColourCount: v.number(),
  productNameEn: v.optional(v.string()),
  productNameTh: v.optional(v.string()),
  sheetLengthMm: v.optional(v.number()),
  sheetWidthMm: v.optional(v.number()),
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
  finishing: v.optional(v.array(v.string())),
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
