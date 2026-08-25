import {
  makeDesignSpecification,
  missingReleaseFields,
  normalizeCustomerProductCode,
  type DesignSpecification,
  type DesignSpecificationInput,
} from "./designSpecification";
import { MAX_FILES_PER_REVISION } from "./masterCardFile";

export const MAX_MASTER_CARD_IMPORT_CHUNK = 25;

export interface LegacyMasterCardFile {
  readonly fileKey: string;
  readonly fileName: string;
  readonly kind: "DIELINE" | "ARTWORK" | "PHOTO" | "OTHER";
  readonly contentType: string;
  readonly byteSize: number;
  readonly contentDigest: string;
  readonly storageId: string;
  readonly uploadGrantId: string;
}

export interface LegacyMasterCardRow {
  readonly sourceRow: number;
  readonly sourceReference: string;
  readonly cardNumber: string;
  readonly customerId: string;
  readonly customerProductCode: string;
  readonly name: string;
  readonly verified: boolean;

  readonly legacyApproval?: LegacyApprovalEvidence;
  readonly specification: DesignSpecificationInput;
  readonly files: readonly LegacyMasterCardFile[];
}

export interface LegacyApprovalEvidence {
  readonly authoredByUserId: string;
  readonly submittedByUserId?: string;
  readonly decidedByUserId: string;
  readonly decidedAt: number;
  readonly decisionNote: string;
}

export interface ReadyLegacyMasterCardRow extends Omit<
  LegacyMasterCardRow,
  "customerProductCode" | "specification"
> {
  readonly customerProductCode: string;
  readonly specification: DesignSpecification;
  readonly revisionStatus: "DRAFT" | "RELEASED";
  readonly needsReviewReasons: readonly string[];
}

export interface MasterCardImportProblem {
  readonly sourceRow?: number;
  readonly field?: string;
  readonly code: string;
  readonly reason?: string;
}

export interface MasterCardImportPreview {
  readonly accepted: readonly ReadyLegacyMasterCardRow[];
  readonly problems: readonly MasterCardImportProblem[];
  readonly nextSourceRow: number | null;
}

export function previewMasterCardImport(
  rows: readonly LegacyMasterCardRow[],
): MasterCardImportPreview {
  if (rows.length > MAX_MASTER_CARD_IMPORT_CHUNK) {
    return {
      accepted: [],
      problems: [{ code: "CHUNK_TOO_LARGE" }],
      nextSourceRow: null,
    };
  }

  const accepted: ReadyLegacyMasterCardRow[] = [];
  const problems: MasterCardImportProblem[] = [];
  const seenRows = new Set<number>();
  const seenCards = new Set<string>();
  const seenProducts = new Set<string>();
  for (const row of rows) {
    if (!Number.isInteger(row.sourceRow) || row.sourceRow < 1) {
      problems.push({
        code: "ROW_INVALID",
        sourceRow: row.sourceRow,
        field: "sourceRow",
      });
      continue;
    }
    if (seenRows.has(row.sourceRow)) {
      problems.push({
        code: "DUPLICATE_IN_CHUNK",
        sourceRow: row.sourceRow,
        field: "sourceRow",
      });
      continue;
    }
    seenRows.add(row.sourceRow);
    const productCode = normalizeCustomerProductCode(row.customerProductCode);
    if (!productCode.ok) {
      problems.push({
        code: productCode.error.code,
        sourceRow: row.sourceRow,
        field: productCode.error.field,
        reason: productCode.error.reason,
      });
      continue;
    }
    const cardKey = row.cardNumber.trim().toUpperCase();
    const productKey = `${row.customerId}|${productCode.value}`;
    if (seenCards.has(cardKey) || seenProducts.has(productKey)) {
      problems.push({
        code: "DUPLICATE_IN_CHUNK",
        sourceRow: row.sourceRow,
        field: seenCards.has(cardKey) ? "cardNumber" : "customerProductCode",
      });
      continue;
    }
    seenCards.add(cardKey);
    seenProducts.add(productKey);
    if (row.sourceReference.trim().length === 0) {
      problems.push({
        code: "FIELD_INVALID",
        sourceRow: row.sourceRow,
        field: "sourceReference",
        reason: "EMPTY",
      });
      continue;
    }
    if (row.files.length > MAX_FILES_PER_REVISION) {
      problems.push({
        code: "FIELD_INVALID",
        sourceRow: row.sourceRow,
        field: "files",
        reason: "TOO_MANY_ROWS",
      });
      continue;
    }
    const specification = makeDesignSpecification(row.specification);
    if (!specification.ok) {
      problems.push({
        code: specification.error.code,
        sourceRow: row.sourceRow,
        field: specification.error.field,
        reason: specification.error.reason,
      });
      continue;
    }
    const approval = row.legacyApproval;
    const approvalReady =
      approval !== undefined &&
      approval.authoredByUserId.trim().length > 0 &&
      approval.decidedByUserId.trim().length > 0 &&
      approval.decisionNote.trim().length > 0 &&
      approval.decisionNote.trim().length <= 2_000 &&
      Number.isFinite(approval.decidedAt) &&
      approval.decidedAt > 0 &&
      approval.decidedByUserId !== approval.authoredByUserId &&
      approval.decidedByUserId !== approval.submittedByUserId;
    const needsReviewReasons = [
      ...missingReleaseFields(specification.value),
      ...(row.files.length === 0 ? ["files"] : []),
      ...(!row.verified ? ["legacyVerification"] : []),
      ...(row.verified && !approvalReady ? ["legacyApproval"] : []),
    ];
    accepted.push({
      ...row,
      sourceReference: row.sourceReference.trim(),
      customerProductCode: productCode.value,
      specification: specification.value,
      revisionStatus:
        row.verified && needsReviewReasons.length === 0 ? "RELEASED" : "DRAFT",
      needsReviewReasons: Object.freeze(needsReviewReasons),
    });
  }

  if (problems.length === 0) {
    for (let index = 1; index < accepted.length; index += 1) {
      if (accepted[index]!.sourceRow !== accepted[index - 1]!.sourceRow + 1) {
        problems.push({
          code: "NON_CONTIGUOUS_CHUNK",
          sourceRow: accepted[index]!.sourceRow,
          field: "sourceRow",
        });
        break;
      }
    }
  }

  return Object.freeze({
    accepted: Object.freeze(accepted),
    problems: Object.freeze(problems),
    nextSourceRow:
      accepted.length === 0
        ? null
        : accepted[accepted.length - 1]!.sourceRow + 1,
  });
}
