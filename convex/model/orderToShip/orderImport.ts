import { fail, ok, type Result } from "../result";
import {
  makeDesignSpecification,
  normalizeCustomerProductCode,
  type DesignSpecification,
  type DesignSpecificationInput,
} from "./designSpecification";
import { checkOrderedQuantity } from "./customerOrder";

export const MAX_ORDER_IMPORT_CHUNK = 100;

export interface LegacyOrderImportRow {
  readonly sourceRow: number;
  readonly orderNumber: string;
  readonly customerCode: string;
  readonly customerProductCode: string;
  readonly lineNumber: number;
  readonly orderedQuantity: number;
  readonly specification: DesignSpecificationInput;
}

export interface ReadyOrderImportRow extends Omit<
  LegacyOrderImportRow,
  "customerProductCode" | "specification"
> {
  readonly customerProductCode: string;
  readonly specification: DesignSpecification;
}

export type OrderImportError = {
  readonly code: "CHUNK_TOO_LARGE" | "ROW_INVALID";
  readonly sourceRow?: number;
  readonly field?: string;
  readonly reason?: string;
};

export function previewOrderImport(
  rows: readonly LegacyOrderImportRow[],
): Result<readonly ReadyOrderImportRow[], OrderImportError> {
  if (rows.length > MAX_ORDER_IMPORT_CHUNK) {
    return fail({ code: "CHUNK_TOO_LARGE" });
  }
  const ready: ReadyOrderImportRow[] = [];
  for (const row of rows) {
    if (!Number.isInteger(row.sourceRow) || row.sourceRow < 1) {
      return fail({ code: "ROW_INVALID", field: "sourceRow" });
    }
    if (!Number.isInteger(row.lineNumber) || row.lineNumber < 1) {
      return fail({
        code: "ROW_INVALID",
        sourceRow: row.sourceRow,
        field: "lineNumber",
      });
    }
    const productCode = normalizeCustomerProductCode(row.customerProductCode);
    if (!productCode.ok) {
      return fail({
        code: "ROW_INVALID",
        sourceRow: row.sourceRow,
        field: productCode.error.field,
        reason: productCode.error.reason,
      });
    }
    const quantity = checkOrderedQuantity(row.orderedQuantity);
    if (!quantity.ok) {
      return fail({
        code: "ROW_INVALID",
        sourceRow: row.sourceRow,
        field: quantity.error.field,
        reason: quantity.error.reason,
      });
    }
    const specification = makeDesignSpecification(row.specification);
    if (!specification.ok) {
      return fail({
        code: "ROW_INVALID",
        sourceRow: row.sourceRow,
        field: specification.error.field,
        reason: specification.error.reason,
      });
    }
    ready.push(
      Object.freeze({
        ...row,
        customerProductCode: productCode.value,
        orderedQuantity: quantity.value,
        specification: specification.value,
      }),
    );
  }
  return ok(Object.freeze(ready));
}

/** Resume cursor is the next source row; callers persist it after each commit. */
export const nextOrderImportCursor = (
  accepted: readonly ReadyOrderImportRow[],
): number | null =>
  accepted.length === 0
    ? null
    : Math.max(...accepted.map((row) => row.sourceRow)) + 1;
