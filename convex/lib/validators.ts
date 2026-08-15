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
import { v, type Infer } from "convex/values";

/* -------------------------------------------------------------------------- */
/* Tenancy and identity                                                        */
/* -------------------------------------------------------------------------- */

/** Lifecycle of a tenant (`G-001`). Mirrored from onboarding, not from Clerk. */
export const organizationStatus = v.union(
  v.literal("ACTIVE"),
  v.literal("SUSPENDED"),
  v.literal("CLOSED"),
);
export type OrganizationStatus = Infer<typeof organizationStatus>;

/**
 * Lifecycle of a mirrored Clerk user (`G-003`). Clerk owns the account; this is
 * only the mirror's view of whether the person is still usable as an actor.
 */
export const userStatus = v.union(
  v.literal("ACTIVE"),
  v.literal("DEACTIVATED"),
);
export type UserStatus = Infer<typeof userStatus>;

/**
 * Lifecycle of a membership (`G-004`). `REVOKED` is terminal: revocation must be
 * observable locally so a request can fail closed without calling Clerk
 * (`INV-0001-03`).
 */
export const membershipStatus = v.union(
  v.literal("ACTIVE"),
  v.literal("SUSPENDED"),
  v.literal("REVOKED"),
);
export type MembershipStatus = Infer<typeof membershipStatus>;

/**
 * Whether a membership acts across the whole organization or only in the
 * warehouses named by its `membershipWarehouses` rows (`G-007`, §5 Q13).
 *
 * This is an explicit mode rather than "empty warehouse set means all", because
 * an accidentally empty set must deny, not escalate.
 */
export const membershipScopeMode = v.union(
  v.literal("ORG_WIDE"),
  v.literal("WAREHOUSE_SCOPED"),
);
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
export const permissionScope = v.union(
  v.literal("ORG"),
  v.literal("WAREHOUSE"),
  v.literal("PLATFORM"),
);
export type PermissionScope = Infer<typeof permissionScope>;

/** Lifecycle of a tenant-editable role (`G-005`). Roles are archived, not deleted. */
export const roleStatus = v.union(v.literal("ACTIVE"), v.literal("ARCHIVED"));
export type RoleStatus = Infer<typeof roleStatus>;

/* -------------------------------------------------------------------------- */
/* Warehouses and devices                                                      */
/* -------------------------------------------------------------------------- */

/** Lifecycle of a warehouse (`G-020`). Minimal: this slice needs it for scope only. */
export const warehouseStatus = v.union(
  v.literal("ACTIVE"),
  v.literal("INACTIVE"),
);
export type WarehouseStatus = Infer<typeof warehouseStatus>;

/**
 * Form factor of a registered device (`G-013`, D-02, D-03). A device is context
 * recorded on transactions, never an authorization subject.
 */
export const deviceType = v.union(
  v.literal("HANDHELD"),
  v.literal("WORKSTATION"),
  v.literal("TABLET"),
);
export type DeviceType = Infer<typeof deviceType>;

/** Lifecycle of a registered device. Retired devices keep their audit history. */
export const deviceStatus = v.union(v.literal("ACTIVE"), v.literal("RETIRED"));
export type DeviceStatus = Infer<typeof deviceStatus>;

/* -------------------------------------------------------------------------- */
/* Audit, denial, and idempotency                                              */
/* -------------------------------------------------------------------------- */

/**
 * What kind of actor is credited with an event (`G-012`). `PLATFORM_SUPPORT`
 * exists so support access is attributable, and it is only reachable under an
 * enabled support grant, which ships disabled (`ADR-0006` §7).
 */
export const actorKind = v.union(
  v.literal("USER"),
  v.literal("SYSTEM"),
  v.literal("PLATFORM_SUPPORT"),
);
export type ActorKind = Infer<typeof actorKind>;

/** Whether the audited attempt was permitted. Denials are audited too (`INV-0006-10`). */
export const auditOutcome = v.union(v.literal("ALLOWED"), v.literal("DENIED"));
export type AuditOutcome = Infer<typeof auditOutcome>;

/**
 * Why an attempt was denied ([catalogue](../../docs/permissions.md) §4.6).
 *
 * The reasons are distinguished because an operator needs to know which one
 * applies: "ask for the permission", "you are at the wrong site", "get an
 * approval", "reverify". Collapsing them into one message is a support cost.
 */
export const denialReason = v.union(
  v.literal("NO_PERMISSION"),
  v.literal("OUT_OF_WAREHOUSE_SCOPE"),
  v.literal("THRESHOLD_EXCEEDED"),
  v.literal("APPROVAL_REQUIRED"),
  v.literal("REVERIFICATION_REQUIRED"),
  v.literal("ENTITLEMENT_DISABLED"),
  v.literal("INACTIVE_MEMBERSHIP"),
);
export type DenialReason = Infer<typeof denialReason>;

/**
 * State of an idempotency record (§5 Q30, Q35). `IN_PROGRESS` is recorded before
 * the effect so a concurrent replay can be rejected rather than duplicated.
 */
export const idempotencyStatus = v.union(
  v.literal("IN_PROGRESS"),
  v.literal("SUCCEEDED"),
  v.literal("FAILED"),
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
export const sessionsAuditEventType = v.union(
  v.literal("SIGN_IN"),
  v.literal("SIGN_OUT"),
  v.literal("ORGANIZATION_SWITCH"),
  v.literal("STEP_UP_VERIFIED"),
  v.literal("STEP_UP_DENIED"),
  v.literal("SESSION_REVOKED"),
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
export const supportGrantStatus = v.union(
  v.literal("REQUESTED"),
  v.literal("APPROVED"),
  v.literal("ACTIVE"),
  v.literal("REJECTED"),
  v.literal("EXPIRED"),
  v.literal("REVOKED"),
);
export type SupportGrantStatus = Infer<typeof supportGrantStatus>;

/**
 * What a support grant may do. `READ_ONLY` is the default; `READ_WRITE` requires
 * two distinct platform approvals plus tenant approval (`INV-0006-09`).
 */
export const supportAccessMode = v.union(
  v.literal("READ_ONLY"),
  v.literal("READ_WRITE"),
);
export type SupportAccessMode = Infer<typeof supportAccessMode>;

/* -------------------------------------------------------------------------- */
/* Organization configuration                                                  */
/* -------------------------------------------------------------------------- */

/** Interface locale: Thai first, English fallback (D-06, B-10). */
export const locale = v.union(v.literal("th"), v.literal("en"));
export type Locale = Infer<typeof locale>;

/** Currency. MVP is single-currency per organization, THB (D-07). */
export const currency = v.union(v.literal("THB"));
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
export const masterDataStatus = v.union(
  v.literal("ACTIVE"),
  v.literal("INACTIVE"),
);
export type MasterDataStatus = Infer<typeof masterDataStatus>;

/**
 * SKU tracking mode (D-09, B-06). `LOT_SERIAL` is declared and its flows stay
 * disabled (`INV-0005-08`); declaring it now is what keeps enabling serials from
 * re-keying the ledger later.
 */
export const itemTrackingMode = v.union(
  v.literal("NONE"),
  v.literal("LOT"),
  v.literal("LOT_SERIAL"),
);
export type ItemTrackingMode = Infer<typeof itemTrackingMode>;

/**
 * Semantic classification of a physical location (`G-022`, §5 Q22).
 *
 * Deliberately excludes the glossary's "virtual boundary": a boundary is a
 * code-owned constant in `convex/model/inventory/stockIdentity.ts`, not a row
 * (`ADR-0003` §2). A tenant that could deactivate or re-parent the counterparty
 * the ledger balances against could make its own history unbalanced.
 */
export const locationType = v.union(
  v.literal("DOCK"),
  v.literal("STAGING"),
  v.literal("RACK_BIN"),
  v.literal("FLOOR_BLOCK"),
  v.literal("QUARANTINE"),
  v.literal("OVERFLOW"),
);
export type LocationType = Infer<typeof locationType>;

/** What a reason code may be cited for. Closed, so a code cannot drift in use. */
export const reasonCodeScope = v.union(
  v.literal("ADJUSTMENT"),
  v.literal("SCRAP"),
  v.literal("REVERSAL"),
  v.literal("STATUS_CHANGE"),
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
export const barcodeKind = v.union(
  v.literal("GTIN"),
  v.literal("SSCC"),
  v.literal("INTERNAL"),
  v.literal("SUPPLIER"),
);
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
export const purchaseOrderStatus = v.union(
  v.literal("DRAFT"),
  v.literal("OPEN"),
  v.literal("CLOSED"),
  v.literal("CANCELLED"),
);
export type PurchaseOrderStatusValue = Infer<typeof purchaseOrderStatus>;

/** Mirrors `PurchaseOrderLineStatus` in `convex/model/inbound/receiptPolicy.ts`. */
export const purchaseOrderLineStatus = v.union(
  v.literal("OPEN"),
  v.literal("COMPLETE"),
  v.literal("CLOSED_SHORT"),
  v.literal("CANCELLED"),
);
export type PurchaseOrderLineStatusValue = Infer<
  typeof purchaseOrderLineStatus
>;

/** How a receipt line came to exist (`INV-0007-04`). Mirrors `ReceiptLineKind`. */
export const receiptLineKind = v.union(
  v.literal("ORDERED"),
  v.literal("UNEXPECTED"),
  v.literal("CANCELLED_LINE"),
  v.literal("BLIND"),
);
export type ReceiptLineKindValue = Infer<typeof receiptLineKind>;

/** What `assessReceipt` decided about a posting. Stored as receipt evidence. */
export const receiptClassification = v.union(
  v.literal("PARTIAL"),
  v.literal("COMPLETE"),
  v.literal("OVER_WITHIN_TOLERANCE"),
  v.literal("OVER_BEYOND_TOLERANCE"),
);
export type ReceiptClassificationValue = Infer<typeof receiptClassification>;

/** The sampling strategies this repository implements (`ADR-0007` §5). */
export const samplingStrategy = v.union(
  v.literal("ALL"),
  v.literal("FIXED"),
  v.literal("PERCENT"),
);
export type SamplingStrategyValue = Infer<typeof samplingStrategy>;

/** Where held stock may go (`ADR-0007` §6). Mirrors `QcDisposition`. */
export const qcDisposition = v.union(
  v.literal("RELEASE"),
  v.literal("QUARANTINE"),
  v.literal("REJECT"),
  v.literal("SCRAP"),
  v.literal("REWORK"),
);
export type QcDispositionValue = Infer<typeof qcDisposition>;

/** An inspection's state. Mirrors `InspectionStatus`. */
export const inspectionStatus = v.union(
  v.literal("OPEN"),
  v.literal("PENDING_APPROVAL"),
  v.literal("DISPOSED"),
  v.literal("CANCELLED"),
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
export const printJobStatus = v.union(
  v.literal("GENERATED"),
  v.literal("DISPATCHED"),
  v.literal("FAILED"),
);
export type PrintJobStatusValue = Infer<typeof printJobStatus>;

/** Why a payload was generated. A reprint is audited *as* a reprint (§10). */
export const printReason = v.union(
  v.literal("INITIAL"),
  v.literal("REPRINT"),
  v.literal("PREVIEW"),
);
export type PrintReasonValue = Infer<typeof printReason>;

/** A putaway task's state. Mirrors `PutawayTaskStatus`. */
export const putawayTaskStatus = v.union(
  v.literal("READY"),
  v.literal("CLAIMED"),
  v.literal("CONFIRMED"),
  v.literal("CANCELLED"),
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
export const receivingExceptionStatus = v.union(
  v.literal("RAISED"),
  v.literal("CONSUMED"),
  v.literal("WITHDRAWN"),
);
export type ReceivingExceptionStatusValue = Infer<
  typeof receivingExceptionStatus
>;

/** An import batch's state (`INV-0007-12`). */
export const importBatchStatus = v.union(
  v.literal("PREVIEWED"),
  v.literal("APPLYING"),
  v.literal("APPLIED"),
  v.literal("ABANDONED"),
);
export type ImportBatchStatusValue = Infer<typeof importBatchStatus>;

export const labelTemplateFormat = v.union(v.literal("ZPL"), v.literal("PDF"));
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
export const labelTemplateStatus = v.union(
  v.literal("DRAFT"),
  v.literal("ACTIVE"),
  v.literal("RETIRED"),
);
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
export const stockStatus = v.union(
  v.literal("AVAILABLE"),
  v.literal("QC_HOLD"),
  v.literal("QUARANTINE"),
  v.literal("REJECTED"),
  v.literal("SCRAP"),
  v.literal("EXPIRED"),
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
export const ledgerLocationKind = v.union(
  v.literal("PHYSICAL"),
  v.literal("VIRTUAL"),
);
export type LedgerLocationKindValue = Infer<typeof ledgerLocationKind>;

/** Code-owned counterparties outside the warehouse. Mirrors `VIRTUAL_BOUNDARIES`. */
export const virtualBoundaryCode = v.union(
  v.literal("SUPPLIER_RECEIPT"),
  v.literal("CUSTOMER_SHIPMENT"),
  v.literal("PRODUCTION_ISSUE"),
  v.literal("PRODUCTION_RECEIPT"),
  v.literal("INVENTORY_ADJUSTMENT"),
  v.literal("SCRAP_DAMAGE"),
  v.literal("RECONCILIATION"),
);
export type VirtualBoundaryCodeValue = Infer<typeof virtualBoundaryCode>;

/** What kind of movement a transaction records. Mirrors `INVENTORY_TRANSACTION_TYPES`. */
export const inventoryTransactionType = v.union(
  v.literal("RECEIPT"),
  v.literal("PUTAWAY"),
  v.literal("MOVE"),
  v.literal("STATUS_CHANGE"),
  v.literal("ADJUSTMENT"),
  v.literal("SCRAP"),
  v.literal("SHIPMENT"),
  v.literal("PRODUCTION_ISSUE"),
  v.literal("PRODUCTION_RECEIPT"),
  v.literal("REVERSAL"),
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
export const rollupMetric = v.union(
  v.literal("RECEIPTS_OPENED"),
  v.literal("RECEIPT_LINES_POSTED"),
  v.literal("QC_PENDING"),
  v.literal("QC_PARKED"),
  v.literal("PUTAWAY_READY"),
  v.literal("PUTAWAY_CLAIMED"),
  v.literal("LOCATION_OCCUPANCY"),
);
export type RollupMetricValue = Infer<typeof rollupMetric>;

/** What an export contains. Closed, because each kind names its own columns. */
export const reportKind = v.union(
  v.literal("INVENTORY_BALANCES"),
  v.literal("RECEIPT_LINES"),
  v.literal("PUTAWAY_TASKS"),
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
export const reportJobStatus = v.union(
  v.literal("QUEUED"),
  v.literal("RUNNING"),
  v.literal("COMPLETE"),
  v.literal("FAILED"),
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
export const customerOrderStatus = v.union(
  v.literal("DRAFT"),
  v.literal("RELEASED"),
  v.literal("CANCELLED"),
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
export const customerOrderLineStatus = v.union(
  v.literal("AWAITING_DESIGN"),
  v.literal("DESIGN_READY"),
  v.literal("HANDED_OFF"),
  v.literal("CANCELLED"),
);
export type CustomerOrderLineStatusValue = Infer<
  typeof customerOrderLineStatus
>;

/**
 * Where a line's design came from (`G-124`).
 *
 * Two members, no third for "similar". `WF-04` — whether near-matches should be
 * suggested — is open, and a `SIMILAR` value would be a decision this repository
 * has not been given.
 */
export const designSource = v.union(v.literal("EXISTING"), v.literal("NEW"));
export type DesignSourceValue = Infer<typeof designSource>;

/**
 * Lifecycle of a design request (`G-123`).
 *
 * `ASSIGNED` is distinct from `OPEN` because "nobody has picked this up" and
 * "someone owes it" are different answers for a sales person chasing a date.
 * `FULFILLED` means a released revision now exists and the line was pinned to it;
 * there is no `IN_PROGRESS`, because nothing observes it.
 */
export const designRequestStatus = v.union(
  v.literal("OPEN"),
  v.literal("ASSIGNED"),
  v.literal("IN_PROGRESS"),
  v.literal("IN_REVIEW"),
  v.literal("FULFILLED"),
  v.literal("CANCELLED"),
);
export type DesignRequestStatusValue = Infer<typeof designRequestStatus>;

export const designRequestPriority = v.union(
  v.literal("LOW"),
  v.literal("NORMAL"),
  v.literal("HIGH"),
  v.literal("URGENT"),
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
export const masterCardRevisionStatus = v.union(
  v.literal("DRAFT"),
  v.literal("IN_REVIEW"),
  v.literal("RELEASED"),
  v.literal("REJECTED"),
  v.literal("SUPERSEDED"),
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
export const masterCardFileKind = v.union(
  v.literal("DIELINE"),
  v.literal("ARTWORK"),
  v.literal("PHOTO"),
  v.literal("OTHER"),
);
export type MasterCardFileKindValue = Infer<typeof masterCardFileKind>;

/**
 * Whether a file's bytes exist anywhere yet (`ADR-0008`, `INT-03`).
 *
 * `REGISTERED` is metadata awaiting storage verification, `AVAILABLE` means the
 * private adapter can retrieve the object, and `FAILED` keeps a visible retryable
 * failure. Only `AVAILABLE` satisfies revision submission.
 */
export const masterCardFileStorageState = v.union(
  v.literal("REGISTERED"),
  v.literal("AVAILABLE"),
  v.literal("FAILED"),
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
export const factoryPacketStatus = v.union(
  v.literal("ISSUED"),
  v.literal("ACKNOWLEDGED"),
  v.literal("CANCELLED"),
);
export type FactoryPacketStatusValue = Infer<typeof factoryPacketStatus>;

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
