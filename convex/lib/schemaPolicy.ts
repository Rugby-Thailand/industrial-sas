/**
 * Schema policy: the machine-readable statement of what the schema is allowed to
 * look like, plus the introspection needed to check it.
 *
 * Status: **schema foundation only.** This module is metadata and pure
 * functions. It reads a `SchemaDefinition`; it never touches a database.
 *
 * Why this exists rather than a prose rule in an ADR: `orgId`-first tenancy
 * (D-18, `INV-0002-02`), a fixed global-table allowlist, bounded external
 * lookups, the cardinality each indexed key actually claims, and the absence of
 * credential fields are all properties of the finished schema. A property that
 * only a reviewer checks decays on the first busy week. Everything below is
 * stated once, as data, and asserted by `tests/isolation/` and
 * `tests/integration/`.
 *
 * The design intent is that this file is the *expectation* and `convex/schema.ts`
 * is the *implementation*, so drift in either direction fails: a new table that
 * nobody classified fails as loudly as a tenant table that lost its `orgId`.
 *
 * `schemaPolicyViolations` is the composed entry point; the individual checks stay
 * exported so a failure names one rule. The checks are proved to *fire*, not only
 * to pass, by `tests/isolation/schema-policy-guards.isolation.test.ts`, which
 * feeds them synthetic `TableFacts` and throwaway schema values. Proving a guard
 * by breaking the real schema would leave the repository one forgotten revert away
 * from shipping the break.
 *
 * Baseline:
 * [ADR-0002](../../docs/adr/0002-convex-tenant-boundary-and-index-discipline.md),
 * [ADR-0001](../../docs/adr/0001-multi-tenant-saas-and-identity-ownership.md),
 * [ADR-0006](../../docs/adr/0006-authorization-and-support-access.md).
 */
import type {
  GenericSchema,
  SchemaDefinition,
  TableDefinition,
} from "convex/server";
import type { GenericValidator } from "convex/values";

import { TENANT_DISCRIMINATOR } from "./tenantTable";

/* -------------------------------------------------------------------------- */
/* Table classification                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The complete allowlist of tables that legitimately have no `orgId`
 * (`ADR-0002` §1).
 *
 * - `organizations` is the tenant root: its document ID *is* the `orgId`.
 * - `users` is a global Clerk identity reference, because one person may hold
 *   memberships in several tenants (C-02). Tenancy lives in `memberships`.
 * - `permissions` is code-owned reference data, identical for every tenant
 *   (`INV-0006-02`).
 *
 * Adding a fourth entry is a security decision, not a schema convenience. It
 * means "this data is readable without a tenant in hand".
 */
export const GLOBAL_TABLES = ["organizations", "users", "permissions"] as const;

/** Tables that must carry `orgId` and index it first. */
export const TENANT_TABLES = [
  "warehouses",
  "memberships",
  "membershipRoles",
  "membershipWarehouses",
  "roles",
  "rolePermissions",
  "entitlements",
  "auditEvents",
  "idempotencyRecords",
  "devices",
  "sessionsAudit",
  "supportGrants",
  "operatorTasks",
  "operatorTaskEvidence",
  "operatorTaskExceptions",
  "operatorTaskAttachments",
  "operatorTaskUploadGrants",
  "operatorTaskFileAccessGrants",
  "stepUpApprovals",
  "items",
  "locations",
  "lots",
  "handlingUnits",
  "owners",
  "reasonCodes",
  "suppliers",
  "itemBarcodes",
  "itemUoms",
  "storageClasses",
  "labelTemplates",
  "storageBuildings",
  "storageFloors",
  "storageFloorReservedBlocks",
  "storageZones",
  "storageStackPlacements",
  "openingStockBatches",
  "openingStockRows",
  "openingStockImportChunks",
  "openingStockPostChunks",
  "countPlans",
  "countTasks",
  "countSnapshots",
  "countEntries",
  "countReconciliations",
  "countPaperCaptures",
  "inventoryTransactions",
  "inventoryLedgerLines",
  "inventoryBalances",
  "purchaseOrders",
  "purchaseOrderLines",
  "poImportBatches",
  "receipts",
  "receiptLines",
  "receivingExceptions",
  "qcProfiles",
  "qcInspections",
  "labelPrintJobs",
  "putawayTasks",
  "operationsRollups",
  "dashboardPreferences",
  "reportJobs",
  "customers",
  "customerOrders",
  "customerOrderLines",
  "fulfillmentOrders",
  "fulfillmentLines",
  "fulfillmentAllocationRuns",
  "inventoryReservations",
  "pickWaves",
  "pickTasks",
  "pickTaskLines",
  "pickEvents",
  "fulfillmentPackages",
  "shipments",
  "shipmentPackages",
  "trips",
  "tripShipments",
  "loadEvents",
  "gatePasses",
  "deliveryMilestones",
  "transportFiles",
  "transportFileUploadGrants",
  "transportFileAccessGrants",
  "proofOfDeliveries",
  "documentReturns",
  "transferRequests",
  "transferLines",
  "transferDiscrepancies",
  "designRequests",
  "designRequirementVersions",
  "masterCards",
  "masterCardRevisions",
  "designChangeImpacts",
  "masterCardFiles",
  "masterCardUploadGrants",
  "masterCardFileAccessGrants",
  "masterCardImportChunks",
  "factoryPackets",
  "factoryPacketFiles",
  "productionOrders",
  "productionMaterialRequirements",
  "productionMaterialIssues",
  "productionOperationReports",
  "productionOutputReceipts",
  "employees",
  "hrTeams",
  "attendanceEvents",
  "attendanceDays",
  "attendanceCorrections",
  "leaveRequests",
  "integrationAdapters",
  "integrationOutboxMessages",
  "integrationDeliveryAttempts",
] as const;

export type GlobalTableName = (typeof GLOBAL_TABLES)[number];
export type TenantTableName = (typeof TENANT_TABLES)[number];

export type TableClassification = "global" | "tenant" | "unclassified";

/** How this policy classifies a table name. */
export function classifyTable(name: string): TableClassification {
  if ((GLOBAL_TABLES as readonly string[]).includes(name)) return "global";
  if ((TENANT_TABLES as readonly string[]).includes(name)) return "tenant";
  return "unclassified";
}

/* -------------------------------------------------------------------------- */
/* Forbidden field vocabulary                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Words that must not appear in any field name, at any depth.
 *
 * Clerk owns credentials, MFA, and sessions (C-03), so a field named after one
 * of these is either a mistake or a boundary violation (`INV-0001-06`). The check
 * is on *words*, not substrings, because substring matching on "pin" or "key"
 * flags innocent names like `shipping` or `roles.key` and a noisy guard gets
 * disabled.
 */
export const FORBIDDEN_FIELD_WORDS = [
  "password",
  "passwd",
  "passcode",
  "secret",
  "secrets",
  "token",
  "tokens",
  "credential",
  "credentials",
  "mfa",
  "totp",
  "otp",
  "pin",
  "cookie",
  "bearer",
  "jwt",
  "authorization",
] as const;

/**
 * Two-word combinations that are credential material even though neither word is
 * alone. `roles.key` is legitimate; `apiKey` is not.
 */
export const FORBIDDEN_FIELD_PHRASES = [
  "apikey",
  "accesskey",
  "secretkey",
  "signingkey",
  "privatekey",
  "sessiontoken",
  "refreshtoken",
  "accesstoken",
  "recoverycode",
  "backupcode",
] as const;

/**
 * Split a field path into lowercase words: `tenantApprovalByUserId` becomes
 * `["tenant", "approval", "by", "user", "id"]`. Array and record markers are
 * dropped; dots and underscores are separators.
 */
export function fieldWords(fieldPath: string): readonly string[] {
  return fieldPath
    .replaceAll("[]", "")
    .replaceAll("[*]", "")
    .split(/[._]/)
    .flatMap((part) => part.split(/(?=[A-Z])/))
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 0);
}

/* -------------------------------------------------------------------------- */
/* Uniqueness and bounded-lookup contracts                                     */
/* -------------------------------------------------------------------------- */

/**
 * When a uniqueness contract applies.
 *
 * An optional field cannot be unconditionally unique: two documents that both
 * omit it are two documents, not a collision. Convex has no partial unique index
 * either, so the qualifier has to be carried as data — otherwise the future
 * mutation reads "unique by contract" next to an optional field and has to guess
 * whether `undefined === undefined` is a duplicate.
 *
 * - `always` — every document in the table participates.
 * - `whenPresent` — only documents where every named field is present, and each
 *   named field must be optional in the schema and part of the key.
 */
export type UniquenessCondition =
  | { readonly kind: "always" }
  | { readonly kind: "whenPresent"; readonly fields: readonly string[] };

/**
 * The contract holds for every document in the table.
 *
 * Frozen because one object is shared by every unconditional contract: an
 * accidental write would silently retype a dozen contracts at once.
 */
export const ALWAYS: UniquenessCondition = Object.freeze({
  kind: "always",
} as const);

/** The contract holds only where every named optional field has a value. */
export function whenPresent(...fields: readonly string[]): UniquenessCondition {
  return { kind: "whenPresent", fields };
}

/**
 * A key that must be unique, and — by `uniquenessIndexName` — the index that
 * makes checking it bounded.
 *
 * Convex has no unique constraint, so uniqueness is always a code obligation.
 * The obligation is only affordable if the check is a single indexed lookup, so
 * the key must be indexed by exactly those fields in that order. The index
 * *name* is that key spelled out, so it is derived rather than restated: a
 * second spelling of the same fact is a second thing to get wrong.
 *
 * Every tenant contract begins with `orgId`, so a uniqueness scope never spans
 * tenants: one tenant's warehouse code can never collide with, or disclose,
 * another's.
 *
 * `condition` is required rather than defaulted, because "is an absent value a
 * collision?" is exactly the question a default would hide.
 */
export type UniquenessContract = {
  readonly table: string;
  readonly key: readonly string[];
  readonly condition: UniquenessCondition;
};

/** The index a uniqueness key must be resolved through: the key, spelled out. */
export function uniquenessIndexName(key: readonly string[]): string {
  return `by_${key.join("_")}`;
}

export const UNIQUENESS_CONTRACTS: readonly UniquenessContract[] = [
  { table: "organizations", key: ["clerkOrganizationId"], condition: ALWAYS },
  { table: "users", key: ["clerkUserId"], condition: ALWAYS },
  { table: "permissions", key: ["code"], condition: ALWAYS },
  { table: "warehouses", key: ["orgId", "code"], condition: ALWAYS },
  { table: "memberships", key: ["orgId", "userId"], condition: ALWAYS },
  {
    table: "memberships",
    key: ["orgId", "clerkMembershipId"],
    condition: ALWAYS,
  },
  {
    table: "membershipRoles",
    key: ["orgId", "membershipId", "roleId"],
    condition: ALWAYS,
  },
  {
    table: "membershipWarehouses",
    key: ["orgId", "membershipId", "warehouseId"],
    condition: ALWAYS,
  },
  { table: "roles", key: ["orgId", "key"], condition: ALWAYS },
  {
    table: "rolePermissions",
    key: ["orgId", "roleId", "permissionCode"],
    condition: ALWAYS,
  },
  { table: "entitlements", key: ["orgId", "key"], condition: ALWAYS },
  {
    table: "idempotencyRecords",
    key: ["orgId", "operation", "requestId"],
    condition: ALWAYS,
  },
  {
    table: "devices",
    key: ["orgId", "installationId"],
    condition: whenPresent("installationId"),
  },
  { table: "devices", key: ["orgId", "label"], condition: ALWAYS },
  { table: "operatorTasks", key: ["orgId", "taskNumber"], condition: ALWAYS },
  {
    table: "operatorTaskEvidence",
    key: ["orgId", "operatorTaskId", "sequence"],
    condition: ALWAYS,
  },
  { table: "items", key: ["orgId", "sku"], condition: ALWAYS },
  {
    table: "locations",
    key: ["orgId", "warehouseId", "code"],
    condition: ALWAYS,
  },
  { table: "lots", key: ["orgId", "itemId", "lotCode"], condition: ALWAYS },
  { table: "handlingUnits", key: ["orgId", "lpn"], condition: ALWAYS },
  { table: "owners", key: ["orgId", "code"], condition: ALWAYS },
  { table: "reasonCodes", key: ["orgId", "code"], condition: ALWAYS },
  {
    table: "inventoryTransactions",
    key: ["orgId", "operation", "requestId"],
    condition: ALWAYS,
  },
  {
    table: "inventoryTransactions",
    key: ["orgId", "reversalOfTransactionId"],
    condition: whenPresent("reversalOfTransactionId"),
  },
  {
    table: "inventoryLedgerLines",
    key: ["orgId", "transactionId", "lineIndex"],
    condition: ALWAYS,
  },
  {
    table: "inventoryBalances",
    key: ["orgId", "bucketKey"],
    condition: ALWAYS,
  },
  {
    table: "operationsRollups",
    key: ["orgId", "warehouseId", "metric", "subjectKey"],
    condition: ALWAYS,
  },
  { table: "reportJobs", key: ["orgId", "requestId"], condition: ALWAYS },
  { table: "suppliers", key: ["orgId", "code"], condition: ALWAYS },
  { table: "itemBarcodes", key: ["orgId", "barcode"], condition: ALWAYS },
  { table: "itemUoms", key: ["orgId", "itemId", "uom"], condition: ALWAYS },
  { table: "storageClasses", key: ["orgId", "code"], condition: ALWAYS },
  {
    table: "labelTemplates",
    key: ["orgId", "code", "version"],
    condition: ALWAYS,
  },
  {
    table: "openingStockBatches",
    key: ["orgId", "batchRef"],
    condition: ALWAYS,
  },
  {
    table: "openingStockRows",
    key: ["orgId", "openingStockBatchId", "sourceRowNumber"],
    condition: ALWAYS,
  },
  {
    table: "openingStockImportChunks",
    key: ["orgId", "openingStockBatchId", "startSourceRowNumber"],
    condition: ALWAYS,
  },
  {
    table: "openingStockImportChunks",
    key: ["orgId", "requestId"],
    condition: ALWAYS,
  },
  {
    table: "openingStockPostChunks",
    key: ["orgId", "openingStockBatchId", "chunkNumber"],
    condition: ALWAYS,
  },
  {
    table: "openingStockPostChunks",
    key: ["orgId", "requestId"],
    condition: ALWAYS,
  },
  { table: "countPlans", key: ["orgId", "planNumber"], condition: ALWAYS },
  {
    table: "countTasks",
    key: ["orgId", "countPlanId", "taskNumber"],
    condition: ALWAYS,
  },
  {
    table: "countSnapshots",
    key: ["orgId", "countTaskId", "bucketKey"],
    condition: ALWAYS,
  },
  {
    table: "countEntries",
    key: ["orgId", "countSnapshotId", "countOrdinal"],
    condition: ALWAYS,
  },
  {
    table: "countReconciliations",
    key: ["orgId", "countSnapshotId"],
    condition: ALWAYS,
  },
  {
    table: "countPaperCaptures",
    key: ["orgId", "countTaskId", "captureOrdinal"],
    condition: ALWAYS,
  },
  { table: "purchaseOrders", key: ["orgId", "poNumber"], condition: ALWAYS },
  {
    table: "purchaseOrderLines",
    key: ["orgId", "purchaseOrderId", "lineNumber"],
    condition: ALWAYS,
  },
  {
    table: "purchaseOrderLines",
    key: ["orgId", "sourceRowRef"],
    condition: whenPresent("sourceRowRef"),
  },
  { table: "poImportBatches", key: ["orgId", "batchRef"], condition: ALWAYS },
  { table: "receipts", key: ["orgId", "receiptNumber"], condition: ALWAYS },
  {
    table: "qcInspections",
    key: ["orgId", "receiptLineId"],
    condition: ALWAYS,
  },
  { table: "putawayTasks", key: ["orgId", "receiptLineId"], condition: ALWAYS },
  { table: "customers", key: ["orgId", "code"], condition: ALWAYS },
  { table: "customerOrders", key: ["orgId", "orderNumber"], condition: ALWAYS },
  {
    table: "customerOrders",
    key: ["orgId", "customerId", "customerReference"],
    condition: whenPresent("customerReference"),
  },
  {
    table: "customerOrderLines",
    key: ["orgId", "customerOrderId", "lineNumber"],
    condition: ALWAYS,
  },
  {
    table: "fulfillmentOrders",
    key: ["orgId", "fulfillmentNumber"],
    condition: ALWAYS,
  },
  {
    table: "fulfillmentOrders",
    key: ["orgId", "customerOrderId", "warehouseId"],
    condition: ALWAYS,
  },
  {
    table: "fulfillmentLines",
    key: ["orgId", "fulfillmentOrderId", "customerOrderLineId"],
    condition: ALWAYS,
  },
  {
    table: "fulfillmentLines",
    key: ["orgId", "customerOrderLineId"],
    condition: ALWAYS,
  },
  {
    table: "inventoryReservations",
    key: ["orgId", "allocationRunId", "bucketKey"],
    condition: ALWAYS,
  },
  { table: "pickWaves", key: ["orgId", "waveNumber"], condition: ALWAYS },
  {
    table: "pickTasks",
    key: ["orgId", "pickWaveId", "taskNumber"],
    condition: ALWAYS,
  },
  {
    table: "pickTasks",
    key: ["orgId", "pickWaveId", "fulfillmentLineId"],
    condition: ALWAYS,
  },
  {
    table: "pickTaskLines",
    key: ["orgId", "pickTaskId", "lineNumber"],
    condition: ALWAYS,
  },
  {
    table: "pickTaskLines",
    key: ["orgId", "inventoryReservationId"],
    condition: ALWAYS,
  },
  {
    table: "pickEvents",
    key: ["orgId", "pickTaskId", "sequence"],
    condition: ALWAYS,
  },
  {
    table: "fulfillmentPackages",
    key: ["orgId", "packageNumber"],
    condition: ALWAYS,
  },
  {
    table: "fulfillmentPackages",
    key: ["orgId", "pickTaskId"],
    condition: ALWAYS,
  },
  { table: "shipments", key: ["orgId", "shipmentNumber"], condition: ALWAYS },
  {
    table: "shipmentPackages",
    key: ["orgId", "shipmentId", "fulfillmentPackageId"],
    condition: ALWAYS,
  },
  {
    table: "shipmentPackages",
    key: ["orgId", "fulfillmentPackageId"],
    condition: ALWAYS,
  },
  { table: "trips", key: ["orgId", "tripNumber"], condition: ALWAYS },
  { table: "tripShipments", key: ["orgId", "shipmentId"], condition: ALWAYS },
  {
    table: "loadEvents",
    key: ["orgId", "tripId", "sequence"],
    condition: ALWAYS,
  },
  { table: "gatePasses", key: ["orgId", "gatePassNumber"], condition: ALWAYS },
  { table: "gatePasses", key: ["orgId", "tripId"], condition: ALWAYS },
  {
    table: "deliveryMilestones",
    key: ["orgId", "shipmentId", "sequence"],
    condition: ALWAYS,
  },
  {
    table: "transportFiles",
    key: ["orgId", "storageObjectId"],
    condition: ALWAYS,
  },
  {
    table: "proofOfDeliveries",
    key: ["orgId", "shipmentId"],
    condition: ALWAYS,
  },
  {
    table: "documentReturns",
    key: ["orgId", "shipmentId", "documentType"],
    condition: ALWAYS,
  },
  {
    table: "designRequests",
    key: ["orgId", "requestNumber"],
    condition: ALWAYS,
  },
  {
    table: "designRequirementVersions",
    key: ["orgId", "designRequestId", "version"],
    condition: ALWAYS,
  },
  {
    table: "designChangeImpacts",
    key: ["orgId", "toRevisionId", "productionOrderId"],
    condition: ALWAYS,
  },
  {
    table: "designRequests",
    key: ["orgId", "customerOrderLineId"],
    condition: ALWAYS,
  },
  { table: "masterCards", key: ["orgId", "cardNumber"], condition: ALWAYS },
  {
    table: "masterCards",
    key: ["orgId", "customerId", "customerProductCode"],
    condition: ALWAYS,
  },
  {
    table: "masterCardRevisions",
    key: ["orgId", "masterCardId", "revisionNumber"],
    condition: ALWAYS,
  },
  {
    table: "masterCardFiles",
    key: ["orgId", "masterCardRevisionId", "fileKey"],
    condition: ALWAYS,
  },
  {
    table: "masterCardImportChunks",
    key: ["orgId", "batchRef", "startSourceRow"],
    condition: ALWAYS,
  },
  {
    table: "factoryPackets",
    key: ["orgId", "packetNumber"],
    condition: ALWAYS,
  },
  {
    table: "factoryPackets",
    key: ["orgId", "customerOrderLineId"],
    condition: ALWAYS,
  },
  {
    table: "factoryPacketFiles",
    key: ["orgId", "factoryPacketId", "masterCardFileId"],
    condition: ALWAYS,
  },
  { table: "employees", key: ["orgId", "employeeNumber"], condition: ALWAYS },
  {
    table: "employees",
    key: ["orgId", "userId"],
    condition: whenPresent("userId"),
  },
  { table: "hrTeams", key: ["orgId", "code"], condition: ALWAYS },
  { table: "attendanceEvents", key: ["orgId", "commandId"], condition: ALWAYS },
  {
    table: "attendanceDays",
    key: ["orgId", "employeeId", "businessDate"],
    condition: ALWAYS,
  },
  {
    table: "attendanceCorrections",
    key: ["orgId", "requestId"],
    condition: ALWAYS,
  },
  { table: "leaveRequests", key: ["orgId", "requestId"], condition: ALWAYS },
  { table: "integrationAdapters", key: ["orgId", "code"], condition: ALWAYS },
  {
    table: "integrationOutboxMessages",
    key: ["orgId", "eventKey"],
    condition: ALWAYS,
  },
  {
    table: "integrationDeliveryAttempts",
    key: ["orgId", "messageId", "attemptNumber"],
    condition: ALWAYS,
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Bounded lookup contracts (indexed, deliberately not unique)                 */
/* -------------------------------------------------------------------------- */

/**
 * A key that must be indexed so its reads are bounded, and whose cardinality is
 * deliberately many.
 *
 * An index alone says nothing about cardinality, and the absence of a uniqueness
 * contract is indistinguishable from an oversight. Listing a key here is what
 * says "many, on purpose", and what stops a later mutation from inventing a
 * one-per-key rule the domain never asked for.
 *
 * Unlike a uniqueness contract, this names no index: the read is a range over
 * many rows, so *any* index that begins with the key bounds it, and naming one
 * would forbid a wider index that serves the same read plus an ordering.
 */
export type LookupContract = {
  readonly table: string;
  readonly key: readonly string[];
};

export const BOUNDED_LOOKUP_CONTRACTS: readonly LookupContract[] = [
  { table: "integrationAdapters", key: ["orgId", "status"] },
  { table: "integrationOutboxMessages", key: ["orgId", "adapterId", "status"] },
  { table: "integrationDeliveryAttempts", key: ["orgId", "adapterId"] },
  { table: "employees", key: ["orgId", "warehouseId", "status"] },
  { table: "employees", key: ["orgId", "teamId", "status"] },
  { table: "hrTeams", key: ["orgId", "warehouseId", "status"] },
  { table: "attendanceEvents", key: ["orgId", "employeeId"] },
  { table: "attendanceEvents", key: ["orgId", "attendanceDayId"] },
  {
    table: "attendanceDays",
    key: ["orgId", "warehouseId", "businessDate", "status"],
  },
  { table: "attendanceCorrections", key: ["orgId", "employeeId", "status"] },
  { table: "attendanceCorrections", key: ["orgId", "warehouseId", "status"] },
  { table: "leaveRequests", key: ["orgId", "employeeId", "status"] },
  { table: "leaveRequests", key: ["orgId", "warehouseId", "status"] },
  { table: "masterCardUploadGrants", key: ["orgId", "expiresAt"] },
  { table: "operatorTasks", key: ["orgId", "warehouseId", "status"] },
  { table: "operatorTasks", key: ["orgId", "claimedByUserId"] },
  { table: "operatorTaskEvidence", key: ["orgId", "operatorTaskId"] },
  { table: "operatorTaskExceptions", key: ["orgId", "operatorTaskId"] },
  { table: "operatorTaskAttachments", key: ["orgId", "operatorTaskId"] },
  { table: "stepUpApprovals", key: ["orgId", "operatorUserId"] },
  { table: "stepUpApprovals", key: ["orgId", "targetRef"] },
  { table: "supportGrants", key: ["orgId", "ticketRef"] },
  { table: "inventoryLedgerLines", key: ["orgId", "bucketKey"] },
  { table: "inventoryTransactions", key: ["orgId", "warehouseId"] },
  {
    table: "inventoryBalances",
    key: ["orgId", "warehouseId", "itemId", "stockStatus"],
  },
  { table: "operationsRollups", key: ["orgId", "warehouseId", "metric"] },
  { table: "reportJobs", key: ["orgId", "warehouseId", "status"] },
  { table: "itemBarcodes", key: ["orgId", "itemId"] },
  { table: "itemUoms", key: ["orgId", "itemId"] },
  { table: "labelTemplates", key: ["orgId", "code"] },
  { table: "receiptLines", key: ["orgId", "receiptId"] },
  { table: "labelPrintJobs", key: ["orgId", "targetKind", "targetId"] },
  { table: "customerOrderLines", key: ["orgId", "customerOrderId"] },
  { table: "customerOrderLines", key: ["orgId", "status", "designKey"] },
  { table: "masterCards", key: ["orgId", "customerId", "designKey"] },
  { table: "masterCardRevisions", key: ["orgId", "masterCardId"] },
  { table: "masterCardFiles", key: ["orgId", "masterCardRevisionId"] },
  {
    table: "masterCardUploadGrants",
    key: ["orgId", "masterCardRevisionId", "expiresAt"],
  },
  {
    table: "masterCardUploadGrants",
    key: ["orgId", "batchRef", "sourceRow", "expiresAt"],
  },
  {
    table: "masterCardFileAccessGrants",
    key: ["orgId", "masterCardFileId", "expiresAt"],
  },
  { table: "masterCardImportChunks", key: ["orgId", "batchRef"] },
  {
    table: "masterCardImportChunks",
    key: ["orgId", "batchRef", "nextSourceRow"],
  },
  { table: "factoryPackets", key: ["orgId", "warehouseId", "status"] },
  { table: "factoryPacketFiles", key: ["orgId", "factoryPacketId"] },
  { table: "factoryPacketFiles", key: ["orgId", "masterCardFileId"] },
  {
    table: "transportFileUploadGrants",
    key: ["orgId", "shipmentId", "expiresAt"],
  },
  {
    table: "transportFileAccessGrants",
    key: ["orgId", "transportFileId", "expiresAt"],
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Third-normal-form contracts                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A functional dependency that must be resolved through its authoritative row
 * instead of copied onto the named table.
 *
 * Convex cannot infer functional dependencies from validators, so the schema
 * records the ones most likely to regress as explicit policy. Append-only audit
 * evidence and materialized projections are outside this contract; these rules
 * cover mutable operational source-of-truth rows.
 */
export type ThirdNormalFormContract = {
  readonly table: string;
  readonly determinant: readonly string[];
  readonly dependentFields: readonly string[];
};

export const THIRD_NORMAL_FORM_CONTRACTS: readonly ThirdNormalFormContract[] = [
  {
    table: "designRequests",
    determinant: ["customerOrderLineId"],
    dependentFields: [
      "customerId",
      "customerProductCode",
      "designKey",
      "specification",
    ],
  },
  {
    table: "factoryPackets",
    determinant: ["customerOrderLineId"],
    dependentFields: [
      "customerId",
      "customerOrderNumber",
      "customerReference",
      "quantity",
    ],
  },
  {
    table: "factoryPackets",
    determinant: ["masterCardRevisionId"],
    dependentFields: [
      "revisionNumber",
      "specification",
      "releaseEvidence",
      "approvedFileIds",
    ],
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Introspection                                                               */
/* -------------------------------------------------------------------------- */

export type IndexFacts = {
  readonly name: string;
  readonly fields: readonly string[];
};

export type TableFacts = {
  readonly name: string;
  readonly classification: TableClassification;
  /** Top-level document fields, excluding Convex's `_id` and `_creationTime`. */
  readonly fieldNames: readonly string[];
  /** The subset of `fieldNames` declared with `v.optional(...)`. */
  readonly optionalFieldNames: readonly string[];
  /** Every field path, including nested object, array (`[]`), and record (`[*]`) paths. */
  readonly fieldPaths: readonly string[];
  readonly indexes: readonly IndexFacts[];
};

/** Recursively collect nested field paths beneath `path`. */
function descend(
  validator: GenericValidator,
  path: string,
  out: string[],
): void {
  switch (validator.kind) {
    case "object":
      for (const [name, child] of Object.entries(validator.fields)) {
        const childPath = `${path}.${name}`;
        out.push(childPath);
        descend(child, childPath, out);
      }
      return;
    case "array":
      descend(validator.element, `${path}[]`, out);
      return;
    case "record":
      descend(validator.value, `${path}[*]`, out);
      return;
    case "union":
      for (const member of validator.members) descend(member, path, out);
      return;
    default:
      return;
  }
}

/**
 * Read the shape of one table definition.
 *
 * Uses `TableDefinition[" indexes"]()`, which Convex documents as experimental.
 * It is the only public read seam for declared indexes; the alternative is
 * parsing `schema.ts` as text, which is worse. If Convex renames it, this
 * function fails to compile — a loud, local failure rather than a silent gap in
 * the guard.
 */
export function describeTable(
  name: string,
  definition: TableDefinition,
): TableFacts {
  const documentValidator = definition.validator;
  if (documentValidator.kind !== "object") {
    throw new Error(
      `Table "${name}" does not have an object document validator. ` +
        "Discriminated-union tables are not part of this schema and the policy " +
        "checks do not model them.",
    );
  }

  const fieldNames = Object.keys(documentValidator.fields);
  const optionalFieldNames: string[] = [];
  const fieldPaths: string[] = [];
  for (const [fieldName, fieldValidator] of Object.entries(
    documentValidator.fields,
  )) {
    if (fieldValidator.isOptional === "optional")
      optionalFieldNames.push(fieldName);
    fieldPaths.push(fieldName);
    descend(fieldValidator, fieldName, fieldPaths);
  }

  return {
    name,
    classification: classifyTable(name),
    fieldNames,
    optionalFieldNames,
    fieldPaths,
    indexes: definition[" indexes"]().map((index) => ({
      name: index.indexDescriptor,
      fields: index.fields,
    })),
  };
}

/** Read the shape of every table in a schema. */
export function describeSchema(
  schema: SchemaDefinition<GenericSchema, boolean>,
): readonly TableFacts[] {
  return Object.entries(schema.tables).map(([name, definition]) =>
    describeTable(name, definition),
  );
}

/* -------------------------------------------------------------------------- */
/* Policy checks                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Violations of `orgId`-first discipline on a tenant table (D-18,
 * `INV-0002-02`).
 *
 * The discriminator must be present, first, and required. "First" is what makes
 * the rule reviewable at a glance in the schema and in generated types; required
 * is what stops a document from belonging to no tenant, and therefore to every
 * query that forgets to filter.
 *
 * Requiring at least one index is part of the rule: a tenant table with no index
 * can only be read by scanning it, and a scan is how cross-tenant reads happen
 * (`INV-0002-04`).
 */
export function tenantTableViolations(facts: TableFacts): readonly string[] {
  const problems: string[] = [];

  if (!facts.fieldNames.includes(TENANT_DISCRIMINATOR)) {
    problems.push(
      `${facts.name}: tenant table has no "${TENANT_DISCRIMINATOR}" field`,
    );
  }
  if (facts.fieldNames[0] !== TENANT_DISCRIMINATOR) {
    problems.push(
      `${facts.name}: "${TENANT_DISCRIMINATOR}" is not the first declared field ` +
        `(found "${facts.fieldNames[0] ?? "<none>"}")`,
    );
  }
  if (facts.optionalFieldNames.includes(TENANT_DISCRIMINATOR)) {
    problems.push(
      `${facts.name}: "${TENANT_DISCRIMINATOR}" is optional; a document with no ` +
        "tenant belongs to every tenant",
    );
  }
  if (facts.indexes.length === 0) {
    problems.push(
      `${facts.name}: tenant table declares no index, so it can only be scanned`,
    );
  }
  for (const index of facts.indexes) {
    if (index.fields[0] !== TENANT_DISCRIMINATOR) {
      problems.push(
        `${facts.name}.${index.name}: index begins with "${index.fields[0] ?? "<none>"}" ` +
          `instead of "${TENANT_DISCRIMINATOR}"`,
      );
    }
  }

  return problems;
}

/**
 * Violations on a global table. A global table must *not* carry `orgId`: a table
 * with a tenant discriminator that nothing enforces is worse than either
 * alternative, because it reads as tenant-scoped.
 */
export function globalTableViolations(facts: TableFacts): readonly string[] {
  return facts.fieldNames.includes(TENANT_DISCRIMINATOR)
    ? [
        `${facts.name}: global table carries "${TENANT_DISCRIMINATOR}"; ` +
          "either scope it properly or remove it from GLOBAL_TABLES",
      ]
    : [];
}

/** Field paths whose names suggest credential material. */
export function forbiddenFieldPaths(facts: TableFacts): readonly string[] {
  const forbidden: string[] = [];

  for (const path of facts.fieldPaths) {
    const words = fieldWords(path);
    for (const word of words) {
      if ((FORBIDDEN_FIELD_WORDS as readonly string[]).includes(word)) {
        forbidden.push(`${facts.name}.${path} (word "${word}")`);
      }
    }
    for (let index = 0; index + 1 < words.length; index += 1) {
      const phrase = `${words[index]}${words[index + 1]}`;
      if ((FORBIDDEN_FIELD_PHRASES as readonly string[]).includes(phrase)) {
        forbidden.push(`${facts.name}.${path} (phrase "${phrase}")`);
      }
    }
  }

  return forbidden;
}

/**
 * Contracts that the schema does not honour: a missing table, a missing key
 * field, a missing index, an index whose fields are not exactly the key in
 * order, or a condition that disagrees with the declared optionality of the key.
 *
 * "Exactly, in order" rather than "starts with" because a prefix index makes the
 * uniqueness check a range read over an unbounded set of neighbours, and a
 * uniqueness check that reads more than one candidate is a race waiting for
 * traffic.
 *
 * The condition checks are the part that protects an optional key field. An
 * unconditional contract over an optional field is a trap: the mutation that
 * honours it literally treats two absent values as a collision and refuses a
 * legitimate write. A `whenPresent` contract over a required field is the
 * opposite mistake — a qualifier that can never bite, which teaches the reader to
 * ignore qualifiers.
 */
export function uniquenessContractViolations(
  allFacts: readonly TableFacts[],
): readonly string[] {
  const byName = new Map(allFacts.map((facts) => [facts.name, facts]));
  const problems: string[] = [];

  for (const contract of UNIQUENESS_CONTRACTS) {
    const keyLabel = `[${contract.key.join(", ")}]`;
    const indexName = uniquenessIndexName(contract.key);
    const facts = byName.get(contract.table);
    if (facts === undefined) {
      problems.push(
        `${contract.table}: table named by a uniqueness contract is absent`,
      );
      continue;
    }

    for (const field of contract.key) {
      if (!facts.fieldNames.includes(field)) {
        problems.push(`${contract.table}: key field "${field}" is absent`);
      }
    }

    const conditionalFields =
      contract.condition.kind === "whenPresent"
        ? contract.condition.fields
        : [];

    for (const field of conditionalFields) {
      if (!contract.key.includes(field)) {
        problems.push(
          `${contract.table}.${indexName}: contract ${keyLabel} is conditional on ` +
            `"${field}", which is not part of the key`,
        );
        continue;
      }
      if (!facts.optionalFieldNames.includes(field)) {
        problems.push(
          `${contract.table}.${indexName}: contract ${keyLabel} is marked "when present" ` +
            `for "${field}", but the schema declares it required, so the condition can never apply`,
        );
      }
    }

    for (const field of contract.key) {
      if (
        facts.optionalFieldNames.includes(field) &&
        !conditionalFields.includes(field)
      ) {
        problems.push(
          `${contract.table}.${indexName}: key field "${field}" is optional but the ` +
            `contract ${keyLabel} is unconditional; two absent values are not a collision, so ` +
            'declare it with whenPresent("' +
            field +
            '")',
        );
      }
    }

    const index = facts.indexes.find(
      (candidate) => candidate.name === indexName,
    );
    if (index === undefined) {
      problems.push(
        `${contract.table}: index "${indexName}" is absent, so the uniqueness ` +
          `check on ${keyLabel} would be unbounded`,
      );
      continue;
    }
    if (index.fields.join(",") !== contract.key.join(",")) {
      problems.push(
        `${contract.table}.${indexName}: indexes [${index.fields.join(", ")}] ` +
          `but the contract key is ${keyLabel}`,
      );
    }
  }

  return problems;
}

/**
 * Bounded-lookup contracts the schema does not honour.
 *
 * Some declared index must *begin* with the key — a prefix is correct here,
 * because the read is a range over many rows by design rather than a
 * single-candidate check, and a wider index that adds an ordering serves it just
 * as well. No index that begins with the key would turn a "show me this ticket's
 * grants" question into a scan of every grant in the table.
 */
export function lookupContractViolations(
  allFacts: readonly TableFacts[],
  contracts: readonly LookupContract[] = BOUNDED_LOOKUP_CONTRACTS,
): readonly string[] {
  const byName = new Map(allFacts.map((facts) => [facts.name, facts]));
  const problems: string[] = [];

  for (const contract of contracts) {
    const keyLabel = `[${contract.key.join(", ")}]`;
    const facts = byName.get(contract.table);
    if (facts === undefined) {
      problems.push(
        `${contract.table}: table named by a bounded-lookup contract is absent`,
      );
      continue;
    }

    for (const field of contract.key) {
      if (!facts.fieldNames.includes(field)) {
        problems.push(
          `${contract.table}: bounded-lookup key field "${field}" is absent`,
        );
      }
    }

    const key = contract.key.join(",");
    const indexed = facts.indexes.some(
      (candidate) =>
        candidate.fields.slice(0, contract.key.length).join(",") === key,
    );
    if (!indexed) {
      problems.push(
        `${contract.table}: no index begins with ${keyLabel}, so reading it ` +
          "would scan the table",
      );
    }
  }

  return problems;
}

/**
 * Keys declared both unique and many-per-key.
 *
 * Two lists that disagree are worse than either list alone: whichever one the
 * next mutation happens to read becomes the rule. Checked over both lists as
 * arguments so the contradiction can be demonstrated on synthetic data without
 * corrupting the real declarations.
 */
export function cardinalityContradictions(
  unique: readonly UniquenessContract[] = UNIQUENESS_CONTRACTS,
  lookups: readonly LookupContract[] = BOUNDED_LOOKUP_CONTRACTS,
): readonly string[] {
  const uniqueKeys = new Set(
    unique.map((contract) => `${contract.table}:${contract.key.join(",")}`),
  );
  return lookups
    .filter((contract) =>
      uniqueKeys.has(`${contract.table}:${contract.key.join(",")}`),
    )
    .map(
      (contract) =>
        `${contract.table}: [${contract.key.join(", ")}] is declared both unique and ` +
        'cardinality "many"; the two contracts contradict each other',
    );
}

/** Operational rows that copy attributes determined by another non-key field. */
export function thirdNormalFormViolations(
  allFacts: readonly TableFacts[],
  contracts: readonly ThirdNormalFormContract[] = THIRD_NORMAL_FORM_CONTRACTS,
): readonly string[] {
  const byName = new Map(allFacts.map((facts) => [facts.name, facts]));
  const problems: string[] = [];

  for (const contract of contracts) {
    const facts = byName.get(contract.table);
    if (facts === undefined) {
      problems.push(
        `${contract.table}: table named by a third-normal-form contract is absent`,
      );
      continue;
    }
    for (const determinant of contract.determinant) {
      if (!facts.fieldNames.includes(determinant)) {
        problems.push(
          `${contract.table}: third-normal-form determinant "${determinant}" is absent`,
        );
      }
    }
    for (const dependent of contract.dependentFields) {
      if (facts.fieldNames.includes(dependent)) {
        problems.push(
          `${contract.table}.${dependent}: copied attribute is transitively determined by ` +
            `[${contract.determinant.join(", ")}]; resolve it from the authoritative relation`,
        );
      }
    }
  }

  return problems;
}

/** Tables present in the schema that this policy does not classify. */
export function unclassifiedTables(
  allFacts: readonly TableFacts[],
): readonly string[] {
  return allFacts
    .filter((facts) => facts.classification === "unclassified")
    .map((facts) => facts.name);
}

/** Tables this policy expects that the schema does not define. */
export function missingTables(
  allFacts: readonly TableFacts[],
): readonly string[] {
  const present = new Set(allFacts.map((facts) => facts.name));
  return [...GLOBAL_TABLES, ...TENANT_TABLES].filter(
    (name) => !present.has(name),
  );
}

/**
 * Every violation the policy can see, in one list.
 *
 * The composed function exists so a caller cannot honour most of the checks and
 * believe the schema was vetted. Adding a check here makes it part of the
 * guard everywhere the guard runs; the individual functions stay exported so a
 * failure can be attributed to one rule rather than to "the schema".
 *
 * An empty list means the schema's *shape* is legal. It does not mean tenant
 * isolation holds at runtime: nothing here reads a document, and the tenant-bound
 * accessor (`G-102`) that would enforce isolation does not exist yet.
 */
export function schemaPolicyViolations(
  allFacts: readonly TableFacts[],
): readonly string[] {
  return [
    ...missingTables(allFacts).map(
      (name) =>
        `${name}: table expected by the policy is not defined in the schema`,
    ),
    ...unclassifiedTables(allFacts).map(
      (name) =>
        `${name}: table is neither in GLOBAL_TABLES nor TENANT_TABLES; classify it ` +
        "before it holds data",
    ),
    ...allFacts.flatMap((facts) => {
      switch (facts.classification) {
        case "tenant":
          return tenantTableViolations(facts);
        case "global":
          return globalTableViolations(facts);
        case "unclassified":
          return [];
      }
    }),
    ...allFacts.flatMap((facts) =>
      forbiddenFieldPaths(facts).map(
        (path) =>
          `${path}: field name suggests credential material (INV-0001-06)`,
      ),
    ),
    ...uniquenessContractViolations(allFacts),
    ...lookupContractViolations(allFacts),
    ...cardinalityContradictions(),
    ...thirdNormalFormViolations(allFacts),
  ];
}

/**
 * The exact set of string values a closed validator accepts.
 *
 * Throws when the validator is not a union of string literals, which is the
 * point: it turns "is this field closed?" into a question with an answer instead
 * of a reading exercise. A field that drifts to `v.string()` fails here rather
 * than quietly accepting a state no policy handles.
 */
export function closedValueSet(validator: GenericValidator): readonly string[] {
  if (validator.kind !== "union") {
    throw new Error(
      `Validator is "${validator.kind}", not a closed union of literals`,
    );
  }
  return validator.members.map((member) => {
    if (member.kind !== "literal" || typeof member.value !== "string") {
      throw new Error(`Union member is "${member.kind}", not a string literal`);
    }
    return member.value;
  });
}
