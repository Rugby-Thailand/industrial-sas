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
  "reportJobs",
  "customers",
  "customerOrders",
  "customerOrderLines",
  "designRequests",
  "masterCards",
  "masterCardRevisions",
  "masterCardFiles",
  "masterCardUploadGrants",
  "masterCardFileAccessGrants",
  "masterCardImportChunks",
  "factoryPackets",
  "factoryPacketFiles",
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
 * A key that must be unique, and the index that makes checking it bounded.
 *
 * Convex has no unique constraint, so uniqueness is always a code obligation.
 * The obligation is only affordable if the check is a single indexed lookup —
 * which is why the contract names both the key and the index, and why a test
 * asserts the index exists with exactly those fields in that order.
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
  readonly index: string;
  readonly condition: UniquenessCondition;
  readonly rationale: string;
};

export const UNIQUENESS_CONTRACTS: readonly UniquenessContract[] = [
  {
    table: "organizations",
    key: ["clerkOrganizationId"],
    index: "by_clerkOrganizationId",
    condition: ALWAYS,
    rationale:
      "One Clerk organization maps to at most one tenant, both directions (INV-0001-05).",
  },
  {
    table: "users",
    key: ["clerkUserId"],
    index: "by_clerkUserId",
    condition: ALWAYS,
    rationale:
      "Actor resolution from a verified Clerk token happens on every request (INV-0001-02).",
  },
  {
    table: "permissions",
    key: ["code"],
    index: "by_code",
    condition: ALWAYS,
    rationale:
      "Permission codes are the stable identifiers functions and audit rows cite (INV-0006-02).",
  },
  {
    table: "warehouses",
    key: ["orgId", "code"],
    index: "by_orgId_code",
    condition: ALWAYS,
    rationale:
      "Tenant-normalized human identifier, unique per organization (§5 Q4).",
  },
  {
    table: "memberships",
    key: ["orgId", "userId"],
    index: "by_orgId_userId",
    condition: ALWAYS,
    rationale:
      "One membership per user per organization; resolved before every operation (INV-0001-03).",
  },
  {
    table: "memberships",
    key: ["orgId", "clerkMembershipId"],
    index: "by_orgId_clerkMembershipId",
    condition: ALWAYS,
    rationale:
      "Idempotent application of Clerk membership webhooks (INV-0001-04).",
  },
  {
    table: "membershipRoles",
    key: ["orgId", "membershipId", "roleId"],
    index: "by_orgId_membershipId_roleId",
    condition: ALWAYS,
    rationale: "A role is held once per membership; the row is the grant.",
  },
  {
    table: "membershipWarehouses",
    key: ["orgId", "membershipId", "warehouseId"],
    index: "by_orgId_membershipId_warehouseId",
    condition: ALWAYS,
    rationale: "Warehouse scope is a set, not a multiset (G-007).",
  },
  {
    table: "roles",
    key: ["orgId", "key"],
    index: "by_orgId_key",
    condition: ALWAYS,
    rationale: "Seeded role keys must be idempotent to reseed (INV-0006-11).",
  },
  {
    table: "rolePermissions",
    key: ["orgId", "roleId", "permissionCode"],
    index: "by_orgId_roleId_permissionCode",
    condition: ALWAYS,
    rationale: "A permission is granted to a role once; composition is a set.",
  },
  {
    table: "entitlements",
    key: ["orgId", "key"],
    index: "by_orgId_key",
    condition: ALWAYS,
    rationale:
      "One entitlement row per key per tenant; absent means disabled (D-30).",
  },
  {
    table: "idempotencyRecords",
    key: ["orgId", "operation", "requestId"],
    index: "by_orgId_operation_requestId",
    condition: ALWAYS,
    rationale:
      "Replay detection on the hot path of every mutation; scoped per tenant (§5 Q30). " +
      "The key locates the record; `requestHash` decides retry versus reused ID (INV-0003-01).",
  },
  {
    table: "devices",
    key: ["orgId", "installationId"],
    index: "by_orgId_installationId",
    condition: whenPresent("installationId"),
    rationale:
      "A reported PWA installation correlates to at most one registered device. " +
      "`installationId` is optional, so devices that have reported none are not duplicates of each other.",
  },
  {
    table: "items",
    key: ["orgId", "sku"],
    index: "by_orgId_sku",
    condition: ALWAYS,
    rationale:
      "A tenant's SKU is its own identifier for an item; two rows would make a scan ambiguous (§5 Q4, ADR-0005 §6).",
  },
  {
    table: "locations",
    key: ["orgId", "warehouseId", "code"],
    index: "by_orgId_warehouseId_code",
    condition: ALWAYS,
    rationale:
      "A location code is unique within its warehouse, not across the tenant: two sites legitimately both have a DOCK-01 (INV-0005-01).",
  },
  {
    table: "lots",
    key: ["orgId", "itemId", "lotCode"],
    index: "by_orgId_itemId_lotCode",
    condition: ALWAYS,
    rationale:
      "Lot identity is item plus lot code (INV-0005-02); the index is also how a posting proves the lot belongs to the line's item.",
  },
  {
    table: "handlingUnits",
    key: ["orgId", "lpn"],
    index: "by_orgId_lpn",
    condition: ALWAYS,
    rationale:
      "An LPN is unique per organization and never reused (INV-0005-05); a rescanned old label must not resolve to new stock.",
  },
  {
    table: "owners",
    key: ["orgId", "code"],
    index: "by_orgId_code",
    condition: ALWAYS,
    rationale:
      "Owner code is the tenant's identifier for a consignment counterparty (D-11).",
  },
  {
    table: "reasonCodes",
    key: ["orgId", "code"],
    index: "by_orgId_code",
    condition: ALWAYS,
    rationale:
      "A reason code is cited by adjustments, scraps, and reversals; two rows under one code would make the audit evidence ambiguous (ADR-0003 §5).",
  },
  {
    table: "inventoryTransactions",
    key: ["orgId", "operation", "requestId"],
    index: "by_orgId_operation_requestId",
    condition: ALWAYS,
    rationale:
      "The idempotency namespace (INV-0003-01): a replay of one request must find exactly one transaction, and finding two would mean stock was already double-posted.",
  },
  {
    table: "inventoryTransactions",
    key: ["orgId", "reversalOfTransactionId"],
    index: "by_orgId_reversalOfTransactionId",
    condition: whenPresent("reversalOfTransactionId"),
    rationale:
      "A transaction is reversed at most once: two reversals would compensate it twice (INV-0003-08). " +
      "Conditional because only a REVERSAL carries the link, and every non-reversal leaving it absent is not a collision.",
  },
  {
    table: "inventoryLedgerLines",
    key: ["orgId", "transactionId", "lineIndex"],
    index: "by_orgId_transactionId_lineIndex",
    condition: ALWAYS,
    rationale:
      "Line positions within a transaction are its canonical order; a duplicate index would make a replay non-deterministic (INV-0003-02).",
  },
  {
    table: "inventoryBalances",
    key: ["orgId", "bucketKey"],
    index: "by_orgId_bucketKey",
    condition: ALWAYS,
    rationale:
      "One balance row per bucket. Two rows would make the projection ambiguous and reconciliation unable to say which is drifting (INV-0003-09).",
  },
  {
    table: "operationsRollups",
    key: ["orgId", "warehouseId", "metric", "subjectKey"],
    index: "by_orgId_warehouseId_metric_subjectKey",
    condition: ALWAYS,
    rationale:
      "One counter per (site, metric, subject). Two rows would make a dashboard tile the sum of an " +
      "arbitrary pair and make verification unable to say which is drifting (INV-0011-09).",
  },
  {
    table: "reportJobs",
    key: ["orgId", "requestId"],
    index: "by_orgId_requestId",
    condition: ALWAYS,
    rationale:
      "One job per request. A repeated export request replays the job it already created rather than " +
      "starting a second walk over the same data (INV-0011-02).",
  },
  {
    table: "suppliers",
    key: ["orgId", "code"],
    index: "by_orgId_code",
    condition: ALWAYS,
    rationale:
      "Tenant-normalized supplier identifier, unique per organization (§5 Q4).",
  },
  {
    table: "itemBarcodes",
    key: ["orgId", "barcode"],
    index: "by_orgId_barcode",
    condition: ALWAYS,
    rationale:
      "A scanned string must resolve to at most one item, or receiving has to ask an operator which " +
      "SKU they meant while they are holding the carton. Uniqueness is on the barcode alone, " +
      "deliberately not on (item, barcode).",
  },
  {
    table: "itemUoms",
    key: ["orgId", "itemId", "uom"],
    index: "by_orgId_itemId_uom",
    condition: ALWAYS,
    rationale:
      "One factor per alternate unit per item. A second row would give the same UOM two conversion " +
      "factors, and the kernel's DUPLICATE_UOM exists because a profile with both is not a profile.",
  },
  {
    table: "storageClasses",
    key: ["orgId", "code"],
    index: "by_orgId_code",
    condition: ALWAYS,
    rationale:
      "A storage class means the same thing at every site, so its code is unique per organization " +
      "rather than per warehouse (D-13).",
  },
  {
    table: "labelTemplates",
    key: ["orgId", "code", "version"],
    index: "by_orgId_code_version",
    condition: ALWAYS,
    rationale:
      "A printed label cites a template code and version as audit evidence (RG-004). Two rows under " +
      "one version would make that citation ambiguous.",
  },
  {
    table: "purchaseOrders",
    key: ["orgId", "poNumber"],
    index: "by_orgId_poNumber",
    condition: ALWAYS,
    rationale:
      "The order number is what a buyer, a supplier, and a receiving operator all quote. Two orders " +
      "under one number make every one of those conversations ambiguous (ADR-0007 §1).",
  },
  {
    table: "purchaseOrderLines",
    key: ["orgId", "purchaseOrderId", "lineNumber"],
    index: "by_orgId_purchaseOrderId_lineNumber",
    condition: ALWAYS,
    rationale:
      "A receipt is posted against a line by its position on the order. Two lines at one position would " +
      "make the posting target ambiguous and the running received total meaningless.",
  },
  {
    table: "purchaseOrderLines",
    key: ["orgId", "sourceRowRef"],
    index: "by_orgId_sourceRowRef",
    condition: whenPresent("sourceRowRef"),
    rationale:
      "One imported spreadsheet row creates at most one line, however many times a chunk is replayed " +
      "after a crash (INV-0007-12).",
  },
  {
    table: "poImportBatches",
    key: ["orgId", "batchRef"],
    index: "by_orgId_batchRef",
    condition: ALWAYS,
    rationale:
      "The batch reference is half of every imported row's sourceRowRef, which is the row's idempotency " +
      "key. Two batches under one reference would make a re-run write duplicates (INV-0007-12).",
  },
  {
    table: "receipts",
    key: ["orgId", "receiptNumber"],
    index: "by_orgId_receiptNumber",
    condition: ALWAYS,
    rationale:
      "The receipt number is the tenant-visible reference on a goods-received note; duplicates make " +
      "reconciliation against a supplier's delivery paperwork impossible.",
  },
  {
    table: "qcInspections",
    key: ["orgId", "receiptLineId"],
    index: "by_orgId_receiptLineId",
    condition: ALWAYS,
    rationale:
      "One received line is inspected once. A second inspection row would let two dispositions move the " +
      "same held quantity, and the ledger would refuse the second with a message about balances rather " +
      "than about quality (INV-0007-05).",
  },
  {
    table: "putawayTasks",
    key: ["orgId", "receiptLineId"],
    index: "by_orgId_receiptLineId",
    condition: ALWAYS,
    rationale:
      "One received line becomes one putaway task. Two tasks for one line would let two operators each " +
      "move the whole quantity, and the second move would post from a bucket already emptied.",
  },
  {
    table: "customers",
    key: ["orgId", "code"],
    index: "by_orgId_code",
    condition: ALWAYS,
    rationale:
      "The customer code is what a salesperson quotes on the phone and what every order is filed under. " +
      "Two customers under one code would let an order be raised against the wrong company.",
  },
  {
    table: "customerOrders",
    key: ["orgId", "orderNumber"],
    index: "by_orgId_orderNumber",
    condition: ALWAYS,
    rationale:
      "The order number is the tenant's own reference for a commitment to a customer. Duplicates make " +
      "every 'where is my order' conversation ambiguous (ADR-0013 §2).",
  },
  {
    table: "customerOrders",
    key: ["orgId", "customerId", "customerReference"],
    index: "by_orgId_customerId_customerReference",
    condition: whenPresent("customerReference"),
    rationale:
      "One customer PO becomes one order, so a re-keyed or re-imported PO cannot commit the factory twice. " +
      "Scoped to the customer, not the organization, because two customers may both number their orders " +
      "PO-001 and refusing the second would be this system telling a customer their numbering is wrong.",
  },
  {
    table: "customerOrderLines",
    key: ["orgId", "customerOrderId", "lineNumber"],
    index: "by_orgId_customerOrderId_lineNumber",
    condition: ALWAYS,
    rationale:
      "A factory packet is issued against a line by its position on the order. Two lines at one position " +
      "would make the hand-off target ambiguous.",
  },
  {
    table: "designRequests",
    key: ["orgId", "requestNumber"],
    index: "by_orgId_requestNumber",
    condition: ALWAYS,
    rationale:
      "The request number is what sales quotes when chasing engineering for a date. Duplicates make the " +
      "chase land on the wrong drawing.",
  },
  {
    table: "designRequests",
    key: ["orgId", "customerOrderLineId"],
    index: "by_orgId_customerOrderLineId",
    condition: ALWAYS,
    rationale:
      "One line raises one design request. Two requests for one line would leave two people waiting on one " +
      "drawing with no way to tell which request the eventual revision answered (INV-0013-05).",
  },
  {
    table: "masterCards",
    key: ["orgId", "cardNumber"],
    index: "by_orgId_cardNumber",
    condition: ALWAYS,
    rationale:
      "The card number is written on paper on a factory floor. Two cards under one number would make every " +
      "reference to it ambiguous at the machine.",
  },
  {
    table: "masterCards",
    key: ["orgId", "customerId", "customerProductCode"],
    index: "by_orgId_customerId_customerProductCode",
    condition: ALWAYS,
    rationale:
      "The customer's own product code is the approved exact-match identity. Two cards claiming the same " +
      "product code for one customer would make automatic reuse ambiguous, while a geometry fingerprint " +
      "is deliberately advisory only " +
      "(INV-0013-01).",
  },
  {
    table: "masterCardRevisions",
    key: ["orgId", "masterCardId", "revisionNumber"],
    index: "by_orgId_masterCardId_revisionNumber",
    condition: ALWAYS,
    rationale:
      "'Rev 3' has to name one document forever, including after a rejection and including on paper. Two " +
      "revisions at one number would make a pinned packet ambiguous about what it was cut from " +
      "(INV-0013-02).",
  },
  {
    table: "masterCardFiles",
    key: ["orgId", "masterCardRevisionId", "fileKey"],
    index: "by_orgId_masterCardRevisionId_fileKey",
    condition: ALWAYS,
    rationale:
      "The file key is the attachment's identity within its revision, so a retried attach replaces nothing " +
      "and duplicates nothing. Two rows under one key would make 'which dieline' unanswerable.",
  },
  {
    table: "masterCardImportChunks",
    key: ["orgId", "batchRef", "startSourceRow"],
    index: "by_orgId_batchRef_startSourceRow",
    condition: ALWAYS,
    rationale:
      "One durable result per batch cursor makes migration retries replay the same committed chunk instead of importing the same legacy cards twice.",
  },
  {
    table: "factoryPackets",
    key: ["orgId", "packetNumber"],
    index: "by_orgId_packetNumber",
    condition: ALWAYS,
    rationale:
      "The packet number is the reference a floor supervisor reads off the paper in their hand. Duplicates " +
      "would let two different jobs answer to one number.",
  },
  {
    table: "factoryPackets",
    key: ["orgId", "customerOrderLineId"],
    index: "by_orgId_customerOrderLineId",
    condition: ALWAYS,
    rationale:
      "One order line is handed to the factory once. Two packets for one line would let it be built twice, " +
      "with nothing in this phase to reconcile the runs against — splitting a line across production runs " +
      "is a factory-order concern (WF-02, Phase 5B).",
  },
  {
    table: "factoryPacketFiles",
    key: ["orgId", "factoryPacketId", "masterCardFileId"],
    index: "by_orgId_factoryPacketId_masterCardFileId",
    condition: ALWAYS,
    rationale:
      "A file is approved for a packet once. A duplicate relationship would add no fact and would make " +
      "file access and packet rendering depend on deduplication order.",
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Bounded lookup contracts (indexed, deliberately not unique)                 */
/* -------------------------------------------------------------------------- */

/**
 * A key that must be indexed so its reads are bounded, and whose cardinality is
 * explicitly many.
 *
 * An index alone says nothing about cardinality, and the absence of a uniqueness
 * contract is indistinguishable from an oversight. Stating "many, on purpose"
 * here is what stops a later mutation from inventing a one-per-key rule the
 * domain never asked for.
 */
export type LookupContract = {
  readonly table: string;
  readonly key: readonly string[];
  readonly index: string;
  readonly cardinality: "many";
  readonly rationale: string;
};

export const BOUNDED_LOOKUP_CONTRACTS: readonly LookupContract[] = [
  {
    table: "masterCardUploadGrants",
    key: ["orgId", "expiresAt"],
    index: "by_orgId_expiresAt",
    cardinality: "many",
    rationale:
      "Upload capabilities expire independently. The tenant-wide expiry prefix lets each authorization " +
      "remove a bounded batch of stale grants and unattached storage without scanning revisions or import batches.",
  },
  {
    table: "supportGrants",
    key: ["orgId", "ticketRef"],
    index: "by_orgId_ticketRef",
    cardinality: "many",
    rationale:
      "Every grant is bound to a support ticket, but a ticket may earn several grants over its life " +
      "(reopened, re-requested after expiry, a second engineer). The index bounds ticket history and " +
      "tenant reconciliation (INV-0006-09); it does not cap the count.",
  },
  {
    table: "inventoryLedgerLines",
    key: ["orgId", "bucketKey"],
    index: "by_orgId_bucketKey_occurredAt",
    cardinality: "many",
    rationale:
      "A bucket accumulates a line per movement forever — roughly 1M lines per tenant per year at the B-11 " +
      "envelope. The index is what makes replaying one bucket a bounded, resumable page rather than a scan " +
      "(INV-0003-10); it does not cap the count.",
  },
  {
    table: "inventoryTransactions",
    key: ["orgId", "warehouseId"],
    index: "by_orgId_warehouseId_occurredAt",
    cardinality: "many",
    rationale:
      "One site posts many transactions. The index bounds the history screen and the reconciliation walk " +
      "(inventory.history.read); it does not cap the count.",
  },
  {
    table: "inventoryBalances",
    key: ["orgId", "warehouseId", "itemId", "stockStatus"],
    index: "by_orgId_warehouseId_itemId_stockStatus",
    cardinality: "many",
    rationale:
      "One item in one status is spread across many locations, lots, handling units, and owners — that " +
      "spread is the point of a narrow bucket. The index bounds 'what is on hand' (inventory.balance.read); " +
      "it does not cap the count.",
  },
  {
    table: "operationsRollups",
    key: ["orgId", "warehouseId", "metric"],
    index: "by_orgId_warehouseId_metric_subjectKey",
    cardinality: "many",
    rationale:
      "A per-subject metric — occupancy — has one row per location, so the metric prefix reads a bounded " +
      "page rather than a single document. A site total has exactly one row under the `-` sentinel.",
  },
  {
    table: "reportJobs",
    key: ["orgId", "warehouseId", "status"],
    index: "by_orgId_warehouseId_status",
    cardinality: "many",
    rationale:
      "A site accumulates exports. The index bounds the register screen and the queue the runner drains; " +
      "it does not cap the count.",
  },
  {
    table: "itemBarcodes",
    key: ["orgId", "itemId"],
    index: "by_orgId_itemId_barcode",
    cardinality: "many",
    rationale:
      "One item legitimately carries several aliases — a GTIN, a supplier's own code, an internal " +
      "label. The index bounds 'show me this item's barcodes'; it does not cap the count.",
  },
  {
    table: "itemUoms",
    key: ["orgId", "itemId"],
    index: "by_orgId_itemId_uom",
    cardinality: "many",
    rationale:
      "An item may declare each, case, and pallet. The index bounds rebuilding one item's conversion " +
      "profile (ADR-0004); it does not cap the count.",
  },
  {
    table: "labelTemplates",
    key: ["orgId", "code"],
    index: "by_orgId_code_version",
    cardinality: "many",
    rationale:
      "A template accumulates a version per published change, forever, because a printed label cites " +
      "the version it was produced from. The index bounds one template's history; it does not cap it.",
  },
  {
    table: "receiptLines",
    key: ["orgId", "receiptId"],
    index: "by_orgId_receiptId",
    cardinality: "many",
    rationale:
      "A receipt holds one line per item-and-lot that arrived on it — dozens for a mixed pallet, not " +
      "thousands. The index is what makes reading one receipt a bounded read rather than a scan.",
  },
  {
    table: "labelPrintJobs",
    key: ["orgId", "targetKind", "targetId"],
    index: "by_orgId_targetKind_targetId",
    cardinality: "many",
    rationale:
      "One pallet accumulates a print job per label generated over its life, including every reprint. " +
      "Reprints are audited as reprints (ADR-0007 §10), so the count grows and is deliberately uncapped.",
  },
  {
    table: "customerOrderLines",
    key: ["orgId", "customerOrderId"],
    index: "by_orgId_customerOrderId_lineNumber",
    cardinality: "many",
    rationale:
      "An order holds one line per box ordered — a handful for a phone order, a page for a scheduled " +
      "call-off. The index is what makes reading one order's lines a bounded page rather than a scan; " +
      "the position within the order is separately unique.",
  },
  {
    table: "customerOrderLines",
    key: ["orgId", "status", "designKey"],
    index: "by_orgId_status_designKey",
    cardinality: "many",
    rationale:
      "Many lines wait on the same new design — the same box ordered by the same customer twice in a " +
      "week. This index is how the engineering queue is read without scanning every order in the tenant.",
  },
  {
    table: "masterCards",
    key: ["orgId", "customerId", "designKey"],
    index: "by_orgId_customerId_designKey",
    cardinality: "many",
    rationale:
      "Several customer product codes may deliberately share one released structural design. The index " +
      "bounds operator-triggered reuse suggestions without making geometry an automatic identity.",
  },
  {
    table: "masterCardRevisions",
    key: ["orgId", "masterCardId"],
    index: "by_orgId_masterCardId_revisionNumber",
    cardinality: "many",
    rationale:
      "A card accumulates a revision per change, forever, because a packet cites the revision it was cut " +
      "from and superseded revisions stay readable (INV-0013-02). The index bounds one card's history; " +
      "it does not cap it.",
  },
  {
    table: "masterCardFiles",
    key: ["orgId", "masterCardRevisionId"],
    index: "by_orgId_masterCardRevisionId_fileKey",
    cardinality: "many",
    rationale:
      "One revision carries a dieline, artwork, and often a photo of the approved sample. The index makes " +
      "'show me this revision's files' bounded; the key within the revision is separately unique.",
  },
  {
    table: "masterCardUploadGrants",
    key: ["orgId", "masterCardRevisionId", "expiresAt"],
    index: "by_orgId_masterCardRevisionId_expiresAt",
    cardinality: "many",
    rationale:
      "A revision may receive several short-lived one-use upload authorizations. The tenant-first index bounds grant review and cleanup without a tenant scan.",
  },
  {
    table: "masterCardUploadGrants",
    key: ["orgId", "batchRef", "sourceRow", "expiresAt"],
    index: "by_orgId_batchRef_sourceRow_expiresAt",
    cardinality: "many",
    rationale:
      "Legacy migration files use the same one-use upload gateway, bound to one batch row before an import may adopt the resulting storage object.",
  },
  {
    table: "masterCardFileAccessGrants",
    key: ["orgId", "masterCardFileId", "expiresAt"],
    index: "by_orgId_masterCardFileId_expiresAt",
    cardinality: "many",
    rationale:
      "Each audited file permission check mints one short-lived one-use download capability. The tenant-first index bounds grant cleanup and review.",
  },
  {
    table: "masterCardImportChunks",
    key: ["orgId", "batchRef"],
    index: "by_orgId_batchRef_startSourceRow",
    cardinality: "many",
    rationale:
      "A large legacy register is applied as bounded chunks. The batch-first index lists its completed cursors without scanning other imports.",
  },
  {
    table: "masterCardImportChunks",
    key: ["orgId", "batchRef", "nextSourceRow"],
    index: "by_orgId_batchRef_nextSourceRow",
    cardinality: "many",
    rationale:
      "A resumable import finds its exact predecessor by the next row it expects, so progress remains bounded and deterministic after any number of chunks.",
  },
  {
    table: "factoryPackets",
    key: ["orgId", "warehouseId", "status"],
    index: "by_orgId_warehouseId_status_packetNumber",
    cardinality: "many",
    rationale:
      "A production site holds many issued packets at once — that queue is the screen the floor works " +
      "from. The index bounds it per site and status; the packet per line is separately unique.",
  },
  {
    table: "factoryPacketFiles",
    key: ["orgId", "factoryPacketId"],
    index: "by_orgId_factoryPacketId_masterCardFileId",
    cardinality: "many",
    rationale:
      "A packet may approve several files. The junction table keeps that repeating group out of the " +
      "packet row while the packet-first index returns the frozen file set without a scan.",
  },
  {
    table: "factoryPacketFiles",
    key: ["orgId", "masterCardFileId"],
    index: "by_orgId_masterCardFileId_factoryPacketId",
    cardinality: "many",
    rationale:
      "One immutable revision file may be approved for several packets; the reverse index keeps impact " +
      "analysis and retention checks tenant-bounded.",
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
  readonly rationale: string;
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
    rationale:
      "The order line determines the requested customer, product, fingerprint, and specification.",
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
    rationale:
      "The packet's order line determines its customer, order identity, reference, and quantity.",
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
    rationale:
      "The pinned immutable revision determines revision metadata; approved files belong in junction rows.",
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
          `${contract.table}.${contract.index}: contract ${keyLabel} is conditional on ` +
            `"${field}", which is not part of the key`,
        );
        continue;
      }
      if (!facts.optionalFieldNames.includes(field)) {
        problems.push(
          `${contract.table}.${contract.index}: contract ${keyLabel} is marked "when present" ` +
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
          `${contract.table}.${contract.index}: key field "${field}" is optional but the ` +
            `contract ${keyLabel} is unconditional; two absent values are not a collision, so ` +
            'declare it with whenPresent("' +
            field +
            '")',
        );
      }
    }

    const index = facts.indexes.find(
      (candidate) => candidate.name === contract.index,
    );
    if (index === undefined) {
      problems.push(
        `${contract.table}: index "${contract.index}" is absent, so the uniqueness ` +
          `check on ${keyLabel} would be unbounded`,
      );
      continue;
    }
    if (index.fields.join(",") !== contract.key.join(",")) {
      problems.push(
        `${contract.table}.${contract.index}: indexes [${index.fields.join(", ")}] ` +
          `but the contract key is ${keyLabel}`,
      );
    }
  }

  return problems;
}

/**
 * Bounded-lookup contracts the schema does not honour.
 *
 * The index must exist and must *begin* with the key — a prefix is correct here,
 * because the read is a range over many rows by design rather than a
 * single-candidate check. A missing index would turn a "show me this ticket's
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

    const index = facts.indexes.find(
      (candidate) => candidate.name === contract.index,
    );
    if (index === undefined) {
      problems.push(
        `${contract.table}: index "${contract.index}" is absent, so reading ${keyLabel} ` +
          "would scan the table",
      );
      continue;
    }
    const prefix = index.fields.slice(0, contract.key.length).join(",");
    if (prefix !== contract.key.join(",")) {
      problems.push(
        `${contract.table}.${contract.index}: indexes [${index.fields.join(", ")}] ` +
          `but the bounded-lookup key is ${keyLabel}`,
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
        `cardinality "${contract.cardinality}"; the two contracts contradict each other`,
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
