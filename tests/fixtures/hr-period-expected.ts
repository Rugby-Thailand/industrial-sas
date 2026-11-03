/** Independent worked examples for October 2026, Asia/Bangkok.
 * No production calendar, attendance, totals or CSV helpers are used here.
 * There are 22 weekdays; the holiday on the 13th leaves 21 worked dates.
 */
export const OCTOBER_WORK_DAYS = new Set([
  1, 2, 5, 6, 7, 8, 9, 12, 14, 15, 16, 19, 20, 21, 22, 23, 26, 27, 28, 29, 30,
]);
export const CORRECTION_REASON = 'แก้เวลา "อนุมัติ",\r\nตรวจแล้ว';
export const CSV_CORRECTION_REASON = '"แก้เวลา ""อนุมัติ"",\r\nตรวจแล้ว"';
export const CSV_HEADER =
  "period_id,period_version,site_code,employee_code,employee_name,business_date,timezone,planned_start,planned_end,actual_start,actual_end,worked_minutes,outside_shift_minutes,disposition,correction_reason";

// 08:30–17:30 minus a 60-minute break = 480; 08:15–17:45 = 510
// with 30 outside-shift minutes. 22:00–06:00 minus 30 = 450.
// Corrected 09:00–17:30 minus 60 = 450, overriding the original pair.
export const PROFILES = [
  {
    name: 'สมชาย "ใจดี", Jr.',
    csvName: '"สมชาย ""ใจดี"", Jr."',
    worked: 480,
    outside: 0,
    disposition: "WORKED",
  },
  {
    name: "=Formula",
    csvName: "'=Formula",
    worked: 510,
    outside: 30,
    disposition: "WORKED",
  },
  {
    name: "Night shift",
    csvName: "Night shift",
    worked: 450,
    outside: 0,
    disposition: "WORKED",
  },
  {
    name: "Corrected",
    csvName: "Corrected",
    worked: 450,
    outside: 0,
    disposition: "WORKED",
  },
  {
    name: "Absent",
    csvName: "Absent",
    worked: 0,
    outside: 0,
    disposition: "ABSENT",
  },
  {
    name: "Leave",
    csvName: "Leave",
    worked: 0,
    outside: 0,
    disposition: "LEAVE",
  },
] as const;

export const MONTH_TOTALS_120 = {
  employees: 120,
  days: 3720,
  workedMinutes: 793800,
  outsideShiftMinutes: 12600,
  absentDays: 420,
  leaveDays: 420,
  nonworkingDays: 1200,
};

export const dateOf = (day: number) =>
  `2026-10-${String(day).padStart(2, "0")}`;
export const instant = (day: number, time: string) =>
  Date.parse(`${dateOf(day)}T${time}:00+07:00`);

export function expectedDay(profile: number, day: number) {
  const p = PROFILES[profile]!;
  const working = OCTOBER_WORK_DAYS.has(day);
  const night = profile === 2;
  const plannedStart = working
    ? instant(day, night ? "22:00" : "08:30")
    : undefined;
  const plannedEnd = working
    ? night
      ? instant(day, "06:00") + 86400000
      : instant(day, "17:30")
    : undefined;
  const actualStart =
    !working || profile >= 4
      ? undefined
      : profile === 1
        ? instant(day, "08:15")
        : profile === 3
          ? instant(day, "09:00")
          : plannedStart;
  const actualEnd =
    !working || profile >= 4
      ? undefined
      : profile === 1
        ? instant(day, "17:45")
        : plannedEnd;
  return {
    businessDate: dateOf(day),
    plannedStart,
    plannedEnd,
    actualStartAt: actualStart,
    actualEndAt: actualEnd,
    workedMinutes: working ? p.worked : 0,
    outsideShiftMinutes: working ? p.outside : 0,
    disposition: working ? p.disposition : "NONWORKING",
    correctionReason: working && profile >= 3 ? CORRECTION_REASON : undefined,
  };
}

export function expectedCsv(periodId: string, employees: number) {
  const lines = [CSV_HEADER];
  const iso = (value: number | undefined) =>
    value === undefined
      ? ""
      : new Date(value).toISOString().replace(".000Z", "Z");
  for (let employee = 0; employee < employees; employee += 1) {
    const profile = employee % 6;
    for (let day = 1; day <= 31; day += 1) {
      const row = expectedDay(profile, day);
      lines.push(
        [
          periodId,
          "1",
          "ALPHA",
          `E${String(employee).padStart(4, "0")}`,
          PROFILES[profile]!.csvName,
          row.businessDate,
          "Asia/Bangkok",
          iso(row.plannedStart),
          iso(row.plannedEnd),
          iso(row.actualStartAt),
          iso(row.actualEndAt),
          String(row.workedMinutes),
          String(row.outsideShiftMinutes),
          row.disposition,
          row.correctionReason ? CSV_CORRECTION_REASON : "",
        ].join(","),
      );
    }
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
