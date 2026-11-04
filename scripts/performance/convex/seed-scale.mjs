#!/usr/bin/env node
// Grows the standard local seed into a "large tenant" profiling fixture.
// Loopback deployments only; run after `pnpm dev:seed --pagination --storage-ui --hr`.
//
// - Finished goods: the full 905-row annex pallet plan (existing guarded seed).
// - Job tickets: 3,000 scans through the real public saveJobScans mutation,
//   one third mapped to storage zones.
// - HR: 150 employees with 45 business days of attendance each, imported with
//   schema validation (documents cloned from the seeded HR demo records).
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
const confirmation = "SEED_DEMO_ANNEX_REALISTIC_2026_09";
const clerk = {
  userId:
    process.env.LOCAL_TEST_CLERK_USER_ID ?? "user_3JXrAsAOLBWzV5TTHPQjOX5WaQd",
  orgId:
    process.env.LOCAL_TEST_CLERK_ORG_ID ?? "org_3JXrDUraQjTRO3hcIzMGC9CvIXV",
};

// 1. Pallets.
for (let start = 40; start < 905; start += 100) {
  if (start <= 869 && start + 100 > 869) {
    // Rows 869–870 were seeded as reserved pallets by the standard seed.
    if (start < 869)
      convex(
        "run",
        "staging/annexDemo:seedPalletBatch",
        JSON.stringify({
          warehouseId: fixture.warehouseId,
          actorUserId: fixture.userId,
          confirmation,
          startIndex: start,
          batchSize: 869 - start,
        }),
      );
    if (start + 100 > 871)
      convex(
        "run",
        "staging/annexDemo:seedPalletBatch",
        JSON.stringify({
          warehouseId: fixture.warehouseId,
          actorUserId: fixture.userId,
          confirmation,
          startIndex: 871,
          batchSize: Math.min(100, 905 - 871),
        }),
      );
    continue;
  }
  convex(
    "run",
    "staging/annexDemo:seedPalletBatch",
    JSON.stringify({
      warehouseId: fixture.warehouseId,
      actorUserId: fixture.userId,
      confirmation,
      startIndex: start,
      batchSize: Math.min(100, 905 - start),
    }),
  );
}
console.log("pallets seeded");

// 2. Job scans through the real mutation.
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
for (let call = 0; call < 60; call++) {
  const mapped = call % 3 === 0 ? zones[call % zones.length] : undefined;
  http.setAdminAuth(deployment.adminKey, identity(clerk));
  const result = await http.mutation("finishedGoods/jobScans:saveJobScans", {
    warehouseId: fixture.warehouseId,
    requestId: `scale-seed-${call}-${Date.now()}`,
    locationText: mapped ? "" : `ข้างเสา C${(call % 40) + 1}`,
    ...(mapped ? { location: { zoneId: mapped._id } } : {}),
    items: Array.from({ length: 50 }, (_, index) => {
      const n = call * 50 + index;
      return {
        factoryOrder: `FO69${String(100000 + n).padStart(6, "0")}`,
        productBarcodeText: `SCALE-${String(n % 400).padStart(4, "0")}-BOX`,
        partName: `SCALE PART ${n % 400} Rev.0${n % 3}`,
        customer: customers[n % customers.length],
        deliveryDate: `${(n % 28) + 1}/10/2569`,
        manufacturingDate: `${(n % 28) + 1}/9/2569`,
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

// 3. HR employees and attendance (schema-validated import, cloned from demo rows).
const strip = ({ _id, _creationTime, ...rest }) => rest;
const template =
  cliData("hrEmployees", 50).find(
    (row) =>
      row.status === "ACTIVE" && row.schedule && !row.schedule.endsNextDay,
  ) ?? cliData("hrEmployees", 50)[0];
const employeeRows = Array.from({ length: 150 }, (_, index) => {
  const { userId, reviewExcludedUserIds, reviewerUserIds, ...base } =
    strip(template);
  return {
    ...base,
    code: `EMP-SCALE-${String(index + 1).padStart(3, "0")}`,
    displayName: `พนักงานทดสอบ ${index + 1}`,
    version: 1,
  };
});
const dir = mkdtempSync(join(tmpdir(), "convex-scale-"));
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
  row.code.startsWith("EMP-SCALE-"),
);
const dayTemplate = cliData("hrAttendanceDays", 50).find(
  (row) => !row.open && row.clockOutAt && !row.pendingCorrectionId,
);
const today = new Date(`${fixture.hrProfile?.today ?? "2026-11-04"}T00:00:00Z`);
const days = [];
for (const employee of employees) {
  for (let offset = 1; offset <= 45; offset++) {
    const date = new Date(today.getTime() - offset * 86_400_000);
    const businessDate = date.toISOString().slice(0, 10);
    const startAt = date.getTime() + 1 * 3_600_000; // 08:00 Asia/Bangkok
    const endAt = startAt + 9 * 3_600_000;
    const {
      pendingCorrectionId,
      certification,
      certificationHistory,
      approvedLeaveRequestId,
      ...base
    } = strip(dayTemplate);
    const open = offset === 1 && employees.indexOf(employee) % 10 === 0;
    days.push({
      ...base,
      employeeId: employee._id,
      warehouseId: employee.warehouseId,
      businessDate,
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
