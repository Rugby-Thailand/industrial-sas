/**
 * Typed references to the Phase 1 shared-platform functions, and the small
 * presentation vocabulary the operator screens share.
 *
 * References come from committed, credential-free Convex codegen, so a server
 * rename or an argument change is a type error here rather than "function not
 * found" on a handheld.
 *
 * Every write carries a `requestId` in its argument type, and for the shared
 * operator surfaces that key does double duty: it makes a retry a replay, and
 * it is the identity a queued intent keeps while it waits
 * (`src/lib/offline/intentQueue.ts`).
 */
import { getFunctionName } from "convex/server";

import { api } from "../../../convex/_generated/api";

import { clientRef, type RefValue } from "./clientRef";

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

export const listDevicesRef = clientRef(api.platform.devices.listDevices);
export const registerDeviceRef = clientRef(api.platform.devices.registerDevice);
export const renameDeviceRef = clientRef(api.platform.devices.renameDevice);
export const bindDeviceInstallationRef = clientRef(
  api.platform.devices.bindDeviceInstallation,
);
export const retireDeviceRef = clientRef(api.platform.devices.retireDevice);
export const recordDeviceSeenRef = clientRef(
  api.platform.devices.recordDeviceSeen,
);

export type DevicePage = Extract<
  RefValue<typeof listDevicesRef>,
  { readonly ok: true }
>;
export type PageOutcome<Page> =
  Page | { readonly ok: false; readonly error: { readonly code: string } };

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

export interface TaskEvidenceRow {
  readonly evidenceId: string;
  readonly operatorTaskId: string;
  readonly sequence: number;
  readonly kind: "QUANTITY" | "SCAN" | "NOTE" | "HANDOVER";
  readonly capturedByUserId: string;
  readonly capturedAt: number;
  readonly enteredQuantity?: {
    readonly uom: string;
    readonly minorUnits: number;
  };
  readonly baseMinorUnits?: number;
  readonly plausibility?: "PLAUSIBLE" | "UNCHECKED" | "IMPLAUSIBLE";
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

export const listOperatorTasksRef = clientRef(
  api.platform.tasks.listOperatorTasks,
);
export const listOperatorTaskEvidenceRef = clientRef(
  api.platform.tasks.listOperatorTaskEvidence,
);
export const claimOperatorTaskRef = clientRef(
  api.platform.tasks.claimOperatorTask,
);
export const heartbeatOperatorTaskRef = clientRef(
  api.platform.tasks.heartbeatOperatorTask,
);
export const releaseOperatorTaskRef = clientRef(
  api.platform.tasks.releaseOperatorTask,
);
export const reassignOperatorTaskRef = clientRef(
  api.platform.tasks.reassignOperatorTask,
);
export const completeOperatorTaskRef = clientRef(
  api.platform.tasks.completeOperatorTask,
);
export const recordTaskEvidenceRef = clientRef(
  api.platform.tasks.recordTaskEvidence,
);

export type OperatorTaskPage = Extract<
  RefValue<typeof listOperatorTasksRef>,
  { readonly ok: true }
>;
export type TaskEvidenceKind = TaskEvidenceRow["kind"];
export type QuantityPlausibility = NonNullable<TaskEvidenceRow["plausibility"]>;
export type TaskEvidencePage = Extract<
  RefValue<typeof listOperatorTaskEvidenceRef>,
  { readonly ok: true }
>;
export type ClaimResult = RefValue<typeof claimOperatorTaskRef>;
export type ClaimOutcome = Extract<ClaimResult, { readonly written: true }>;
export type EvidenceResult = RefValue<typeof recordTaskEvidenceRef>;
export type EvidenceOutcome = Extract<
  EvidenceResult,
  { readonly written: true }
>;

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

export const listTaskExceptionsRef = clientRef(
  api.platform.exceptions.listTaskExceptions,
);
export const reportTaskExceptionRef = clientRef(
  api.platform.exceptions.reportTaskException,
);
export const resolveTaskExceptionRef = clientRef(
  api.platform.exceptions.resolveTaskException,
);

export type TaskExceptionPage = Extract<
  RefValue<typeof listTaskExceptionsRef>,
  { readonly ok: true }
>;

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

export const listTaskFilesRef = clientRef(api.platform.taskFiles.listTaskFiles);
export const authorizeTaskFileUploadRef = clientRef(
  api.platform.taskFiles.authorizeTaskFileUpload,
);
export const attachTaskFileRef = clientRef(
  api.platform.taskFiles.attachTaskFile,
);
export const requestTaskFileAccessRef = clientRef(
  api.platform.taskFiles.requestTaskFileAccess,
);

export type TaskAttachmentPage = Extract<
  RefValue<typeof listTaskFilesRef>,
  { readonly ok: true }
>;

/* -------------------------------------------------------------------------- */
/* Step-up                                                                     */
/* -------------------------------------------------------------------------- */

export const approveOnDeviceRef = clientRef(
  api.platform.stepUp.approveOnDevice,
);

export type StepUpApprovalResult = RefValue<typeof approveOnDeviceRef>;
export type StepUpApprovalOutcome = Extract<
  StepUpApprovalResult,
  { readonly written: true }
>;

/** @deprecated Use the generated references above. */
export const PLATFORM_FUNCTION_PATHS = Object.freeze({
  listDevices: getFunctionName(listDevicesRef),
  registerDevice: getFunctionName(registerDeviceRef),
  renameDevice: getFunctionName(renameDeviceRef),
  bindDeviceInstallation: getFunctionName(bindDeviceInstallationRef),
  retireDevice: getFunctionName(retireDeviceRef),
  recordDeviceSeen: getFunctionName(recordDeviceSeenRef),
  listOperatorTasks: getFunctionName(listOperatorTasksRef),
  listOperatorTaskEvidence: getFunctionName(listOperatorTaskEvidenceRef),
  createOperatorTask: getFunctionName(api.platform.tasks.createOperatorTask),
  claimOperatorTask: getFunctionName(claimOperatorTaskRef),
  heartbeatOperatorTask: getFunctionName(heartbeatOperatorTaskRef),
  releaseOperatorTask: getFunctionName(releaseOperatorTaskRef),
  reassignOperatorTask: getFunctionName(reassignOperatorTaskRef),
  completeOperatorTask: getFunctionName(completeOperatorTaskRef),
  recordTaskEvidence: getFunctionName(recordTaskEvidenceRef),
  listTaskExceptions: getFunctionName(listTaskExceptionsRef),
  reportTaskException: getFunctionName(reportTaskExceptionRef),
  resolveTaskException: getFunctionName(resolveTaskExceptionRef),
  listTaskFiles: getFunctionName(listTaskFilesRef),
  authorizeTaskFileUpload: getFunctionName(authorizeTaskFileUploadRef),
  attachTaskFile: getFunctionName(attachTaskFileRef),
  requestTaskFileAccess: getFunctionName(requestTaskFileAccessRef),
  approveOnDevice: getFunctionName(approveOnDeviceRef),
});
