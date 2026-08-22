/**
 * Typed references to the Phase 1 shared-platform functions, and their wire
 * types.
 *
 * Hand-declared for the same reason every other API module here is:
 * `convex/_generated/` is a build artifact of `convex dev`, absent in CI and on
 * a machine that has never provisioned a deployment. `platformApi.test.ts`
 * re-reads the server modules, so a renamed export fails here rather than at
 * runtime.
 *
 * Every write carries a `requestId` in its argument type, and for the shared
 * operator surfaces that key does double duty: it makes a retry a replay, and
 * it is the identity a queued intent keeps while it waits
 * (`src/lib/offline/intentQueue.ts`).
 */
import { makeFunctionReference } from "convex/server";

import type { TenantOutcome } from "./ledgerApi";
import type { MasterDataWriteOutcome } from "./masterDataApi";

export const PLATFORM_FUNCTION_PATHS = Object.freeze({
  listDevices: "platform/devices:listDevices",
  registerDevice: "platform/devices:registerDevice",
  renameDevice: "platform/devices:renameDevice",
  bindDeviceInstallation: "platform/devices:bindDeviceInstallation",
  retireDevice: "platform/devices:retireDevice",
  recordDeviceSeen: "platform/devices:recordDeviceSeen",
  listOperatorTasks: "platform/tasks:listOperatorTasks",
  listOperatorTaskEvidence: "platform/tasks:listOperatorTaskEvidence",
  createOperatorTask: "platform/tasks:createOperatorTask",
  claimOperatorTask: "platform/tasks:claimOperatorTask",
  heartbeatOperatorTask: "platform/tasks:heartbeatOperatorTask",
  releaseOperatorTask: "platform/tasks:releaseOperatorTask",
  reassignOperatorTask: "platform/tasks:reassignOperatorTask",
  completeOperatorTask: "platform/tasks:completeOperatorTask",
  recordTaskEvidence: "platform/tasks:recordTaskEvidence",
  listTaskExceptions: "platform/exceptions:listTaskExceptions",
  reportTaskException: "platform/exceptions:reportTaskException",
  resolveTaskException: "platform/exceptions:resolveTaskException",
  listTaskFiles: "platform/taskFiles:listTaskFiles",
  authorizeTaskFileUpload: "platform/taskFiles:authorizeTaskFileUpload",
  attachTaskFile: "platform/taskFiles:attachTaskFile",
  requestTaskFileAccess: "platform/taskFiles:requestTaskFileAccess",
  approveOnDevice: "platform/stepUp:approveOnDevice",
});

/* -------------------------------------------------------------------------- */
/* Devices                                                                     */
/* -------------------------------------------------------------------------- */

export type DeviceType = "HANDHELD" | "WORKSTATION" | "TABLET";
export type DeviceStatus = "ACTIVE" | "RETIRED";

export interface DeviceRow {
  readonly deviceId: string;
  readonly label: string;
  readonly deviceType: DeviceType;
  readonly status: DeviceStatus;
  readonly warehouseId?: string;
  /**
   * Whether an installation is bound, never which one. The registry has no
   * reason to render a correlation value, and echoing it would put a
   * device-identifying string on every row.
   */
  readonly installationBound: boolean;
  readonly lastSeenAt?: number;
  readonly retiredAt?: number;
}

export interface DevicePage {
  readonly ok: true;
  readonly items: readonly DeviceRow[];
  readonly nextCursor: string | null;
  readonly complete: boolean;
}

export type PageOutcome<Page> =
  Page | { readonly ok: false; readonly error: { readonly code: string } };

export const listDevicesRef = makeFunctionReference<
  "query",
  {
    readonly status?: DeviceStatus;
    readonly maxPageSize?: number;
    readonly cursor?: string;
  },
  TenantOutcome<PageOutcome<DevicePage>>
>(PLATFORM_FUNCTION_PATHS.listDevices);

export const registerDeviceRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly label: string;
    readonly deviceType: DeviceType;
    readonly warehouseId?: string;
    readonly installationId?: string;
  },
  TenantOutcome<MasterDataWriteOutcome>
>(PLATFORM_FUNCTION_PATHS.registerDevice);

export const renameDeviceRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly deviceId: string;
    readonly label: string;
  },
  TenantOutcome<MasterDataWriteOutcome>
>(PLATFORM_FUNCTION_PATHS.renameDevice);

export const bindDeviceInstallationRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly deviceId: string;
    readonly installationId: string;
  },
  TenantOutcome<MasterDataWriteOutcome>
>(PLATFORM_FUNCTION_PATHS.bindDeviceInstallation);

export const retireDeviceRef = makeFunctionReference<
  "mutation",
  { readonly requestId: string; readonly deviceId: string },
  TenantOutcome<MasterDataWriteOutcome>
>(PLATFORM_FUNCTION_PATHS.retireDevice);

export const recordDeviceSeenRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly installationId: string;
  },
  TenantOutcome<MasterDataWriteOutcome>
>(PLATFORM_FUNCTION_PATHS.recordDeviceSeen);

/* -------------------------------------------------------------------------- */
/* Tasks                                                                       */
/* -------------------------------------------------------------------------- */

export type OperatorTaskStatus =
  "AVAILABLE" | "CLAIMED" | "COMPLETED" | "CANCELLED";

/**
 * The lease as the server read it, not as the browser guesses it.
 *
 * A handheld clock can be minutes out, so "has this lapsed" is decided against
 * the server clock and sent as a decided fact. `remainingMs` is what a countdown
 * counts down from — the screen may age it locally, but it may not re-derive it.
 */
export type LeaseView =
  | { readonly kind: "UNCLAIMED" }
  | {
      readonly kind: "HELD";
      readonly holderUserId: string;
      readonly expiresAt: number;
      readonly remainingMs: number;
    }
  | {
      readonly kind: "EXPIRED";
      readonly holderUserId: string;
      readonly expiredAt: number;
    }
  | { readonly kind: "CLOSED"; readonly status: OperatorTaskStatus };

export interface OperatorTaskRow {
  readonly operatorTaskId: string;
  readonly warehouseId: string;
  readonly taskNumber: string;
  readonly kind: "SUPERVISOR_ASSIGNED";
  readonly instruction: string;
  readonly status: OperatorTaskStatus;
  readonly itemId?: string;
  /** The base unit the expectation is counted in. Absent when no item is named. */
  readonly baseUom?: string;
  readonly locationId?: string;
  readonly expectedBaseMinorUnits?: number;
  readonly dueAt?: number;
  readonly evidenceCount: number;
  readonly lease: LeaseView;
}

export interface OperatorTaskPage {
  readonly ok: true;
  readonly items: readonly OperatorTaskRow[];
  readonly nextCursor: string | null;
  readonly complete: boolean;
  /** The server clock the leases were judged against. */
  readonly asOf: number;
}

export type TaskEvidenceKind = "QUANTITY" | "SCAN" | "NOTE" | "HANDOVER";
export type QuantityPlausibility = "PLAUSIBLE" | "UNCHECKED" | "IMPLAUSIBLE";

export interface TaskEvidenceRow {
  readonly evidenceId: string;
  readonly operatorTaskId: string;
  readonly sequence: number;
  readonly kind: TaskEvidenceKind;
  readonly capturedByUserId: string;
  readonly capturedAt: number;
  readonly enteredQuantity?: {
    readonly uom: string;
    readonly minorUnits: number;
  };
  readonly baseMinorUnits?: number;
  readonly plausibility?: QuantityPlausibility;
  readonly scanValue?: string;
  readonly resolvedItemId?: string;
  readonly resolvedSku?: string;
  readonly scanVia?: "BARCODE" | "SKU";
  readonly scanInputMethod?: "HID" | "MANUAL";
  readonly manualEntryReason?: string;
  readonly note?: string;
  readonly previousHolderUserId?: string;
  readonly supervisorApproved: boolean;
}

export interface TaskEvidencePage {
  readonly ok: true;
  readonly items: readonly TaskEvidenceRow[];
  readonly nextCursor: string | null;
  readonly complete: boolean;
}

export const listOperatorTasksRef = makeFunctionReference<
  "query",
  {
    readonly warehouseId: string;
    readonly scope?: "SITE" | "MINE";
    readonly status?: OperatorTaskStatus;
    readonly maxPageSize?: number;
    readonly cursor?: string;
  },
  TenantOutcome<PageOutcome<OperatorTaskPage>>
>(PLATFORM_FUNCTION_PATHS.listOperatorTasks);

export const listOperatorTaskEvidenceRef = makeFunctionReference<
  "query",
  {
    readonly warehouseId: string;
    readonly operatorTaskId: string;
    readonly maxPageSize?: number;
    readonly cursor?: string;
  },
  TenantOutcome<PageOutcome<TaskEvidencePage>>
>(PLATFORM_FUNCTION_PATHS.listOperatorTaskEvidence);

export interface ClaimOutcome {
  readonly written: true;
  readonly documentId: string;
  readonly replayed: boolean;
  readonly alreadyHeld: boolean;
  readonly leaseExpiresAt: number;
  readonly retainedEvidenceCount: number;
}

export type ClaimResult =
  | ClaimOutcome
  | {
      readonly written: false;
      readonly error: { readonly code: string; readonly field?: string };
    };

export const claimOperatorTaskRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly operatorTaskId: string;
  },
  TenantOutcome<ClaimResult>
>(PLATFORM_FUNCTION_PATHS.claimOperatorTask);

export const heartbeatOperatorTaskRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly operatorTaskId: string;
    readonly installationId?: string;
  },
  TenantOutcome<MasterDataWriteOutcome>
>(PLATFORM_FUNCTION_PATHS.heartbeatOperatorTask);

export const releaseOperatorTaskRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly operatorTaskId: string;
    readonly reason: string;
  },
  TenantOutcome<MasterDataWriteOutcome>
>(PLATFORM_FUNCTION_PATHS.releaseOperatorTask);

export const reassignOperatorTaskRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly operatorTaskId: string;
    readonly toUserId: string;
    readonly reason: string;
  },
  TenantOutcome<MasterDataWriteOutcome>
>(PLATFORM_FUNCTION_PATHS.reassignOperatorTask);

export const completeOperatorTaskRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly operatorTaskId: string;
  },
  TenantOutcome<MasterDataWriteOutcome>
>(PLATFORM_FUNCTION_PATHS.completeOperatorTask);

export interface EvidenceOutcome {
  readonly written: true;
  readonly documentId: string;
  readonly replayed: boolean;
  readonly sequence: number;
  readonly baseMinorUnits?: number;
  readonly plausibility?: QuantityPlausibility;
  readonly resolvedItemId?: string;
  readonly resolvedSku?: string;
  readonly scanVia?: "BARCODE" | "SKU";
}

export type EvidenceResult =
  | EvidenceOutcome
  | {
      readonly written: false;
      readonly error: {
        readonly code: string;
        readonly field?: string;
        readonly reason?: string;
      };
    };

export const recordTaskEvidenceRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly operatorTaskId: string;
    readonly kind: "QUANTITY" | "SCAN" | "NOTE";
    readonly quantityText?: string;
    readonly entryUom?: string;
    readonly scanValue?: string;
    readonly scanInputMethod?: "HID" | "MANUAL";
    readonly manualEntryReason?: string;
    readonly note?: string;
    readonly installationId?: string;
    readonly stepUpApprovalId?: string;
  },
  TenantOutcome<EvidenceResult>
>(PLATFORM_FUNCTION_PATHS.recordTaskEvidence);

/* -------------------------------------------------------------------------- */
/* Task exceptions                                                            */
/* -------------------------------------------------------------------------- */

export type TaskExceptionDisposition =
  "RESUME" | "REASSIGN" | "STOP" | "ESCALATE";

export interface TaskExceptionRow {
  readonly operatorTaskExceptionId: string;
  readonly operatorTaskId: string;
  readonly warehouseId: string;
  readonly reasonCodeId: string;
  readonly reasonCode: string;
  readonly reasonName: string;
  readonly summary: string;
  readonly evidence: string;
  readonly proposedDisposition: TaskExceptionDisposition;
  readonly proposedRecoveryAction: string;
  readonly status: "OPEN" | "RESOLVED" | "WITHDRAWN";
  readonly reportedByUserId: string;
  readonly reportedAt: number;
  readonly finalDisposition?: TaskExceptionDisposition;
  readonly recoveryAction?: string;
  readonly approverNote?: string;
  readonly resolvedByUserId?: string;
  readonly resolvedAt?: number;
}

export interface TaskExceptionPage {
  readonly ok: true;
  readonly items: readonly TaskExceptionRow[];
  readonly nextCursor: string | null;
  readonly complete: boolean;
}

export const listTaskExceptionsRef = makeFunctionReference<
  "query",
  {
    readonly warehouseId: string;
    readonly operatorTaskId: string;
    readonly maxPageSize?: number;
    readonly cursor?: string;
  },
  TenantOutcome<PageOutcome<TaskExceptionPage>>
>(PLATFORM_FUNCTION_PATHS.listTaskExceptions);

export const reportTaskExceptionRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly operatorTaskId: string;
    readonly reasonCodeId: string;
    readonly summary: string;
    readonly evidence: string;
    readonly proposedDisposition: TaskExceptionDisposition;
    readonly proposedRecoveryAction: string;
  },
  TenantOutcome<MasterDataWriteOutcome>
>(PLATFORM_FUNCTION_PATHS.reportTaskException);

export const resolveTaskExceptionRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly operatorTaskExceptionId: string;
    readonly finalDisposition: TaskExceptionDisposition;
    readonly recoveryAction: string;
    readonly approverNote?: string;
  },
  TenantOutcome<MasterDataWriteOutcome>
>(PLATFORM_FUNCTION_PATHS.resolveTaskException);

/* -------------------------------------------------------------------------- */
/* Private task attachments                                                    */
/* -------------------------------------------------------------------------- */

export type TaskAttachmentKind = "PHOTO" | "DOCUMENT" | "OTHER";

export interface TaskAttachmentRow {
  readonly operatorTaskAttachmentId: string;
  readonly operatorTaskId: string;
  readonly warehouseId: string;
  readonly fileName: string;
  readonly kind: TaskAttachmentKind;
  readonly contentType: string;
  readonly byteSize: number;
  readonly contentDigest: string;
  readonly note?: string;
  readonly verifiedAt: number;
  readonly attachedByUserId: string;
  readonly attachedAt: number;
}

export interface TaskAttachmentPage {
  readonly ok: true;
  readonly items: readonly TaskAttachmentRow[];
  readonly nextCursor: string | null;
  readonly complete: boolean;
}

export const listTaskFilesRef = makeFunctionReference<
  "query",
  {
    readonly warehouseId: string;
    readonly operatorTaskId: string;
    readonly maxPageSize?: number;
    readonly cursor?: string;
  },
  TenantOutcome<PageOutcome<TaskAttachmentPage>>
>(PLATFORM_FUNCTION_PATHS.listTaskFiles);

export const authorizeTaskFileUploadRef = makeFunctionReference<
  "mutation",
  { readonly warehouseId: string; readonly operatorTaskId: string },
  TenantOutcome<
    | { readonly uploadGrantId: string; readonly expiresAt: number }
    | MasterDataWriteOutcome
  >
>(PLATFORM_FUNCTION_PATHS.authorizeTaskFileUpload);

export const attachTaskFileRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly operatorTaskId: string;
    readonly uploadGrantId: string;
    readonly fileName: string;
    readonly kind: TaskAttachmentKind;
    readonly contentType: string;
    readonly byteSize: number;
    readonly contentDigest: string;
    readonly uploadThingKey: string;
    readonly note?: string;
  },
  TenantOutcome<MasterDataWriteOutcome>
>(PLATFORM_FUNCTION_PATHS.attachTaskFile);

export const requestTaskFileAccessRef = makeFunctionReference<
  "mutation",
  { readonly warehouseId: string; readonly operatorTaskAttachmentId: string },
  TenantOutcome<
    | {
        readonly granted: true;
        readonly url: string;
        readonly expiresAt: number;
      }
    | { readonly granted: false; readonly error: { readonly code: string } }
  >
>(PLATFORM_FUNCTION_PATHS.requestTaskFileAccess);

/* -------------------------------------------------------------------------- */
/* Step-up                                                                     */
/* -------------------------------------------------------------------------- */

export interface StepUpApprovalOutcome {
  readonly written: true;
  readonly documentId: string;
  readonly replayed: boolean;
  readonly expiresAt: number;
  readonly decision: "APPROVED" | "REJECTED";
}

export type StepUpApprovalResult =
  | StepUpApprovalOutcome
  | {
      readonly written: false;
      readonly error: { readonly code: string; readonly field?: string };
    };

export const approveOnDeviceRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly operatorUserId: string;
    readonly operatorTaskId: string;
    readonly installationId: string;
    readonly decision: "APPROVED" | "REJECTED";
    readonly reason: string;
  },
  TenantOutcome<StepUpApprovalResult>
>(PLATFORM_FUNCTION_PATHS.approveOnDevice);
