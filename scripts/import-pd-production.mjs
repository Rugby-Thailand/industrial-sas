// Run with Node 24 and --env-file pointing to the private admin credential file.
// Default is read-only. No automatic retry of any mutation.
import { readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import {
  PD_REVISION,
  pdApprovedPlan,
} from "../convex/model/storageLayout/pdApprovedPlan.ts";

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
  buildingId: "n57c2n3sjmdpkjncn9jf0a19gh8ey9h5",
};
const url = "https://greedy-cardinal-537.convex.cloud";
assert.equal(process.env.CONVEX_URL, url, "Wrong deployment");
assert.ok(process.env.CONVEX_DEPLOY_KEY, "Missing admin key");
assert.ok(
  ["preflight", "apply", "verify"].includes(values.mode),
  "Unknown mode",
);
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
  const text = JSON.stringify(value, null, 2) + "\n";
  await writeFile(path, text, { flag: "wx", mode: 0o600 });
  return { path, sha256: createHash("sha256").update(text).digest("hex") };
}
async function others() {
  const buildings = await call(
    "query",
    "storageLayouts/catalogue:listStorageBuildings",
    { warehouseId: target.warehouseId },
  );
  assert.equal(buildings.filter((b) => b.code === "PD").length, 1);
  return Promise.all(
    buildings
      .filter((b) => b.buildingId !== target.buildingId)
      .map((b) =>
        call("query", "storageLayouts/catalogue:getStorageBuilding", {
          warehouseId: target.warehouseId,
          buildingId: b.buildingId,
        }),
      ),
  );
}
async function preflight() {
  const result = await call(
    "query",
    "storageLayouts/pdImport:preflight",
    target,
  );
  assert.equal(result.revision, PD_REVISION);
  assert.equal(result.backup.building._id, target.buildingId);
  assert.equal(result.backup.warehouse.code, "TG-OPT");
  assert.deepEqual(
    result.plan,
    pdApprovedPlan(),
    "Deployed geometry differs from reviewed checkout",
  );
  return result;
}
async function main() {
  if (values.mode === "preflight") {
    const current = await preflight();
    const artifact = await save("preflight.json", {
      ...current,
      otherBuildings: await others(),
      capturedAt: new Date().toISOString(),
      deployment: url,
    });
    console.log(
      JSON.stringify({
        ...artifact,
        blocked: current.blocked,
        revision: current.revision,
        digest: current.digest,
        locations: current.backup.locations.length,
      }),
    );
    if (current.blocked) process.exitCode = 2;
    return;
  }
  assert.ok(values.backup, "--backup is required");
  const original = JSON.parse(await readFile(values.backup, "utf8"));
  assert.equal(original.deployment, url);
  assert.equal(original.revision, PD_REVISION);
  if (values.mode === "apply") {
    const fresh = await preflight();
    assert.equal(fresh.blocked, false, "Stock/reservation/move blocks import");
    assert.equal(
      fresh.digest,
      original.digest,
      "Preflight changed; inspect and back up again",
    );
    assert.deepEqual(
      await others(),
      original.otherBuildings,
      "Other buildings changed; inspect first",
    );
    // Establish a durable intent before sending: an interrupted run must not be retried blindly.
    await save("apply-intent.json", {
      target,
      revision: PD_REVISION,
      expectedDigest: original.digest,
      startedAt: new Date().toISOString(),
    });
    const result = await call("mutation", "storageLayouts/pdImport:apply", {
      ...target,
      revision: PD_REVISION,
      expectedDigest: original.digest,
    });
    console.log(JSON.stringify(await save("apply-result.json", result)));
  }
  const after = await preflight();
  const artifact = await save(
    values.mode === "verify" ? `verify-${Date.now()}.json` : "after.json",
    after,
  );
  assert.equal(after.backup.building.pdImport?.revision, PD_REVISION);
  assert.equal(after.backup.building.widthMm, 61500);
  assert.equal(after.backup.building.depthMm, 11960);
  assert.equal(after.backup.building.status, original.backup.building.status);
  assert.equal(
    after.backup.building.defaultFloorHeightMm,
    original.backup.building.defaultFloorHeightMm,
  );
  for (const table of ["zones", "positions"]) {
    const ids = (rows) =>
      rows.map((r) => [r._id, r.code, r.qrValue, r.locationId]);
    assert.deepEqual(
      ids(after.backup[table]),
      ids(original.backup[table]),
      `${table} identity changed`,
    );
  }
  assert.deepEqual(after.backup.locations, original.backup.locations);
  for (const zone of after.backup.zones) {
    const position = after.backup.positions.find((p) => p.zoneId === zone._id);
    assert.ok(position);
    for (const field of ["xMm", "yMm", "widthMm", "depthMm"])
      assert.equal(
        position[field],
        zone[field],
        "Default-position geometry differs from its zone",
      );
  }
  for (const table of [
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
  console.log(
    JSON.stringify({
      verified: true,
      revision: PD_REVISION,
      locations: 198,
      dimensionsMm: [61500, 11960],
      usableAreaSqM: after.backup.building.usableAreaSqMm / 1e6,
      ...artifact,
    }),
  );
}
main().catch((error) => {
  // Never print SDK error bodies or credentials. Check artifacts and query revision before any retry.
  console.error(
    error instanceof assert.AssertionError
      ? error.message.split("\n")[0]
      : "Operation failed or outcome uncertain; inspect private artifacts and production revision. No automatic retry.",
  );
  process.exitCode = 1;
});
