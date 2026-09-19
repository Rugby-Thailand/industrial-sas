#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
process.loadEnvFile(".env.local");

const deployment = process.env.CONVEX_DEPLOYMENT?.trim() ?? "";
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim() ?? "";
if (!deployment.startsWith("anonymous:") && !deployment.startsWith("local:")) {
  throw new Error(
    "Refusing local test seed: CONVEX_DEPLOYMENT is not anonymous/local",
  );
}
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(convexUrl)) {
  throw new Error(
    "Refusing local test seed: NEXT_PUBLIC_CONVEX_URL is not loopback",
  );
}
if (process.env.ALLOW_LOCAL_TEST_SEED !== "true") {
  throw new Error(
    "Refusing local test seed: set ALLOW_LOCAL_TEST_SEED=true first",
  );
}

const paginationProfile = process.argv.includes("--pagination");
const confirmation = "SEED_DEMO_ANNEX_REALISTIC_2026_09";
const clerkUserId =
  process.env.LOCAL_TEST_CLERK_USER_ID ?? "user_3JXrAsAOLBWzV5TTHPQjOX5WaQd";
const clerkOrganizationId =
  process.env.LOCAL_TEST_CLERK_ORG_ID ?? "org_3JXrDUraQjTRO3hcIzMGC9CvIXV";
const email = process.env.LOCAL_TEST_CLERK_EMAIL ?? "local.tester@example.com";

function run(functionName, args) {
  const raw = execFileSync(
    "pnpm",
    ["exec", "convex", "run", functionName, JSON.stringify(args)],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Could not parse ${functionName} result:\n${raw}`);
  }
}

const bootstrap = run("staging/annexDemo:bootstrapLocalDemo", {
  clerkUserId,
  clerkOrganizationId,
  displayName: email,
  email,
  confirmation,
  allowLocalTestSeed: true,
});

const common = {
  warehouseId: bootstrap.warehouseId,
  actorUserId: bootstrap.userId,
  confirmation,
};
run("staging/summaryBackfill:invalidate", {
  warehouseId: bootstrap.warehouseId,
});
const configure = run("staging/annexDemo:configure", common);
const workflow = run("staging/annexDemo:seedWorkflowScenarios", common);
const pallets = run("staging/annexDemo:seedPalletBatch", {
  ...common,
  startIndex: 0,
  batchSize: 40,
});
const reservedPallets = run("staging/annexDemo:seedPalletBatch", {
  ...common,
  startIndex: 869,
  batchSize: 2,
});

const paginationResults = [];
if (paginationProfile) {
  for (const [kind, total] of [
    ["products", 121],
    ["buildings", 121],
    ["units", 360],
    ["batches", 121],
  ]) {
    for (let start = 0; start < total; start += 25)
      paginationResults.push(
        run("staging/paginationDemo:seed", {
          warehouseId: bootstrap.warehouseId,
          actorUserId: bootstrap.userId,
          confirmation: "LOCAL_PAGINATION_FIXTURES_V1",
          kind,
          start,
          count: Math.min(25, total - start),
        }),
      );
  }
}
let summaries = run("staging/summaryBackfill:run", {
  warehouseId: bootstrap.warehouseId,
  restart: true,
});
let summaryBatches = 1;
while (!summaries.ready) {
  if (++summaryBatches > 10000)
    throw new Error(
      "Summary backfill exceeded its safety limit; resume staging/summaryBackfill:run manually",
    );
  summaries = run("staging/summaryBackfill:run", {
    warehouseId: bootstrap.warehouseId,
  });
}

const fixture = {
  generatedAt: new Date().toISOString(),
  email,
  organizationId: bootstrap.organizationId,
  userId: bootstrap.userId,
  warehouseId: bootstrap.warehouseId,
  buildingId: bootstrap.buildingId,
  buildingCode: "DEMO-ANNEX",
  fixtureSummary: {
    buildings: 2,
    activeFloors: 2,
    draftBuildings: 1,
    products: 5,
    batches: 2,
    pallets: 48,
    reservedPallets: 2,
    stackedPair: true,
    annexPlannedPalletRows: 905,
    seededZones: 6,
  },
  products: [
    "DEMO-CARTON",
    "DEMO-DRINK",
    "DEMO-SPARE-PARTS",
    "DEMO-HOMECARE",
    "DEMO-SNACK",
  ],
  workflowRecords: {
    draftLot: "DEMO-R26-DRAFT",
    createdLot: "DEMO-R26-CREATED",
    pallets: [
      "DEMO-R26-BATCH-01",
      "DEMO-R26-BATCH-02",
      "DEMO-R26-MEASURE-01",
      "DEMO-R26-PLACE-01",
    ],
  },
  paginationProfile: paginationProfile
    ? {
        products: 121,
        buildings: 121,
        locations: 363,
        units: 360,
        batches: 121,
        prefix: "PAGINATION-",
      }
    : null,
  seedResults: {
    bootstrap,
    configure,
    workflow,
    pallets,
    reservedPallets,
    paginationResults,
    summaryBatches,
  },
};
const outputPath = resolve(root, "output/local-test-data.json");
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);
