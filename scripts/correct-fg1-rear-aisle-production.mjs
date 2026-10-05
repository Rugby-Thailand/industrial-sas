// Run with Node 24 and --env-file pointing to the private production credential.
// Default mode is read-only; mutation calls are never retried automatically.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  fg1ApprovedPlan,
  fg1PreviousPlan,
  FG1_PREVIOUS_REVISION,
  FG1_REVISION,
} from "../convex/model/storageLayout/fg1ApprovedPlan.ts";

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "preflight" },
    directory: { type: "string" },
    backup: { type: "string" },
  },
  strict: true,
});
const target = {
  warehouseId: "p17ckfaqgw6dprz8d3tfv1tkhd8ez4e6",
  buildingId: "n57effrz60rbq7fqx438q6r6fx8f0hed",
};
const url = "https://greedy-cardinal-537.convex.cloud";
assert.equal(process.env.CONVEX_URL, url, "Wrong deployment");
assert.ok(process.env.CONVEX_DEPLOY_KEY, "Missing admin key");
assert.ok(["preflight", "apply", "verify"].includes(values.mode));
assert.ok(
  values.directory,
  "--directory must name an existing private directory",
);
const directory = resolve(values.directory);
assert.equal(
  (await stat(directory)).mode & 0o777,
  0o700,
  "Artifact directory must be 0700",
);
const client = new ConvexHttpClient(url, { logger: false });
client.setAdminAuth(process.env.CONVEX_DEPLOY_KEY, {
  subject: "user_3Je6gsq8cJfoVOXcjjHGs8qvDGs",
  issuer: "https://clerk.thaipropertyai.com",
  org_id: "org_3Je6JpUXsjAZcHyLD5lodjFdLmQ",
  o: { id: "org_3Je6JpUXsjAZcHyLD5lodjFdLmQ" },
});
async function call(kind, path, args) {
  const result = await client[kind](makeFunctionReference(path), args);
  assert.equal(result.ok, true, "Application denied the request");
  return result.value;
}
async function save(name, value) {
  const path = resolve(directory, name);
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, contents, { flag: "wx", mode: 0o600 });
  return { path, sha256: createHash("sha256").update(contents).digest("hex") };
}
async function others() {
  const buildings = await call(
    "query",
    "storageLayouts/catalogue:listStorageBuildings",
    {
      warehouseId: target.warehouseId,
    },
  );
  assert.equal(
    buildings.filter((building) => building.code === "FG1").length,
    1,
  );
  return Promise.all(
    buildings
      .filter((building) => building.buildingId !== target.buildingId)
      .map((building) =>
        call("query", "storageLayouts/catalogue:getStorageBuilding", {
          warehouseId: target.warehouseId,
          buildingId: building.buildingId,
        }),
      ),
  );
}
async function preflight() {
  const result = await call(
    "query",
    "storageLayouts/fg1Import:preflight",
    target,
  );
  assert.equal(
    result.revision,
    FG1_REVISION,
    "Updated backend is not deployed",
  );
  assert.equal(result.backup.building._id, target.buildingId);
  assert.equal(result.backup.warehouse._id, target.warehouseId);
  assert.equal(result.backup.warehouse.code, "TG-OPT");
  assert.deepEqual(
    result.plan,
    fg1ApprovedPlan(),
    "Deployed geometry differs from checkout",
  );
  return result;
}
const fields = (row) => [row.xMm, row.yMm, row.widthMm, row.depthMm];
const blockShape = (row) =>
  JSON.stringify([
    row.label,
    row.areaKind,
    row.color,
    row.displayHeightMm,
    ...fields(row),
  ]);
function assertBefore(current, original) {
  assert.equal(original.deployment, url);
  assert.equal(original.revision, FG1_PREVIOUS_REVISION);
  assert.equal(original.backup.building._id, target.buildingId);
  assert.equal(original.backup.warehouse._id, target.warehouseId);
  assert.equal(original.blocked, false, "Original snapshot was blocked");
  assert.deepEqual(
    original.plan,
    fg1PreviousPlan(),
    "Original backup is not the approved r1 plan",
  );
  assert.equal(
    current.backup.building.fg1Import?.revision,
    FG1_PREVIOUS_REVISION,
  );
  assert.equal(
    current.blocked,
    false,
    "Stock, reservation, or move blocks correction",
  );
  assert.equal(
    current.digest,
    original.digest,
    "Production changed since backup",
  );
  assert.deepEqual(
    current.backup.blocks.map(blockShape).sort(),
    fg1PreviousPlan().blocks.map(blockShape).sort(),
    "Source reserved areas do not match r1",
  );
}
async function verify(original, after) {
  const approved = fg1ApprovedPlan();
  assert.equal(after.backup.building.fg1Import?.revision, FG1_REVISION);
  assert.equal(
    after.backup.building.version,
    original.backup.building.version + 1,
  );
  assert.equal(after.backup.floors[0]._id, original.backup.floors[0]._id);
  assert.equal(
    after.backup.floors[0].version,
    original.backup.floors[0].version + 1,
  );
  assert.equal(after.backup.building.widthMm, approved.widthMm);
  assert.equal(after.backup.building.depthMm, approved.depthMm);
  assert.equal(after.backup.building.usableAreaSqMm, approved.usableAreaSqMm);
  assert.equal(
    after.backup.building.reservedAreaSqMm,
    approved.reservedAreaSqMm,
  );
  assert.equal(after.backup.building.status, original.backup.building.status);
  assert.equal(
    after.backup.building.defaultFloorHeightMm,
    original.backup.building.defaultFloorHeightMm,
  );
  assert.deepEqual(
    after.backup.blocks.map(blockShape).sort(),
    approved.blocks.map(blockShape).sort(),
  );
  for (const old of original.backup.blocks)
    assert.ok(
      after.backup.blocks.some((block) => block._id === old._id),
      "Reserved block ID changed",
    );
  for (const table of [
    "zones",
    "positions",
    "locations",
    "placements",
    "moves",
    "assignments",
    "pallets",
    "legacyZones",
    "legacyPositions",
    "legacyLocations",
    "jobScans",
  ])
    assert.deepEqual(
      after.backup[table],
      original.backup[table],
      `${table} changed`,
    );
  assert.deepEqual(
    await others(),
    original.otherBuildings,
    "Other buildings changed",
  );
}
async function main() {
  assert.ok(values.backup, "--backup is required");
  const backupPath = resolve(values.backup);
  assert.equal(
    (await stat(backupPath)).mode & 0o777,
    0o600,
    "Backup must be 0600",
  );
  const original = JSON.parse(await readFile(backupPath, "utf8"));
  if (values.mode === "preflight") {
    const current = await preflight();
    assertBefore(current, original);
    assert.deepEqual(
      await others(),
      original.otherBuildings,
      "Other buildings changed",
    );
    const artifact = await save("rear-ready.json", {
      ...current,
      capturedAt: new Date().toISOString(),
      deployment: url,
    });
    console.log(
      JSON.stringify({ ready: true, digest: current.digest, ...artifact }),
    );
    return;
  }
  if (values.mode === "apply") {
    const current = await preflight();
    assertBefore(current, original);
    assert.deepEqual(
      await others(),
      original.otherBuildings,
      "Other buildings changed",
    );
    await save("rear-apply-intent.json", {
      target,
      revision: FG1_REVISION,
      expectedDigest: original.digest,
      startedAt: new Date().toISOString(),
    });
    const result = await call(
      "mutation",
      "storageLayouts/fg1Import:correctRearAisle",
      {
        ...target,
        revision: FG1_REVISION,
        expectedDigest: original.digest,
      },
    );
    console.log(
      JSON.stringify({
        mutation: await save("rear-apply-result.json", result),
      }),
    );
  }
  const after = await preflight();
  const artifact = await save(
    values.mode === "verify"
      ? `rear-verify-${Date.now()}.json`
      : "rear-after.json",
    after,
  );
  await verify(original, after);
  console.log(
    JSON.stringify({
      verified: true,
      revision: FG1_REVISION,
      blocks: after.backup.blocks.length,
      locations: after.backup.locations.length,
      reservedAreaSqM: after.backup.building.reservedAreaSqMm / 1e6,
      ...artifact,
    }),
  );
}
main().catch((error) => {
  // SDK errors may contain credentials. Inspect private artifacts before any retry.
  console.error(
    error instanceof assert.AssertionError
      ? error.message.split("\n")[0]
      : "Operation failed or outcome uncertain; inspect private artifacts and production revision. No automatic retry.",
  );
  process.exitCode = 1;
});
