import { isIsoDate } from "./calendar";
/** Strict imported-source validation; no payroll calculations or inference. */
export const MAX_PDF_BYTES = 384 * 1024;
export const MAX_IMPORT_ROWS = 20;
export const PAYSLIP_CSV_HEADER =
  "employee_code,period_from,period_to,payment_date,gross,deductions,net";
export type SourceRow = {
  code: string;
  from: string;
  to: string;
  paymentDate: string;
  gross: number;
  deductions: number;
  net: number;
};

export function satang(text: string): number | null {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(value) ? value : null;
}

/** Deliberately narrow canonical CSV contract: quoted names are not columns. */
export function parsePayslipCsv(csv: string): {
  rows: SourceRow[];
  errors: string[];
} {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  const errors: string[] = [];
  if (lines[0] !== PAYSLIP_CSV_HEADER)
    return { rows: [], errors: ["CSV_HEADER_INVALID"] };
  if (lines.length < 2 || lines.length > MAX_IMPORT_ROWS + 1)
    return { rows: [], errors: ["CSV_ROW_LIMIT"] };
  const rows: SourceRow[] = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.slice(1).entries()) {
    const [
      code,
      from,
      to,
      paymentDate,
      grossText,
      deductionsText,
      netText,
      ...extra
    ] = line.split(",");
    if (
      !code ||
      code.length > 80 ||
      !isIsoDate(from) ||
      !isIsoDate(to) ||
      from > to ||
      !isIsoDate(paymentDate) ||
      extra.length ||
      grossText === undefined ||
      deductionsText === undefined ||
      netText === undefined
    ) {
      errors.push(`ROW_INVALID:${index + 2}`);
      continue;
    }
    const gross = satang(grossText),
      deductions = satang(deductionsText),
      net = satang(netText);
    if (
      gross === null ||
      deductions === null ||
      net === null ||
      gross - deductions !== net
    ) {
      errors.push(`AMOUNT_INVALID:${index + 2}`);
      continue;
    }
    if (seen.has(code)) {
      errors.push(`EMPLOYEE_DUPLICATE:${index + 2}`);
      continue;
    }
    seen.add(code);
    rows.push({ code, from, to, paymentDate, gross, deductions, net });
  }
  return { rows, errors };
}

export type PayslipExclusion = { rowNumber: number; reason: string };
/** Explicit exclusion never repairs bad data or silently skips a row. The
 * original source stays retained; only the documented included set is parsed. */
export function selectPayslipSource(
  csv: string,
  exclusions: readonly PayslipExclusion[] = [],
) {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  if (lines[0] !== PAYSLIP_CSV_HEADER)
    return { rows: [], errors: ["CSV_HEADER_INVALID"], exclusions: [] };
  if (lines.length < 2 || lines.length > MAX_IMPORT_ROWS + 1)
    return { rows: [], errors: ["CSV_ROW_LIMIT"], exclusions: [] };
  if (
    exclusions.length > MAX_IMPORT_ROWS ||
    new Set(exclusions.map((row) => row.rowNumber)).size !==
      exclusions.length ||
    exclusions.some(
      (row) =>
        !Number.isSafeInteger(row.rowNumber) ||
        row.rowNumber < 2 ||
        row.rowNumber > lines.length ||
        row.reason.trim().length < 3 ||
        row.reason.trim().length > 500,
    )
  )
    return { rows: [], errors: ["CSV_EXCLUSIONS_INVALID"], exclusions: [] };
  const excluded = new Set(exclusions.map((row) => row.rowNumber));
  const included = lines
    .slice(1)
    .map((line, index) => ({ line, rowNumber: index + 2 }))
    .filter((row) => !excluded.has(row.rowNumber));
  const parsed = parsePayslipCsv(
    [PAYSLIP_CSV_HEADER, ...included.map((row) => row.line)].join("\n"),
  );
  return {
    rows: parsed.rows,
    errors: parsed.errors.map((error) => {
      const [code, number] = error.split(":");
      return number === undefined
        ? error
        : `${code}:${included[Number(number) - 2]?.rowNumber ?? number}`;
    }),
    exclusions: exclusions.map((row) => ({
      rowNumber: row.rowNumber,
      employeeCode: (lines[row.rowNumber - 1]?.split(",")[0] ?? "").slice(
        0,
        80,
      ),
      reason: row.reason.trim(),
    })),
  };
}
export function inspectPayslipSource(csv: string) {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  if (
    lines[0] !== PAYSLIP_CSV_HEADER ||
    lines.length < 2 ||
    lines.length > MAX_IMPORT_ROWS + 1
  )
    return [];
  return lines.slice(1).map((line, index) => ({
    rowNumber: index + 2,
    employeeCode: (line.split(",")[0] ?? "").slice(0, 80),
    valid:
      parsePayslipCsv(`${PAYSLIP_CSV_HEADER}\n${line}`).errors.length === 0,
  }));
}

export function pdfBytes(base64: string): Uint8Array | null {
  if (
    !base64 ||
    base64.length > Math.ceil(MAX_PDF_BYTES / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    )
  )
    return null;
  try {
    const binary = atob(base64);
    if (!binary.startsWith("%PDF-") || binary.length > MAX_PDF_BYTES)
      return null;
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function pdfHash(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", owned);
  return [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

/** Only verified provider JWT claims enter this function; never request args. */
export function freshUntil(
  identity: Record<string, unknown>,
  minutes: number,
  now: number,
): number | null {
  const age = identity.fva;
  const issued = identity.iat;
  if (
    !Array.isArray(age) ||
    age.length !== 2 ||
    !Number.isInteger(age[0]) ||
    age[0] < 0 ||
    !Number.isInteger(age[1]) ||
    age[1] < -1 ||
    !Number.isInteger(minutes) ||
    minutes < 2 ||
    minutes > 15 ||
    typeof issued !== "number" ||
    !Number.isSafeInteger(issued) ||
    issued * 1000 > now + 5000 ||
    typeof identity.sid !== "string" ||
    !identity.sid
  )
    return null;
  // fva is quantized in minutes. Use the oldest possible verification time,
  // and account for time since token issuance, rather than refreshing on reads.
  const expiry = (issued - (age[0] + 1) * 60) * 1000 + minutes * 60_000;
  return expiry > now ? expiry : null;
}
