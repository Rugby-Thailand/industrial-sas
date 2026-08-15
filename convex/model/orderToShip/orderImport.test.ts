import { describe, expect, it } from "vitest";

import {
  MAX_ORDER_IMPORT_CHUNK,
  nextOrderImportCursor,
  previewOrderImport,
  type LegacyOrderImportRow,
} from "./orderImport";

const row = (sourceRow = 1): LegacyOrderImportRow => ({
  sourceRow,
  orderNumber: "SO-LEGACY-1",
  customerCode: "GOLD",
  customerProductCode: " fg 001 ",
  lineNumber: sourceRow,
  orderedQuantity: 100,
  specification: {
    styleCode: "RSC",
    internalLengthMm: 300,
    internalWidthMm: 200,
    internalHeightMm: 150,
    boardGrade: "KA125/C/KA125",
    printColourCount: 2,
  },
});

describe("legacy customer-order import", () => {
  it("previews normalization without committing and returns a resume cursor", () => {
    const preview = previewOrderImport([row(20), row(21)]);
    expect(preview.ok).toBe(true);
    expect(
      preview.ok && preview.value.map((item) => item.customerProductCode),
    ).toEqual(["FG 001", "FG 001"]);
    expect(preview.ok && nextOrderImportCursor(preview.value)).toBe(22);
  });

  it("names the source row and field that blocks import", () => {
    expect(
      previewOrderImport([{ ...row(7), customerProductCode: " " }]),
    ).toStrictEqual({
      ok: false,
      error: {
        code: "ROW_INVALID",
        sourceRow: 7,
        field: "customerProductCode",
        reason: "EMPTY",
      },
    });
  });

  it("bounds each resumable chunk", () => {
    expect(
      previewOrderImport(
        Array.from({ length: MAX_ORDER_IMPORT_CHUNK + 1 }, (_, index) =>
          row(index + 1),
        ),
      ),
    ).toStrictEqual({ ok: false, error: { code: "CHUNK_TOO_LARGE" } });
  });
});
