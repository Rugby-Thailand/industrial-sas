/**
 * Attendance CSV v1 — the documented initial export contract.
 *
 * Status: implemented. UTF-8 with a byte-order mark so spreadsheet software
 * reads Thai text, RFC 4180 quoting with CRLF records, and spreadsheet-formula
 * neutralisation for user-supplied text. This is not a payroll provider
 * format; mapping to the company's payroll import is a launch decision.
 */
import { isoInstant } from "./calendar";

export const CSV_V1_COLUMNS = Object.freeze([
  "period_id",
  "period_version",
  "site_code",
  "employee_code",
  "employee_name",
  "business_date",
  "timezone",
  "planned_start",
  "planned_end",
  "actual_start",
  "actual_end",
  "worked_minutes",
  "outside_shift_minutes",
  "disposition",
  "correction_reason",
] as const);

export interface CsvRow {
  readonly employeeCode: string;
  readonly employeeName: string;
  readonly businessDate: string;
  readonly plannedStartAt?: number | undefined;
  readonly plannedEndAt?: number | undefined;
  readonly actualStartAt?: number | undefined;
  readonly actualEndAt?: number | undefined;
  readonly workedMinutes: number;
  readonly outsideShiftMinutes: number;
  readonly disposition: string;
  readonly correctionReason?: string | undefined;
}

export interface CsvVersion {
  readonly periodId: string;
  readonly version: number;
  readonly siteCode: string;
  readonly timezone: string;
  readonly startDate: string;
  readonly endDate: string;
}

const FORMULA_PREFIX = /^[=+\-@\t\r\n\uFF1D\uFF0B\uFF0D\uFF20]/;

/** Neutralise a user-supplied value a spreadsheet would evaluate as a formula. */
export function formulaSafe(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function csvField(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim()
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

const instant = (value: number | undefined) =>
  value === undefined ? "" : isoInstant(value);

const text = (value: string | undefined) => csvField(formulaSafe(value ?? ""));

export function renderAttendanceCsv(
  version: CsvVersion,
  rows: readonly CsvRow[],
): string {
  const lines = [CSV_V1_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvField(version.periodId),
        String(version.version),
        text(version.siteCode),
        text(row.employeeCode),
        text(row.employeeName),
        row.businessDate,
        csvField(version.timezone),
        instant(row.plannedStartAt),
        instant(row.plannedEndAt),
        instant(row.actualStartAt),
        instant(row.actualEndAt),
        String(row.workedMinutes),
        String(row.outsideShiftMinutes),
        row.disposition,
        text(row.correctionReason),
      ].join(","),
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function attendanceCsvFileName(version: CsvVersion): string {
  const site = version.siteCode.replace(/[^A-Za-z0-9_-]/g, "_") || "site";
  return `attendance_${site}_${version.startDate}_${version.endDate}_v${version.version}.csv`;
}
