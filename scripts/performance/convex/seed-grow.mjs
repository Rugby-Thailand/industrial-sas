#!/usr/bin/env node
// Grows a restored large-tenant fixture (dataset-L) about 5× in the dimensions
// that scale with history and site size, so profiles show whether reads follow
// what a screen displays or what the tenant has accumulated:
//
// - Job tickets: +8,800 scans through the real public saveJobScans mutation
//   (2,182 → ~11,000), one third mapped to storage zones.
// - HR: +612 employees with 45 business days of attendance each (153 → 765),
//   imported with schema validation, cloned from the seeded rows.
//
// Loopback deployments only. Run from the root of the worktree whose local
// backend should grow (main's schema, so the export restores into every target):
//   node <perf-worktree>/scripts/performance/convex/seed-grow.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliData, httpClient, identity, loadDeployment } from "./lib.mjs";

const deployment = loadDeployment();
const { fixture } = deployment;
const convex = (...args) =>
  execFileSync("pnpm", ["exec", "convex", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const clerk = {
  userId:
    process.env.LOCAL_TEST_CLERK_USER_ID ?? "user_3JXrAsAOLBWzV5TTHPQjOX5WaQd",
  orgId:
    process.env.LOCAL_TEST_CLERK_ORG_ID ?? "org_3JXrDUraQjTRO3hcIzMGC9CvIXV",
};
const JOB_SCAN_CALLS = 176; // × 50 items
const EMPLOYEES = 612;
const DAYS = 45;

// 1. Job scans through the real mutation (same shape as seed-scale.mjs).
const http = httpClient(deployment);
const zones = cliData("storageZones", 5000).filter(
  (zone) =>
    zone.warehouseId === fixture.warehouseId && zone.status === "ACTIVE",
);
const customers = [
  "บริษัท ฟาบริเนท จำกัด (สำนักงานใหญ่)",
  "Siam Packaging Co., Ltd.",
  "Thai Metal Works",
  "Eastern Seaboard Foods",
];
let created = 0;
for (let call = 0; call < JOB_SCAN_CALLS; call++) {
  const mapped = call % 3 === 0 ? zones[call % zones.length] : undefined;
  http.setAdminAuth(deployment.adminKey, identity(clerk));
  const result = await http.mutation("finishedGoods/jobScans:saveJobScans", {
    warehouseId: fixture.warehouseId,
    requestId: `grow-seed-${call}-${Date.now()}`,
    locationText: mapped ? "" : `ข้างเสา D${(call % 40) + 1}`,
    ...(mapped ? { location: { zoneId: mapped._id } } : {}),
    items: Array.from({ length: 50 }, (_, index) => {
      const n = call * 50 + index;
      return {
        factoryOrder: `FO69${String(300000 + n).padStart(6, "0")}`,
        productBarcodeText: `GROW-${String(n % 1200).padStart(4, "0")}-BOX`,
        partName: `GROW PART ${n % 1200} Rev.0${n % 3}`,
        customer: customers[n % customers.length],
        deliveryDate: `${(n % 28) + 1}/11/2569`,
        manufacturingDate: `${(n % 28) + 1}/10/2569`,
        quantity: 100 + (n % 900),
        source: n % 4 === 0 ? "BARCODE" : "MANUAL",
      };
    }),
  });
  if (!result.ok)
    throw Error(`saveJobScans failed: ${JSON.stringify(result).slice(0, 300)}`);
  created += 50;
}
console.log(`job scans created: ${created}`);

// 2. HR employees and attendance, cloned from the scale seed's rows.
const strip = ({ _id, _creationTime, ...rest }) => rest;
const existing = cliData("hrEmployees", 5000);
const template =
  existing.find((row) => row.code.startsWith("EMP-SCALE-")) ?? existing[0];
const employeeRows = Array.from({ length: EMPLOYEES }, (_, index) => {
  const { userId, reviewExcludedUserIds, reviewerUserIds, ...base } =
    strip(template);
  return {
    ...base,
    code: `EMP-GROW-${String(index + 1).padStart(4, "0")}`,
    displayName: `พนักงานขยาย ${index + 1}`,
    version: 1,
  };
});
const dir = mkdtempSync(join(tmpdir(), "convex-grow-"));
writeFileSync(
  join(dir, "employees.jsonl"),
  employeeRows.map((row) => JSON.stringify(row)).join("\n"),
);
convex(
  "import",
  "--table",
  "hrEmployees",
  "--append",
  "-y",
  join(dir, "employees.jsonl"),
);
const employees = cliData("hrEmployees", 5000).filter((row) =>
  row.code.startsWith("EMP-GROW-"),
);
const dayTemplate = cliData("hrAttendanceDays", 50).find(
  (row) => !row.open && row.clockOutAt && !row.pendingCorrectionId,
);
const today = new Date(`${fixture.hrProfile?.today ?? "2026-11-04"}T00:00:00Z`);
const days = [];
for (const [position, employee] of employees.entries()) {
  for (let offset = 1; offset <= DAYS; offset++) {
    const date = new Date(today.getTime() - offset * 86_400_000);
    const startAt = date.getTime() + 1 * 3_600_000; // 08:00 Asia/Bangkok
    const endAt = startAt + 9 * 3_600_000;
    const {
      pendingCorrectionId,
      certification,
      certificationHistory,
      approvedLeaveRequestId,
      ...base
    } = strip(dayTemplate);
    const open = offset === 1 && position % 10 === 0;
    days.push({
      ...base,
      employeeId: employee._id,
      warehouseId: employee.warehouseId,
      businessDate: date.toISOString().slice(0, 10),
      plan: {
        ...dayTemplate.plan,
        startAt,
        endAt,
        startTime: "08:00",
        endTime: "17:00",
        endsNextDay: false,
        breakMinutes: 60,
      },
      clockInAt: startAt + ((offset * 7) % 20) * 60_000,
      ...(open ? {} : { clockOutAt: endAt + ((offset * 11) % 30) * 60_000 }),
      open,
      revision: 1,
    });
  }
}
writeFileSync(
  join(dir, "days.jsonl"),
  days.map((row) => JSON.stringify(row)).join("\n"),
);
convex(
  "import",
  "--table",
  "hrAttendanceDays",
  "--append",
  "-y",
  join(dir, "days.jsonl"),
);
console.log(
  `hr employees: ${employees.length}, attendance days: ${days.length}`,
);
