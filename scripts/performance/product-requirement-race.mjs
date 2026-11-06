#!/usr/bin/env node
/** Real OCC acceptance against an owned, credential-free loopback backend. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { downloadPinnedBackend } from "../ci/check-convex-codegen.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const rounds = 24;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function unusedPort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}
const owned = mkdtempSync(join(tmpdir(), "product-requirement-race-"));
const project = join(owned, "project");
const env = { PATH: process.env.PATH, HOME: owned, CI: "1" };
let backend;
let safeToDelete = true;
const abort = new AbortController();
const interrupted = () => {
  abort.abort();
  backend?.kill("SIGTERM");
};
process.on("SIGINT", interrupted);
process.on("SIGTERM", interrupted);
try {
  mkdirSync(project);
  cpSync(join(root, "convex"), join(project, "convex"), { recursive: true });
  cpSync(join(root, "package.json"), join(project, "package.json"));
  symlinkSync(join(root, "node_modules"), join(project, "node_modules"), "dir");
  writeFileSync(
    join(project, "convex", "raceAcceptance.ts"),
    readFileSync(
      join(
        root,
        "scripts/performance/fixtures/product-requirement-race.ts.txt",
      ),
    ),
  );
  const binary = await downloadPinnedBackend(owned, env, fetch, abort.signal);
  const instanceName = `anonymous-agent-${randomBytes(8).toString("hex")}`;
  const instanceSecret = randomBytes(32).toString("hex");
  const keyResult = spawnSync(
    binary,
    [
      "keygen",
      "admin-key",
      "--instance-name",
      instanceName,
      "--instance-secret",
      instanceSecret,
    ],
    {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    },
  );
  assert.equal(keyResult.status, 0, "LOCAL_KEYGEN_FAILED");
  const key = keyResult.stdout.trim();
  const cloudPort = await unusedPort();
  let sitePort = await unusedPort();
  while (sitePort === cloudPort) sitePort = await unusedPort();
  const url = `http://127.0.0.1:${cloudPort}`;
  const state = join(owned, "state");
  mkdirSync(state);
  backend = spawn(
    binary,
    [
      "--interface",
      "127.0.0.1",
      "--port",
      String(cloudPort),
      "--site-proxy-port",
      String(sitePort),
      "--instance-name",
      instanceName,
      "--instance-secret",
      instanceSecret,
      "--disable-beacon",
      "--local-storage",
      join(state, "storage"),
      join(state, "database.sqlite3"),
    ],
    { env, stdio: "ignore" },
  );
  let spawnFailure = false;
  backend.on("error", () => {
    spawnFailure = true;
  });
  let ready = false;
  for (let retry = 0; retry < 100; retry++) {
    assert(
      !abort.signal.aborted &&
        !spawnFailure &&
        backend.exitCode === null &&
        backend.signalCode === null,
      "OWNED_BACKEND_START_FAILED",
    );
    try {
      const response = await fetch(`${url}/instance_name`, {
        redirect: "error",
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        assert.equal(await response.text(), instanceName);
        ready = true;
        break;
      }
    } catch {
      /* Starting the owned backend can take a moment. */
    }
    await pause(100);
  }
  assert(ready, "OWNED_BACKEND_NOT_READY");
  const envFile = join(owned, "deployment.env");
  writeFileSync(
    envFile,
    `CONVEX_SELF_HOSTED_URL=${url}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${key}\n`,
    { mode: 0o600 },
  );
  function cli(args) {
    const result = spawnSync(
      process.execPath,
      [
        `--env-file=${envFile}`,
        join(root, "node_modules/convex/bin/main.js"),
        ...args,
      ],
      {
        cwd: project,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 300000,
      },
    );
    if (result.status !== 0)
      throw new Error(`LOCAL_CLI_${args[0]}_FAILED: ${result.stderr}`);
  }
  cli(["env", "set", "CLERK_JWT_ISSUER_DOMAIN", "https://query-race.invalid"]);
  cli(["dev", "--once", "--typecheck", "disable", "--codegen", "disable"]);
  const admin = new ConvexHttpClient(url, { logger: false });
  admin.setAdminAuth(key);
  const identity = {
    subject: "query_race_user",
    issuer: "https://query-race.invalid",
    tokenIdentifier: "https://query-race.invalid|query_race_user",
    org_id: "query_race_org",
  };
  const actor = () => {
    const client = new ConvexHttpClient(url, { logger: false });
    client.setAdminAuth(key, identity);
    return client;
  };
  const writer = actor(),
    reserver = actor();
  const seeded = await admin.mutation("raceAcceptance:initialize", {});
  const fields = {
    name: "Race product",
    unit: "PCS",
    storageFormat: "PALLET",
    defaultQuantity: 500,
    storageCondition: "DRY",
    draft: false,
  };
  const written = (result) => {
    assert.equal(result.ok, true);
    assert.equal(result.value.written, true, JSON.stringify(result));
    return result.value.documentId;
  };
  const wins = { edit: 0, reserve: 0 };
  for (let round = 0; round < rounds; round++) {
    const { warehouseId, zoneId } = await admin.mutation(
      "raceAcceptance:seedRound",
      { ...seeded, round },
    );
    const productId = written(
      await writer.mutation("finishedGoods/workflow:saveProduct", {
        ...fields,
        sku: `RACE-${round}`,
        warehouseId,
        requestId: `product-race-${round}`,
      }),
    );
    const palletId = written(
      await writer.mutation("finishedGoods/workflow:createPallet", {
        warehouseId,
        productId,
        requestId: `pallet-race-${round}`,
      }),
    );
    const initial = await admin.query("raceAcceptance:inspect", {
      productId,
      palletId,
    });
    written(
      await writer.mutation("finishedGoods/workflow:saveMeasurement", {
        warehouseId,
        palletId,
        requestId: `measure-race-${round}`,
        expectedMeasurementUpdatedAt: initial.pallet.updatedAt,
        quantity: 500,
        lengthMm: 1200,
        widthMm: 1000,
        heightMm: 1400,
      }),
    );
    const edit = () =>
      writer.mutation("finishedGoods/workflow:saveProduct", {
        ...fields,
        storageCondition: "COLD",
        sku: `RACE-${round}`,
        warehouseId,
        productId,
        expectedUpdatedAt: initial.product.updatedAt,
        requestId: `edit-race-${round}`,
      });
    const reserve = () =>
      reserver.mutation("finishedGoods/workflow:reserve", {
        warehouseId,
        palletId,
        zoneId,
        requestId: `reserve-race-${round}`,
        xMm: 0,
        yMm: 0,
        rotation: 0,
      });
    // Independent clients avoid the HTTP client's same-client mutation queue.
    const [editResult, reserveResult] =
      round % 2 === 0
        ? await Promise.all([edit(), reserve()])
        : (await Promise.all([reserve(), edit()])).reverse();
    assert.equal(editResult.ok, true);
    assert.equal(reserveResult.ok, true);
    assert.equal(
      Number(editResult.value.written) + Number(reserveResult.value.written),
      1,
      "BOTH_OR_NEITHER_WRITES_COMMITTED",
    );
    const after = await admin.query("raceAcceptance:inspect", {
      productId,
      palletId,
    });
    if (editResult.value.written) {
      wins.edit++;
      assert.equal(
        reserveResult.value.error.code,
        "STORAGE_CONDITION_MISMATCH",
      );
      assert.equal(after.product.storageCondition, "COLD");
      assert.equal(after.pallet.status, "AWAITING_PLACEMENT");
    } else {
      wins.reserve++;
      assert.equal(editResult.value.error.code, "LOCATION_OCCUPIED");
      assert.equal(after.product.storageCondition, "DRY");
      assert.equal(after.pallet.status, "RESERVED");
    }
  }
  assert(
    wins.edit > 0 && wins.reserve > 0,
    "BOTH_SERIALIZATION_ORDERS_NOT_OBSERVED",
  );
  console.log(
    JSON.stringify(
      {
        status: "passed",
        rounds,
        wins,
        incompatibleCommittedPairs: 0,
        backend: "precompiled-2026-10-06-a3538c6",
        note: "Actual concurrent public mutations; no retry-rate or production-load claim.",
      },
      null,
      2,
    ),
  );
} finally {
  if (
    backend?.pid !== undefined &&
    backend.exitCode === null &&
    backend.signalCode === null
  ) {
    backend.kill("SIGTERM");
    for (
      let retry = 0;
      retry < 30 && backend.exitCode === null && backend.signalCode === null;
      retry++
    )
      await pause(100);
    if (backend.exitCode === null && backend.signalCode === null)
      backend.kill("SIGKILL");
    for (
      let retry = 0;
      retry < 20 && backend.exitCode === null && backend.signalCode === null;
      retry++
    )
      await pause(100);
    safeToDelete = backend.exitCode !== null || backend.signalCode !== null;
  }
  if (safeToDelete) rmSync(owned, { recursive: true, force: true });
  else throw new Error("OWNED_BACKEND_STOP_FAILED");
  process.off("SIGINT", interrupted);
  process.off("SIGTERM", interrupted);
}
