import {
  MAX_IMPORT_ROWS,
  MAX_PDF_BYTES,
  selectPayslipSource,
  pdfBytes,
  pdfHash,
  type SourceRow,
  type PayslipExclusion,
} from "../../../convex/model/hr/payslip";
import { PayslipAccessError } from "./payslipClient";

export interface PreparedPayslipImport {
  readonly csv: string;
  readonly sourceHash: string;
  readonly rows: readonly SourceRow[];
  readonly exclusions: readonly {
    rowNumber: number;
    employeeCode: string;
    reason: string;
  }[];
  readonly documents: readonly {
    employeeCode: string;
    base64: string;
    expectedHash: string;
  }[];
}
/** Preserve original PDF bytes and bind each file to an exact employee code. */
export async function preparePayslipImport(
  csvFile: File,
  files: readonly File[],
  from: string,
  to: string,
  exclusions: readonly PayslipExclusion[] = [],
): Promise<PreparedPayslipImport> {
  if (csvFile.size > 100_000)
    throw new PayslipAccessError("PAYSLIP_SOURCE_INVALID");
  const csv = await csvFile.text();
  const parsed = selectPayslipSource(csv, exclusions);
  if (parsed.exclusions.length && parsed.errors.includes("CSV_ROW_LIMIT"))
    throw new PayslipAccessError("CSV_EXCLUSIONS_INVALID");
  if (parsed.errors.length)
    throw new PayslipAccessError(
      parsed.errors.includes("CSV_HEADER_INVALID")
        ? "CSV_HEADER_INVALID"
        : parsed.errors.includes("CSV_ROW_LIMIT")
          ? "CSV_ROW_LIMIT"
          : parsed.errors.includes("CSV_EXCLUSIONS_INVALID")
            ? "CSV_EXCLUSIONS_INVALID"
            : "PAYSLIP_CSV_INVALID",
    );
  if (parsed.rows.some((row) => row.from !== from || row.to !== to))
    throw new PayslipAccessError("PAYSLIP_PERIOD_MISMATCH");
  if (
    files.length > MAX_IMPORT_ROWS ||
    new Set(files.map((file) => file.name)).size !== files.length ||
    files.some(
      (file) =>
        ![
          ...parsed.rows.map((row) => row.code),
          ...parsed.exclusions.map((row) => row.employeeCode),
        ].some((code) => file.name === `${code}.pdf`),
    )
  )
    throw new PayslipAccessError("PAYSLIP_DOCUMENT_MAPPING_INVALID");
  const documents = [];
  let encodedSize = 0;
  for (const row of parsed.rows) {
    const file = files.find((file) => file.name === `${row.code}.pdf`);
    if (!file || file.size > MAX_PDF_BYTES)
      throw new PayslipAccessError("PAYSLIP_DOCUMENT_MAPPING_INVALID");
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const part of bytes) binary += String.fromCharCode(part);
    const base64 = btoa(binary);
    if (!pdfBytes(base64)) throw new PayslipAccessError("PAYSLIP_PDF_INVALID");
    encodedSize += base64.length;
    if (encodedSize > 4 * 1024 * 1024)
      throw new PayslipAccessError("PAYSLIP_SOURCE_INVALID");
    documents.push({
      employeeCode: row.code,
      base64,
      expectedHash: await pdfHash(bytes),
    });
  }
  return {
    csv,
    sourceHash: await pdfHash(new TextEncoder().encode(csv)),
    rows: parsed.rows,
    exclusions: parsed.exclusions,
    documents,
  };
}
