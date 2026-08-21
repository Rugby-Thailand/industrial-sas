/**
 * Typed references to the order-to-ship functions, and their wire types.
 *
 * The same reasoning as `inboundApi.ts` and `masterDataApi.ts`:
 * `convex/_generated/` is a git-ignored artifact of `convex dev`, absent in CI
 * and on any machine that has not provisioned a deployment, so the browser names
 * server functions through `makeFunctionReference` and
 * `tests/integration/order-to-ship-client-contract.integration.test.ts` re-reads
 * the server modules to prove the names still resolve.
 *
 * Two shapes here are worth reading closely, because they are the slice's whole
 * point (`ADR-0013`):
 *
 * - **A line carries a customer product code, advisory structural `designKey`,
 *   and `designSource`.** The browser never derives either decision. `EXISTING`
 *   means customer + normalized product code resolved to a released revision;
 *   geometry can only support a human similarity suggestion.
 * - **A packet carries a `masterCardRevisionId`, a `revisionNumber`, *and* a
 *   `specification` snapshot.** The pin and the copy are both on the row on
 *   purpose: the pin is what the packet is, and the snapshot is what the factory
 *   reads on paper, so a screen never has to reach into engineering to render a
 *   packet (`INV-0013-04`).
 *
 * Every write reference carries a `requestId`. The key is what makes a retry a
 * replay instead of a second customer order, so a caller that could forget it
 * would be a caller that could order the same boxes twice.
 *
 * One function does not answer the shared write envelope:
 * `requestMasterCardFileAccess` answers `granted` plus either a URL or a refusal
 * code, because a file link is not a row that was written. It is a mutation
 * rather than a query so that the request is audited (`RG-071`: queries are not).
 */
import { makeFunctionReference } from "convex/server";

import type { TenantOutcome } from "./ledgerApi";
import type {
  MasterDataPage,
  MasterDataStatus,
  MasterDataWriteOutcome,
} from "./masterDataApi";

/* -------------------------------------------------------------------------- */
/* Closed sets                                                                 */
/* -------------------------------------------------------------------------- */

export type CustomerOrderStatus = "DRAFT" | "RELEASED" | "CANCELLED";

export type CustomerOrderLineStatus =
  "AWAITING_DESIGN" | "DESIGN_READY" | "HANDED_OFF" | "CANCELLED";

export type DesignSource = "EXISTING" | "NEW";

export type DesignRequestStatus =
  "OPEN" | "ASSIGNED" | "IN_PROGRESS" | "IN_REVIEW" | "FULFILLED" | "CANCELLED";

export type MasterCardRevisionStatus =
  "DRAFT" | "IN_REVIEW" | "RELEASED" | "REJECTED" | "SUPERSEDED";

export type MasterCardFileKind = "DIELINE" | "ARTWORK" | "PHOTO" | "OTHER";

export type MasterCardFileStorageState = "REGISTERED" | "AVAILABLE" | "FAILED";

export type FactoryPacketStatus = "ISSUED" | "ACKNOWLEDGED" | "CANCELLED";

export type RevisionDecision = "APPROVE" | "REJECT";

export type DesignRequirementKey =
  | "CUSTOMER_PRODUCT_IDENTITY"
  | "DIMENSIONS"
  | "CONSTRUCTION"
  | "PRINT"
  | "PACKING"
  | "ROUTE"
  | "MATERIALS"
  | "QUALITY";

export type DesignReadinessStatus = "INCOMPLETE" | "READY";

export type DesignRequirementConfirmations = Readonly<
  Record<DesignRequirementKey, boolean>
>;

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One packaging specification, exactly as ordered.
 *
 * Whole millimetres, because that is the unit a converting machine is set to.
 * Nothing derived appears here — blank size and board consumption need formulas
 * `WF-11` says must be confirmed with Engineering before they are coded, and a
 * screen that computed one would be publishing an unreviewed formula.
 */
export interface BoxSpecification {
  readonly styleCode: string;
  readonly internalLengthMm: number;
  readonly internalWidthMm: number;
  readonly internalHeightMm: number;
  readonly boardGrade: string;
  readonly printColourCount: number;
  readonly productNameEn?: string;
  readonly productNameTh?: string;
  readonly sheetLengthMm?: number;
  readonly sheetWidthMm?: number;
  readonly lengthToleranceMm?: number;
  readonly widthToleranceMm?: number;
  readonly heightToleranceMm?: number;
  readonly fluteCode?: string;
  readonly layers?: readonly {
    readonly position: number;
    readonly paperCode: string;
    readonly grammageGsm: number;
  }[];
  readonly printMethod?: string;
  readonly printColours?: readonly string[];
  readonly finishing?: readonly string[];
  readonly bundleQuantity?: number;
  readonly palletQuantity?: number;
  readonly packingInstructions?: string;
  readonly route?: readonly {
    readonly sequence: number;
    readonly workCenterCode: string;
    readonly operationCode: string;
    readonly instruction?: string;
  }[];
  readonly materials?: readonly {
    readonly itemCode: string;
    readonly description: string;
    readonly quantityPerUnit: number;
    readonly uom: string;
    readonly wastePercent?: number;
  }[];
  readonly qualityRequirements?: readonly {
    readonly code: string;
    readonly description: string;
    readonly target: string;
    readonly tolerance?: string;
  }[];
  readonly calculations?: readonly {
    readonly name: string;
    readonly formulaVersion: string;
    readonly inputs: readonly {
      readonly name: string;
      readonly value: number;
      readonly unit: string;
    }[];
    readonly result: number;
    readonly unit: string;
    readonly passed: boolean;
    readonly verifiedByUserId: string;
    readonly verifiedAt: number;
  }[];
  readonly notes?: string;
}

export interface CustomerRow {
  readonly customerId: string;
  readonly code: string;
  readonly name: string;
  readonly status: MasterDataStatus;
}

export interface CustomerOrderRow {
  readonly customerOrderId: string;
  readonly orderNumber: string;
  readonly customerId: string;
  /** The customer's own PO number, stored exactly as they wrote it. */
  readonly customerReference?: string;
  readonly status: CustomerOrderStatus;
  readonly orderedAt: number;
}

export interface CustomerOrderLineRow {
  readonly customerOrderLineId: string;
  readonly customerOrderId: string;
  readonly lineNumber: number;
  readonly customerProductCode: string;
  readonly specification: BoxSpecification;
  /** Derived on the server from the specification. Never composed here. */
  readonly designKey: string;
  readonly designSource: DesignSource;
  readonly status: CustomerOrderLineStatus;
  readonly orderedQuantity: number;
  /** Present once a released revision is pinned to the line. */
  readonly masterCardRevisionId?: string;
  readonly similarityConfirmation?: {
    readonly score: number;
    readonly reason: string;
    readonly confirmedByUserId: string;
    readonly confirmedAt: number;
  };
}

export interface DesignRequestRow {
  readonly designRequestId: string;
  readonly requestNumber: string;
  readonly customerOrderLineId: string;
  readonly customerId: string;
  readonly customerProductCode: string;
  readonly designKey: string;
  readonly specification: BoxSpecification;
  readonly status: DesignRequestStatus;
  readonly priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  readonly dueAt?: number;
  readonly overdue: boolean;
  readonly assignedToUserId?: string;
  readonly masterCardRevisionId?: string;
  readonly latestRequirementVersion?: number;
  readonly requirementReadiness?: DesignReadinessStatus;
  readonly missingRequirements?: readonly DesignRequirementKey[];
  readonly requirementsRecordedByUserId?: string;
  readonly requirementsRecordedAt?: number;
}

export interface DesignRequirementVersionRow {
  readonly designRequirementVersionId: string;
  readonly version: number;
  readonly confirmations: DesignRequirementConfirmations;
  readonly status: DesignReadinessStatus;
  readonly missing: readonly DesignRequirementKey[];
  readonly note?: string;
  readonly recordedByUserId: string;
  readonly recordedAt: number;
}

export interface DesignChangeImpactRow {
  readonly designChangeImpactId: string;
  readonly warehouseId: string;
  readonly masterCardId: string;
  readonly fromRevisionId: string;
  readonly toRevisionId: string;
  readonly productionOrderId: string;
  readonly productionOrderNumber: string;
  readonly productionOrderStatus: string;
  readonly severity: "NO_IMPACT" | "REVIEW_REQUIRED" | "BLOCKING";
  readonly changedFields: readonly string[];
  readonly categories: readonly string[];
  readonly status: "OPEN" | "ACKNOWLEDGED";
  readonly createdByUserId: string;
  readonly createdAt: number;
  readonly acknowledgedByUserId?: string;
  readonly acknowledgedAt?: number;
  readonly acknowledgementNote?: string;
}

export interface MasterCardRow {
  readonly masterCardId: string;
  readonly cardNumber: string;
  readonly customerId: string;
  readonly customerProductCode: string;
  readonly designKey: string;
  readonly name: string;
  readonly status: MasterDataStatus;
  readonly releasedRevisionId?: string;
}

export interface MasterCardRevisionRow {
  readonly masterCardRevisionId: string;
  readonly masterCardId: string;
  readonly revisionNumber: number;
  readonly status: MasterCardRevisionStatus;
  readonly specification: BoxSpecification;
  readonly designKey: string;
  readonly authoredByUserId: string;
  readonly submittedByUserId?: string;
  readonly decidedByUserId?: string;
  readonly decidedAt?: number;
  readonly decisionNote?: string;
  readonly supersededByRevisionId?: string;
}

/** What a design request may be fulfilled with: a released revision, only. */
export interface ReleasedRevisionRow {
  readonly masterCardRevisionId: string;
  readonly revisionNumber: number;
  readonly designKey: string;
  readonly specification: BoxSpecification;
  readonly status: MasterCardRevisionStatus;
}

export interface MasterCardFileRow {
  readonly masterCardFileId: string;
  readonly masterCardRevisionId: string;
  readonly fileKey: string;
  readonly fileName: string;
  readonly kind: MasterCardFileKind;
  readonly contentType: string;
  readonly byteSize: number;
  readonly contentDigest: string;
  readonly storageState: MasterCardFileStorageState;
  readonly storageId?: string;
  readonly verifiedAt?: number;
  readonly attachedByUserId: string;
}

export interface FactoryPacketRow {
  readonly factoryPacketId: string;
  readonly warehouseId: string;
  readonly packetNumber: string;
  readonly customerOrderLineId: string;
  readonly customerId: string;
  readonly customerOrderNumber: string;
  readonly customerReference?: string;
  readonly masterCardRevisionId: string;
  readonly revisionNumber: number;
  readonly specification: BoxSpecification;
  readonly approvedFileIds: readonly string[];
  readonly releaseEvidence: {
    readonly releasedByUserId: string;
    readonly releasedAt: number;
    readonly decisionNote?: string;
  };
  readonly quantity: number;
  readonly status: FactoryPacketStatus;
  readonly issuedByUserId: string;
  readonly acknowledgedByUserId?: string;
  readonly acknowledgedAt?: number;
}

export interface LegacyMasterCardImportRow {
  readonly sourceRow: number;
  readonly sourceReference: string;
  readonly cardNumber: string;
  readonly customerId: string;
  readonly customerProductCode: string;
  readonly name: string;
  readonly verified: boolean;
  readonly legacyApproval?: {
    readonly authoredByUserId: string;
    readonly submittedByUserId?: string;
    readonly decidedByUserId: string;
    readonly decidedAt: number;
    readonly decisionNote: string;
  };
  readonly specification: BoxSpecification;
  readonly files: readonly {
    readonly fileKey: string;
    readonly fileName: string;
    readonly kind: MasterCardFileKind;
    readonly contentType: string;
    readonly byteSize: number;
    readonly contentDigest: string;
    readonly storageId: string;
    readonly uploadGrantId: string;
  }[];
}

/**
 * The answer to "may I read this file's bytes".
 *
 * A URL is returned only after a fresh permission check and only while the
 * private storage object remains retrievable. Unavailable rows fail closed.
 */
export type FileAccessOutcome =
  | { readonly granted: true; readonly url: string; readonly expiresAt: number }
  | {
      readonly granted: false;
      readonly error: {
        readonly code: string;
        readonly field?: string;
        readonly reason?: string;
      };
    };

/* -------------------------------------------------------------------------- */
/* Function paths                                                              */
/* -------------------------------------------------------------------------- */

export const ORDER_TO_SHIP_QUERY_PATHS = Object.freeze({
  listCustomers: "sales/customers:listCustomers",
  listCustomerOrders: "sales/orders:listCustomerOrders",
  listCustomerOrderLines: "sales/orders:listCustomerOrderLines",
  listRoutableCustomerOrderLines: "sales/orders:listRoutableCustomerOrderLines",
  listDesignRequests: "engineering/designRequests:listDesignRequests",
  listDesignRequirementVersions:
    "engineering/requirements:listDesignRequirementVersions",
  listDesignChangeImpacts: "engineering/changeImpacts:listDesignChangeImpacts",
  listSimilarReleasedDesigns:
    "engineering/designRequests:listSimilarReleasedDesigns",
  listReleasedRevisions: "engineering/designRequests:listReleasedRevisions",
  listMasterCards: "engineering/masterCards:listMasterCards",
  listMasterCardRevisions: "engineering/masterCards:listMasterCardRevisions",
  listMasterCardFiles: "engineering/files:listMasterCardFiles",
  listFactoryPackets: "production/packets:listFactoryPackets",
  previewLegacyMasterCardImport:
    "engineering/masterCardImports:previewLegacyMasterCardImport",
});

export const ORDER_TO_SHIP_MUTATION_PATHS = Object.freeze({
  createCustomer: "sales/customers:createCustomer",
  updateCustomer: "sales/customers:updateCustomer",
  createCustomerOrder: "sales/orders:createCustomerOrder",
  addCustomerOrderLine: "sales/orders:addCustomerOrderLine",
  releaseCustomerOrder: "sales/orders:releaseCustomerOrder",
  cancelCustomerOrder: "sales/orders:cancelCustomerOrder",
  cancelCustomerOrderLine: "sales/orders:cancelCustomerOrderLine",
  assignDesignRequest: "engineering/designRequests:assignDesignRequest",
  progressDesignRequest: "engineering/designRequests:progressDesignRequest",
  recordDesignRequirements: "engineering/requirements:recordDesignRequirements",
  fulfilDesignRequest: "engineering/designRequests:fulfilDesignRequest",
  confirmSimilarDesign: "engineering/designRequests:confirmSimilarDesign",
  createMasterCard: "engineering/masterCards:createMasterCard",
  draftMasterCardRevision: "engineering/masterCards:draftMasterCardRevision",
  submitMasterCardRevision: "engineering/masterCards:submitMasterCardRevision",
  decideMasterCardRevision: "engineering/masterCards:decideMasterCardRevision",
  acknowledgeDesignChangeImpact:
    "engineering/changeImpacts:acknowledgeDesignChangeImpact",
  attachMasterCardFile: "engineering/files:attachMasterCardFile",
  authorizeMasterCardFileUpload:
    "engineering/files:authorizeMasterCardFileUpload",
  authorizeLegacyMasterCardFileUpload:
    "engineering/masterCardImports:authorizeLegacyMasterCardFileUpload",
  requestMasterCardFileAccess: "engineering/files:requestMasterCardFileAccess",
  requestFactoryPacketFileAccess:
    "production/packets:requestFactoryPacketFileAccess",
  issueFactoryPacket: "production/packets:issueFactoryPacket",
  acknowledgeFactoryPacket: "production/packets:acknowledgeFactoryPacket",
  cancelFactoryPacket: "production/packets:cancelFactoryPacket",
  applyLegacyMasterCardImportChunk:
    "engineering/masterCardImports:applyLegacyMasterCardImportChunk",
});

/* -------------------------------------------------------------------------- */
/* Query references                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The paging arguments an organization-scoped order-to-ship list takes.
 *
 * A customer, an order, a design, and a card belong to the *tenant*, not to a
 * site: a design approved in Bangkok is the same design in Lamphun, and making
 * these reads warehouse-scoped would ask a sales person to choose a warehouse
 * before they could name a customer.
 */
export type OrgPageArgs = {
  readonly maxPageSize?: number;
  readonly cursor?: string;
};

/** The factory packet is the exception: it is issued *to a site*. */
export type SitePageArgs = OrgPageArgs & {
  readonly warehouseId: string;
};

export const listCustomersRef = makeFunctionReference<
  "query",
  OrgPageArgs & { readonly status?: MasterDataStatus },
  TenantOutcome<MasterDataPage<CustomerRow>>
>(ORDER_TO_SHIP_QUERY_PATHS.listCustomers);

export const listCustomerOrdersRef = makeFunctionReference<
  "query",
  OrgPageArgs & { readonly status?: CustomerOrderStatus },
  TenantOutcome<MasterDataPage<CustomerOrderRow>>
>(ORDER_TO_SHIP_QUERY_PATHS.listCustomerOrders);

export const listCustomerOrderLinesRef = makeFunctionReference<
  "query",
  OrgPageArgs & {
    readonly customerOrderId: string;
    readonly status?: CustomerOrderLineStatus;
  },
  TenantOutcome<MasterDataPage<CustomerOrderLineRow>>
>(ORDER_TO_SHIP_QUERY_PATHS.listCustomerOrderLines);

export const listRoutableCustomerOrderLinesRef = makeFunctionReference<
  "query",
  OrgPageArgs,
  TenantOutcome<MasterDataPage<CustomerOrderLineRow>>
>(ORDER_TO_SHIP_QUERY_PATHS.listRoutableCustomerOrderLines);

export const listDesignRequestsRef = makeFunctionReference<
  "query",
  OrgPageArgs & { readonly status?: DesignRequestStatus },
  TenantOutcome<MasterDataPage<DesignRequestRow>>
>(ORDER_TO_SHIP_QUERY_PATHS.listDesignRequests);

export const listDesignRequirementVersionsRef = makeFunctionReference<
  "query",
  OrgPageArgs & { readonly designRequestId: string },
  TenantOutcome<MasterDataPage<DesignRequirementVersionRow>>
>(ORDER_TO_SHIP_QUERY_PATHS.listDesignRequirementVersions);

export const listDesignChangeImpactsRef = makeFunctionReference<
  "query",
  OrgPageArgs & { readonly status?: "OPEN" | "ACKNOWLEDGED" },
  TenantOutcome<MasterDataPage<DesignChangeImpactRow>>
>(ORDER_TO_SHIP_QUERY_PATHS.listDesignChangeImpacts);

export interface SimilarReleasedDesignRow {
  readonly masterCardId: string;
  readonly masterCardRevisionId: string;
  readonly cardNumber: string;
  readonly customerProductCode: string;
  readonly revisionNumber: number;
  readonly score: number;
  readonly specification: BoxSpecification;
}

export const listSimilarReleasedDesignsRef = makeFunctionReference<
  "query",
  { readonly designRequestId: string },
  TenantOutcome<readonly SimilarReleasedDesignRow[]>
>(ORDER_TO_SHIP_QUERY_PATHS.listSimilarReleasedDesigns);

export const listReleasedRevisionsRef = makeFunctionReference<
  "query",
  OrgPageArgs & { readonly masterCardId: string },
  TenantOutcome<MasterDataPage<ReleasedRevisionRow>>
>(ORDER_TO_SHIP_QUERY_PATHS.listReleasedRevisions);

export const listMasterCardsRef = makeFunctionReference<
  "query",
  OrgPageArgs & { readonly status?: MasterDataStatus },
  TenantOutcome<MasterDataPage<MasterCardRow>>
>(ORDER_TO_SHIP_QUERY_PATHS.listMasterCards);

export const listMasterCardRevisionsRef = makeFunctionReference<
  "query",
  OrgPageArgs & {
    readonly masterCardId: string;
    readonly status?: MasterCardRevisionStatus;
  },
  TenantOutcome<MasterDataPage<MasterCardRevisionRow>>
>(ORDER_TO_SHIP_QUERY_PATHS.listMasterCardRevisions);

export const listMasterCardFilesRef = makeFunctionReference<
  "query",
  OrgPageArgs & { readonly masterCardRevisionId: string },
  TenantOutcome<MasterDataPage<MasterCardFileRow>>
>(ORDER_TO_SHIP_QUERY_PATHS.listMasterCardFiles);

export const listFactoryPacketsRef = makeFunctionReference<
  "query",
  SitePageArgs & { readonly status?: FactoryPacketStatus },
  TenantOutcome<MasterDataPage<FactoryPacketRow>>
>(ORDER_TO_SHIP_QUERY_PATHS.listFactoryPackets);

export const previewLegacyMasterCardImportRef = makeFunctionReference<
  "query",
  { readonly rows: readonly LegacyMasterCardImportRow[] },
  TenantOutcome<{
    readonly accepted: readonly (LegacyMasterCardImportRow & {
      readonly revisionStatus: "DRAFT" | "RELEASED";
      readonly needsReviewReasons: readonly string[];
    })[];
    readonly problems: readonly {
      readonly sourceRow?: number;
      readonly field?: string;
      readonly code: string;
      readonly reason?: string;
    }[];
    readonly nextSourceRow: number | null;
  }>
>(ORDER_TO_SHIP_QUERY_PATHS.previewLegacyMasterCardImport);

/* -------------------------------------------------------------------------- */
/* Mutation references                                                         */
/* -------------------------------------------------------------------------- */

const writeRef = <Args extends Record<string, unknown>>(path: string) =>
  makeFunctionReference<
    "mutation",
    Args,
    TenantOutcome<MasterDataWriteOutcome>
  >(path);

export const createCustomerRef = writeRef<{
  requestId: string;
  code: string;
  name: string;
}>(ORDER_TO_SHIP_MUTATION_PATHS.createCustomer);

export const updateCustomerRef = writeRef<{
  requestId: string;
  customerId: string;
  name?: string;
  status?: MasterDataStatus;
}>(ORDER_TO_SHIP_MUTATION_PATHS.updateCustomer);

export const createCustomerOrderRef = writeRef<{
  requestId: string;
  orderNumber: string;
  customerId: string;
  customerReference?: string;
}>(ORDER_TO_SHIP_MUTATION_PATHS.createCustomerOrder);

/**
 * Add a line, which is where the design decision is taken.
 *
 * The client sends a specification and nothing else about the design. The server
 * normalizes the customer product code, looks for that customer's released card,
 * and either pins it (`EXISTING`) or raises a design request (`NEW`). The derived
 * structural key is advisory and cannot make this decision.
 */
export const addCustomerOrderLineRef = writeRef<{
  requestId: string;
  customerOrderId: string;
  lineNumber: number;
  customerProductCode: string;
  specification: BoxSpecification;
  orderedQuantity: number;
  designPriority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  designDueAt?: number;
}>(ORDER_TO_SHIP_MUTATION_PATHS.addCustomerOrderLine);

export const releaseCustomerOrderRef = writeRef<{
  requestId: string;
  customerOrderId: string;
}>(ORDER_TO_SHIP_MUTATION_PATHS.releaseCustomerOrder);

/** Maker-checker: whoever opened the order cannot be the one who kills it. */
export const cancelCustomerOrderRef = writeRef<{
  requestId: string;
  customerOrderId: string;
}>(ORDER_TO_SHIP_MUTATION_PATHS.cancelCustomerOrder);

export const cancelCustomerOrderLineRef = writeRef<{
  requestId: string;
  customerOrderLineId: string;
}>(ORDER_TO_SHIP_MUTATION_PATHS.cancelCustomerOrderLine);

export const assignDesignRequestRef = writeRef<{
  requestId: string;
  designRequestId: string;
  assignedToUserId?: string;
}>(ORDER_TO_SHIP_MUTATION_PATHS.assignDesignRequest);

export const progressDesignRequestRef = writeRef<{
  requestId: string;
  designRequestId: string;
  nextStatus: "IN_PROGRESS" | "IN_REVIEW";
}>(ORDER_TO_SHIP_MUTATION_PATHS.progressDesignRequest);

export const recordDesignRequirementsRef = writeRef<{
  requestId: string;
  designRequestId: string;
  confirmations: DesignRequirementConfirmations;
  note?: string;
}>(ORDER_TO_SHIP_MUTATION_PATHS.recordDesignRequirements);

export const fulfilDesignRequestRef = writeRef<{
  requestId: string;
  designRequestId: string;
  masterCardRevisionId: string;
}>(ORDER_TO_SHIP_MUTATION_PATHS.fulfilDesignRequest);

export const confirmSimilarDesignRef = writeRef<{
  requestId: string;
  designRequestId: string;
  masterCardRevisionId: string;
  reason: string;
}>(ORDER_TO_SHIP_MUTATION_PATHS.confirmSimilarDesign);

export const createMasterCardRef = writeRef<{
  requestId: string;
  cardNumber: string;
  customerId: string;
  customerProductCode: string;
  name: string;
  specification: BoxSpecification;
}>(ORDER_TO_SHIP_MUTATION_PATHS.createMasterCard);

export const draftMasterCardRevisionRef = writeRef<{
  requestId: string;
  masterCardId: string;
  specification: BoxSpecification;
}>(ORDER_TO_SHIP_MUTATION_PATHS.draftMasterCardRevision);

export const submitMasterCardRevisionRef = writeRef<{
  requestId: string;
  masterCardRevisionId: string;
}>(ORDER_TO_SHIP_MUTATION_PATHS.submitMasterCardRevision);

/**
 * Approve or reject a submitted revision.
 *
 * The author is refused by the server, and the control is still offered to them:
 * a button that disappears teaches nothing, and `SEPARATION_OF_DUTIES` teaches
 * that a second person is required (`INV-0013-03`, `INV-0006-05`).
 */
export const decideMasterCardRevisionRef = writeRef<{
  requestId: string;
  masterCardRevisionId: string;
  decision: RevisionDecision;
  note?: string;
}>(ORDER_TO_SHIP_MUTATION_PATHS.decideMasterCardRevision);

export const acknowledgeDesignChangeImpactRef = writeRef<{
  requestId: string;
  designChangeImpactId: string;
  note: string;
}>(ORDER_TO_SHIP_MUTATION_PATHS.acknowledgeDesignChangeImpact);

export const attachMasterCardFileRef = writeRef<{
  requestId: string;
  masterCardRevisionId: string;
  fileKey: string;
  fileName: string;
  kind: MasterCardFileKind;
  contentType: string;
  byteSize: number;
  contentDigest: string;
  storageId?: string;
  uploadThingKey?: string;
  uploadGrantId: string;
}>(ORDER_TO_SHIP_MUTATION_PATHS.attachMasterCardFile);

export const authorizeMasterCardFileUploadRef = makeFunctionReference<
  "mutation",
  {
    readonly masterCardRevisionId: string;
    readonly transport?: "UPLOADTHING";
  },
  TenantOutcome<
    | {
        readonly uploadUrl?: string;
        readonly uploadGrantId: string;
        readonly expiresAt: number;
      }
    | MasterDataWriteOutcome
  >
>(ORDER_TO_SHIP_MUTATION_PATHS.authorizeMasterCardFileUpload);

export const authorizeLegacyMasterCardFileUploadRef = makeFunctionReference<
  "mutation",
  { readonly batchRef: string; readonly sourceRow: number },
  TenantOutcome<
    | {
        readonly uploadUrl: string;
        readonly uploadGrantId: string;
        readonly expiresAt: number;
      }
    | MasterDataWriteOutcome
  >
>(ORDER_TO_SHIP_MUTATION_PATHS.authorizeLegacyMasterCardFileUpload);

/** Not a write envelope: the answer is a link, or the reason there is none. */
export const requestMasterCardFileAccessRef = makeFunctionReference<
  "mutation",
  { readonly masterCardFileId: string },
  TenantOutcome<FileAccessOutcome>
>(ORDER_TO_SHIP_MUTATION_PATHS.requestMasterCardFileAccess);

export const requestFactoryPacketFileAccessRef = makeFunctionReference<
  "mutation",
  {
    readonly warehouseId: string;
    readonly factoryPacketId: string;
    readonly masterCardFileId: string;
  },
  TenantOutcome<FileAccessOutcome>
>(ORDER_TO_SHIP_MUTATION_PATHS.requestFactoryPacketFileAccess);

export const issueFactoryPacketRef = writeRef<{
  requestId: string;
  warehouseId: string;
  customerOrderLineId: string;
}>(ORDER_TO_SHIP_MUTATION_PATHS.issueFactoryPacket);

export const acknowledgeFactoryPacketRef = writeRef<{
  requestId: string;
  warehouseId: string;
  factoryPacketId: string;
}>(ORDER_TO_SHIP_MUTATION_PATHS.acknowledgeFactoryPacket);

export const cancelFactoryPacketRef = writeRef<{
  requestId: string;
  warehouseId: string;
  factoryPacketId: string;
}>(ORDER_TO_SHIP_MUTATION_PATHS.cancelFactoryPacket);

export const applyLegacyMasterCardImportChunkRef = writeRef<{
  requestId: string;
  batchRef: string;
  rows: readonly LegacyMasterCardImportRow[];
}>(ORDER_TO_SHIP_MUTATION_PATHS.applyLegacyMasterCardImportChunk);
