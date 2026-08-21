/**
 * Synthetic shared-operator data, in the server's own wire shapes.
 *
 * The same contract as the other preview modules: not a fake backend, no
 * writes, every identifier prefixed `prv_`, and a banner on every screen it
 * reaches. It exists so the work board, the lease states, and the device
 * registry can be judged for Thai wrapping and legibility before an identity
 * provider exists.
 *
 * The rows deliberately cover the states that are easy to get wrong and
 * impossible to reach by hand: a task held by *this* operator with minutes
 * left, one held by somebody else, one whose lease lapsed with partial evidence
 * already on it, and one nobody has taken. A fixture where every task were
 * unclaimed would look correct and prove nothing about whether "lease lapsed —
 * free to take, 12 scans already done" is readable at arm's length.
 */
import type {
  DeviceRow,
  OperatorTaskRow,
  TaskEvidenceRow,
  TaskExceptionRow,
  TaskAttachmentRow,
} from "../convex/platformApi";

/** The operator the preview is rendered as, so "held by you" has a subject. */
export const PREVIEW_OPERATOR_USER_ID = "prv_user_operator";

const PREVIEW_OTHER_USER_ID = "prv_user_somchai";

/** A fixed instant, so a preview screenshot does not change between runs. */
const PREVIEW_NOW = 1_754_900_000_000;

export const previewOperatorTasksFor = (
  warehouseId: string,
): readonly OperatorTaskRow[] =>
  Object.freeze([
    Object.freeze({
      operatorTaskId: "prv_task_1",
      warehouseId,
      taskNumber: "WT-2601-001",
      kind: "SUPERVISOR_ASSIGNED" as const,
      instruction: "นับกล่องลูกฟูกที่ชั้น A1 ทั้งแถว",
      status: "CLAIMED" as const,
      itemId: "prv_item_carton_a",
      baseUom: "EA",
      expectedBaseMinorUnits: 120_000,
      evidenceCount: 4,
      lease: Object.freeze({
        kind: "HELD" as const,
        holderUserId: PREVIEW_OPERATOR_USER_ID,
        expiresAt: PREVIEW_NOW + 240_000,
        remainingMs: 240_000,
      }),
    }),
    Object.freeze({
      operatorTaskId: "prv_task_2",
      warehouseId,
      taskNumber: "WT-2601-002",
      kind: "SUPERVISOR_ASSIGNED" as const,
      instruction: "ตรวจนับพาเลทที่ท่ารับสินค้า",
      status: "CLAIMED" as const,
      itemId: "prv_item_steel_coil",
      baseUom: "KG",
      expectedBaseMinorUnits: 500_000,
      evidenceCount: 12,
      /* The case the board exists for: a lapsed lease with work already on it. */
      lease: Object.freeze({
        kind: "EXPIRED" as const,
        holderUserId: PREVIEW_OTHER_USER_ID,
        expiredAt: PREVIEW_NOW - 60_000,
      }),
    }),
    Object.freeze({
      operatorTaskId: "prv_task_3",
      warehouseId,
      taskNumber: "WT-2601-003",
      kind: "SUPERVISOR_ASSIGNED" as const,
      instruction: "ย้ายกล่องเสียหายไปโซนกักกัน",
      status: "AVAILABLE" as const,
      evidenceCount: 0,
      lease: Object.freeze({ kind: "UNCLAIMED" as const }),
    }),
    Object.freeze({
      operatorTaskId: "prv_task_4",
      warehouseId,
      taskNumber: "WT-2601-004",
      kind: "SUPERVISOR_ASSIGNED" as const,
      instruction: "นับสต๊อกกระดาษคราฟท์ชั้น B2",
      status: "CLAIMED" as const,
      itemId: "prv_item_bolt_m8",
      baseUom: "EA",
      evidenceCount: 2,
      lease: Object.freeze({
        kind: "HELD" as const,
        holderUserId: PREVIEW_OTHER_USER_ID,
        expiresAt: PREVIEW_NOW + 90_000,
        remainingMs: 90_000,
      }),
    }),
  ]);

/** A retained evidence stream for the selected preview task. */
export const previewTaskEvidenceFor = (
  operatorTaskId: string,
): readonly TaskEvidenceRow[] =>
  Object.freeze([
    Object.freeze({
      evidenceId: `prv_evidence_${operatorTaskId}_1`,
      operatorTaskId,
      sequence: 1,
      kind: "SCAN" as const,
      capturedByUserId: PREVIEW_OPERATOR_USER_ID,
      capturedAt: PREVIEW_NOW - 12 * 60_000,
      scanValue: "CTN-A4",
      resolvedItemId: "prv_item_carton_a",
      resolvedSku: "CTN-A4",
      scanVia: "SKU" as const,
      scanInputMethod: "HID" as const,
      supervisorApproved: false,
    }),
    Object.freeze({
      evidenceId: `prv_evidence_${operatorTaskId}_2`,
      operatorTaskId,
      sequence: 2,
      kind: "QUANTITY" as const,
      capturedByUserId: PREVIEW_OPERATOR_USER_ID,
      capturedAt: PREVIEW_NOW - 8 * 60_000,
      enteredQuantity: Object.freeze({ uom: "EA", minorUnits: 24_000 }),
      baseMinorUnits: 24_000,
      plausibility: "PLAUSIBLE" as const,
      supervisorApproved: false,
    }),
  ]);

/** Open and resolved examples for the shared exception sheet. */
export const previewTaskExceptionsFor = (
  operatorTaskId: string,
): readonly TaskExceptionRow[] =>
  Object.freeze([
    Object.freeze({
      operatorTaskExceptionId: `prv_exception_${operatorTaskId}_1`,
      operatorTaskId,
      warehouseId: "prv_wh_bangpoo",
      reasonCodeId: "prv_reason_damage",
      reasonCode: "DAMAGE",
      reasonName: "เสียหายระหว่างขนย้าย",
      summary: "ฉลากสินค้าฉีกและอ่านบาร์โค้ดไม่ได้",
      evidence: "ลองสแกนด้วยเครื่องอ่านสองครั้งและตรวจหมายเลขบนกล่องแล้ว",
      proposedDisposition: "ESCALATE" as const,
      proposedRecoveryAction: "ให้หัวหน้าตรวจ SKU และอนุมัติพิมพ์ฉลากใหม่",
      status: "OPEN" as const,
      reportedByUserId: PREVIEW_OPERATOR_USER_ID,
      reportedAt: PREVIEW_NOW - 6 * 60_000,
    }),
    Object.freeze({
      operatorTaskExceptionId: `prv_exception_${operatorTaskId}_2`,
      operatorTaskId,
      warehouseId: "prv_wh_bangpoo",
      reasonCodeId: "prv_reason_cycle_count",
      reasonCode: "CYCLE-COUNT",
      reasonName: "ปรับปรุงจากการนับสต็อก",
      summary: "จำนวนบนฉลากไม่ตรงกับจำนวนจริง",
      evidence: "นับซ้ำโดยพนักงานสองคน ได้ 24 ชิ้น",
      proposedDisposition: "STOP" as const,
      proposedRecoveryAction: "หยุดงานและตรวจเอกสารต้นทาง",
      status: "RESOLVED" as const,
      reportedByUserId: PREVIEW_OPERATOR_USER_ID,
      reportedAt: PREVIEW_NOW - 45 * 60_000,
      finalDisposition: "RESUME" as const,
      recoveryAction: "แก้จำนวนบนใบงานแล้ว ดำเนินงานต่อได้",
      approverNote: "ตรวจนับและแก้เอกสารต้นทางแล้ว",
      resolvedByUserId: PREVIEW_OTHER_USER_ID,
      resolvedAt: PREVIEW_NOW - 30 * 60_000,
    }),
  ]);

/** Private-file metadata only. No preview route claims the bytes exist. */
export const previewTaskAttachmentsFor = (
  operatorTaskId: string,
): readonly TaskAttachmentRow[] =>
  Object.freeze([
    Object.freeze({
      operatorTaskAttachmentId: `prv_attachment_${operatorTaskId}_1`,
      operatorTaskId,
      warehouseId: "prv_wh_bangpoo",
      fileName: "ฉลากชำรุด.jpg",
      kind: "PHOTO" as const,
      contentType: "image/jpeg",
      byteSize: 284_220,
      contentDigest: "0".repeat(64),
      note: "ภาพก่อนแยกสินค้าเข้าพื้นที่กักกัน",
      verifiedAt: PREVIEW_NOW - 7 * 60_000,
      attachedByUserId: PREVIEW_OPERATOR_USER_ID,
      attachedAt: PREVIEW_NOW - 7 * 60_000,
    }),
  ]);

/**
 * The registry, including one retired device.
 *
 * Retired rows are in the fixture on purpose: retirement is the state most
 * likely to be rendered as an absence, and an administrator has to be able to
 * see that a scanner left service rather than infer it from a shorter list.
 */
export const previewDevicesFor = (_warehouseId: string): readonly DeviceRow[] =>
  Object.freeze([
    Object.freeze({
      deviceId: "prv_device_1",
      label: "ท่ารับสินค้า 1 — เครื่องอ่านบาร์โค้ด",
      deviceType: "HANDHELD" as const,
      status: "ACTIVE" as const,
      installationBound: true,
      lastSeenAt: PREVIEW_NOW - 30_000,
    }),
    Object.freeze({
      deviceId: "prv_device_2",
      label: "โต๊ะทำงานคลัง A",
      deviceType: "WORKSTATION" as const,
      status: "ACTIVE" as const,
      installationBound: false,
    }),
    Object.freeze({
      deviceId: "prv_device_3",
      label: "เครื่องอ่านสำรอง (เลิกใช้)",
      deviceType: "HANDHELD" as const,
      status: "RETIRED" as const,
      installationBound: false,
      lastSeenAt: PREVIEW_NOW - 90 * 24 * 60 * 60 * 1000,
      retiredAt: PREVIEW_NOW - 60 * 24 * 60 * 60 * 1000,
    }),
  ]);
