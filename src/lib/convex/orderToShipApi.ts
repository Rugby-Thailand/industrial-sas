/**
 * Typed references to the order-to-ship functions, and their wire types.
 *
 * Function references come from Convex code generation. The named row and
 * outcome types remain the presentation vocabulary shared by this workflow.
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
import { api } from "../../../convex/_generated/api";

import { clientRef } from "./clientRef";
import type { MasterDataStatus } from "./masterDataApi";

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
  readonly designKey: string;
  readonly designSource: DesignSource;
  readonly status: CustomerOrderLineStatus;
  readonly orderedQuantity: number;
  readonly masterCardRevisionId?: string;
  readonly similarityConfirmation?: {
    readonly score: number;
    readonly reason: string;
    readonly confirmedByUserId: string;
    readonly confirmedAt: number;
  };
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

/* -------------------------------------------------------------------------- */
/* Query references                                                            */
/* -------------------------------------------------------------------------- */
export const listCustomerOrdersRef = clientRef(
  api.sales.orders.listCustomerOrders,
);
export const listCustomerOrderLinesRef = clientRef(
  api.sales.orders.listCustomerOrderLines,
);
export const listRoutableCustomerOrderLinesRef = clientRef(
  api.sales.orders.listRoutableCustomerOrderLines,
);
export const listDesignRequestsRef = clientRef(
  api.engineering.designRequests.listDesignRequests,
);
export const listDesignRequirementVersionsRef = clientRef(
  api.engineering.requirements.listDesignRequirementVersions,
);
export const listDesignChangeImpactsRef = clientRef(
  api.engineering.changeImpacts.listDesignChangeImpacts,
);

export const listSimilarReleasedDesignsRef = clientRef(
  api.engineering.designRequests.listSimilarReleasedDesigns,
);
export const listMasterCardsRef = clientRef(
  api.engineering.masterCards.listMasterCards,
);
export const listMasterCardRevisionsRef = clientRef(
  api.engineering.masterCards.listMasterCardRevisions,
);
export const listMasterCardFilesRef = clientRef(
  api.engineering.files.listMasterCardFiles,
);
export const listFactoryPacketsRef = clientRef(
  api.production.packets.listFactoryPackets,
);

/* -------------------------------------------------------------------------- */
/* Mutation references                                                         */
/* -------------------------------------------------------------------------- */

export const createCustomerOrderRef = clientRef(
  api.sales.orders.createCustomerOrder,
);

/**
 * Add a line, which is where the design decision is taken.
 *
 * The client sends a specification and nothing else about the design. The server
 * normalizes the customer product code, looks for that customer's released card,
 * and either pins it (`EXISTING`) or raises a design request (`NEW`). The derived
 * structural key is advisory and cannot make this decision.
 */
export const addCustomerOrderLineRef = clientRef(
  api.sales.orders.addCustomerOrderLine,
);
export const releaseCustomerOrderRef = clientRef(
  api.sales.orders.releaseCustomerOrder,
);

/** Maker-checker: whoever opened the order cannot be the one who kills it. */
export const assignDesignRequestRef = clientRef(
  api.engineering.designRequests.assignDesignRequest,
);
export const progressDesignRequestRef = clientRef(
  api.engineering.designRequests.progressDesignRequest,
);
export const recordDesignRequirementsRef = clientRef(
  api.engineering.requirements.recordDesignRequirements,
);
export const fulfilDesignRequestRef = clientRef(
  api.engineering.designRequests.fulfilDesignRequest,
);
export const confirmSimilarDesignRef = clientRef(
  api.engineering.designRequests.confirmSimilarDesign,
);
export const createMasterCardRef = clientRef(
  api.engineering.masterCards.createMasterCard,
);
export const draftMasterCardRevisionRef = clientRef(
  api.engineering.masterCards.draftMasterCardRevision,
);
export const submitMasterCardRevisionRef = clientRef(
  api.engineering.masterCards.submitMasterCardRevision,
);

/**
 * Approve or reject a submitted revision.
 *
 * The author is refused by the server, and the control is still offered to them:
 * a button that disappears teaches nothing, and `SEPARATION_OF_DUTIES` teaches
 * that a second person is required (`INV-0013-03`, `INV-0006-05`).
 */
export const decideMasterCardRevisionRef = clientRef(
  api.engineering.masterCards.decideMasterCardRevision,
);
export const acknowledgeDesignChangeImpactRef = clientRef(
  api.engineering.changeImpacts.acknowledgeDesignChangeImpact,
);
export const attachMasterCardFileRef = clientRef(
  api.engineering.files.attachMasterCardFile,
);
export const authorizeMasterCardFileUploadRef = clientRef(
  api.engineering.files.authorizeMasterCardFileUpload,
);

/** Not a write envelope: the answer is a link, or the reason there is none. */
export const requestMasterCardFileAccessRef = clientRef(
  api.engineering.files.requestMasterCardFileAccess,
);
export const requestFactoryPacketFileAccessRef = clientRef(
  api.production.packets.requestFactoryPacketFileAccess,
);
export const issueFactoryPacketRef = clientRef(
  api.production.packets.issueFactoryPacket,
);
export const acknowledgeFactoryPacketRef = clientRef(
  api.production.packets.acknowledgeFactoryPacket,
);
