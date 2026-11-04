#!/usr/bin/env node
// Profiles the real local Convex backend: per-function latency, database
// reads/writes, reactive re-execution fan-out and OCC retries.
//
//   node scripts/performance/convex/profile.mjs <label> [--samples 7] [--only fg-catalogue,job-scan]
//
// Results: output/perf/<label>.json (raw per-scenario summaries + run metadata).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadavg } from "node:os";
import { resolve as resolvePath } from "node:path";
import {
  httpClient,
  identity,
  loadDeployment,
  startLogCollector,
  summarizeExecutions,
  wsClient,
} from "./lib.mjs";
import {
  discover,
  mutationFlows,
  queryScenarios,
  requestId,
} from "./scenarios.mjs";

const label = process.argv[2];
if (!label || !/^[a-zA-Z0-9_.-]{1,64}$/.test(label))
  throw Error("usage: profile.mjs <label> [--samples N] [--only screens]");
const flag = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
};
const samples = Number(flag("samples", 7));
const only = flag("only", "")?.split(",").filter(Boolean);
const skip = new Set(flag("skip", "")?.split(",").filter(Boolean));

const restore = flag("restore", "");
// --targets candidate=.,base=../industrial-sas-convex-perf-base  (first is the candidate)
const targetSpecs = (flag("targets", "candidate=.") ?? "candidate=.")
  .split(",")
  .map((spec) => {
    const [name, root] = spec.split("=");
    return { name, root: root ?? "." };
  });
const clerk = {
  userId:
    process.env.LOCAL_TEST_CLERK_USER_ID ?? "user_3JXrAsAOLBWzV5TTHPQjOX5WaQd",
  orgId:
    process.env.LOCAL_TEST_CLERK_ORG_ID ?? "org_3JXrDUraQjTRO3hcIzMGC9CvIXV",
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Backfill derived zone occupancy after a restore, on targets that have it. */
function rebuildDerived(root, warehouseId) {
  const run = (args) => {
    try {
      return JSON.parse(
        execFileSync(
          "pnpm",
          [
            "exec",
            "convex",
            "run",
            "storageLayouts/zoneOccupancyBackfill:run",
            JSON.stringify(args),
          ],
          { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        ),
      );
    } catch {
      return null; // this target predates derived occupancy
    }
  };
  let result = run({ warehouseId, restart: true, batchSize: 25 });
  while (result && !result.isDone)
    result = run({ warehouseId, cursor: result.continueCursor, batchSize: 25 });
  if (result && !result.ready)
    throw Error(`${root}: zone occupancy backfill finished without readiness`);
}
/** A mutation that returned a refusal value instead of throwing. */
const refusal = (value) =>
  value?.ok === false
    ? (value.denial?.code ?? "DENIED")
    : value?.value?.ok === false ||
        value?.value?.error ||
        value?.value?.written === false
      ? (value.value.error?.code ?? value.value.code ?? "NOT_WRITTEN")
      : undefined;
const targets = targetSpecs.map(({ name, root }) => {
  if (restore)
    // Identical starting data for every compared run (writes and audit rows drift).
    execFileSync(
      "pnpm",
      ["exec", "convex", "import", "--replace-all", "-y", resolvePath(restore)],
      { cwd: root, stdio: "ignore" },
    );
  const deployment = loadDeployment(root);
  if (restore) rebuildDerived(root, deployment.fixture.warehouseId);
  return {
    name,
    root,
    deployment,
    http: httpClient(deployment),
    logs: startLogCollector(deployment),
  };
});
const ids = discover(targets[0].deployment.fixture);

/** Execute one function as the seeded user with a fresh (uncached) identity. */
async function invoke(target, kind, fn, args, client) {
  const { deployment } = target;
  const http = client ?? target.http;
  http.setAdminAuth(deployment.adminKey, identity(clerk));
  const started = Date.now();
  const t0 = performance.now();
  let value;
  let error;
  try {
    value = await (kind === "mutation"
      ? http.mutation(fn, args)
      : http.query(fn, args));
  } catch (caught) {
    error = String(caught?.data?.code ?? caught?.message ?? caught).slice(
      0,
      160,
    );
  }
  return {
    value,
    error,
    rtt: performance.now() - t0,
    started,
    ended: Date.now(),
  };
}

/** Completions for `fn` executed by the acting user inside the given windows. */
async function completionsFor(target, fn, windows) {
  const matches = () =>
    target.logs.entries.filter(
      (entry) =>
        entry.identifier === fn &&
        entry.identityType === "member_acting_user" &&
        !entry.cachedResult &&
        windows.some(
          (window) =>
            entry.executionTimestamp * 1000 >= window.started - 5 &&
            entry.executionTimestamp * 1000 <= window.ended + 5,
        ),
    );
  for (let attempt = 0; attempt < 60; attempt++) {
    const found = matches();
    if (found.length >= windows.length) return found;
    await sleep(50);
  }
  return matches();
}

const sumInto = (target, entry) => {
  if (!target) return structuredClone(entry);
  target.executionTime += entry.executionTime;
  target.userExecutionTime =
    (target.userExecutionTime ?? 0) + (entry.userExecutionTime ?? 0);
  target.returnBytes = (target.returnBytes ?? 0) + (entry.returnBytes ?? 0);
  for (const [key, value] of Object.entries(entry.usageStats ?? {}))
    if (key !== "memoryUsedMb")
      target.usageStats[key] = (target.usageStats[key] ?? 0) + value;
  target.error ||= entry.error;
  return target;
};

async function runChain(target, scenario, state) {
  const windows = [];
  let args = scenario.args;
  let rtt = 0;
  for (let request = 0; request < 200; request++) {
    const outcome = await invoke(target, "query", scenario.fn, args);
    windows.push(outcome);
    rtt += outcome.rtt;
    if (outcome.error) {
      state.lastError = outcome.error;
      break;
    }
    const value = outcome.value?.value ?? outcome.value;
    // Business refusals are values, not throws: never let them pass as data.
    if (outcome.value?.ok === false)
      state.resultCode = outcome.value.denial?.code ?? "DENIED";
    else if (value?.ok === false) state.resultCode = value.code ?? "NOT_OK";
    if (!scenario.settle || value?.status !== "scanning" || !value.scanCursor)
      break;
    args = { ...scenario.args, scanCursor: value.scanCursor };
  }
  return { windows, rtt };
}

/** Samples alternate target order (AB, BA, ...) so machine load hits both equally. */
async function profileQuery(scenario) {
  const state = new Map(
    targets.map((target) => [
      target.name,
      { perSample: [], rtts: [], requests: [] },
    ]),
  );
  for (let sample = 0; sample <= samples; sample++) {
    const order = sample % 2 ? [...targets].reverse() : targets;
    for (const target of order) {
      const row = state.get(target.name);
      const { windows, rtt } = await runChain(target, scenario, row);
      if (sample === 0) continue; // warm-up: module load / isolate start
      const entries = await completionsFor(target, scenario.fn, windows);
      if (!entries.length) continue;
      row.perSample.push(
        entries.reduce((total, entry) => sumInto(total, entry), undefined),
      );
      row.rtts.push(rtt);
      row.requests.push(windows.length);
    }
  }
  return Object.fromEntries(
    [...state.entries()].map(([name, row]) => [
      name,
      {
        ...summarizeExecutions(row.perSample, row.rtts),
        requests: row.requests.length ? Math.max(...row.requests) : 0,
        ...(row.lastError ? { lastError: row.lastError } : {}),
        ...(row.resultCode ? { resultCode: row.resultCode } : {}),
      },
    ]),
  );
}

async function profileFlows(target) {
  const results = [];
  for (const flow of mutationFlows(ids)) {
    const calls = new Map();
    const call = async (fn, args) => {
      const outcome = await invoke(target, "mutation", fn, args);
      const entries = await completionsFor(target, fn, [outcome]);
      const list = calls.get(fn) ?? [];
      list.push(...entries.map((entry) => ({ ...entry, rtt: outcome.rtt })));
      calls.set(fn, list);
      if (outcome.error) throw Error(`${fn}: ${outcome.error}`);
      if (refusal(outcome.value))
        throw Error(`${fn}: refused ${refusal(outcome.value)}`);
      return outcome.value;
    };
    const ctx = {
      query: async (fn, args) =>
        (await invoke(target, "query", fn, args)).value,
    };
    let note;
    try {
      for (
        let sample = 0;
        sample < Math.max(3, Math.ceil(samples / 2));
        sample++
      )
        note = (await flow.run(call, ctx))?.note ?? note;
    } catch (error) {
      note = String(error.message).slice(0, 200);
    }
    results.push({
      flow: flow.name,
      ...(note ? { note } : {}),
      steps: [...calls.entries()].map(([fn, entries]) => ({
        fn,
        ...summarizeExecutions(
          entries,
          entries.map((entry) => entry.rtt),
        ),
      })),
    });
  }
  return results;
}

/**
 * Subscribe a realistic set of screens over one WebSocket session, then make
 * one write and count every query the backend re-executed because of it.
 */
async function profileFanout(target, scenarios) {
  const { logs } = target;
  const client = wsClient(target.deployment, clerk);
  // Only what the current client subscribes to: legacy endpoints have no live caller.
  const subscribed = scenarios.filter((scenario) => !scenario.legacy);
  // Progressive queries stay subscribed with their final settled arguments,
  // as useCatalogueSync/useHrPagedQuery leave them.
  const settledArgs = async (scenario) => {
    let args = scenario.args;
    for (let request = 0; scenario.settle && request < 200; request++) {
      const value = (await invoke(target, "query", scenario.fn, args)).value;
      const result = value?.value ?? value;
      if (result?.status !== "scanning" || !result.scanCursor) break;
      args = { ...scenario.args, scanCursor: result.scanCursor };
    }
    return args;
  };
  const latest = new Map();
  const unsubscribers = [];
  for (const scenario of subscribed)
    scenario.subscribedArgs = await settledArgs(scenario);
  await Promise.all(
    subscribed.map(
      (scenario) =>
        new Promise((resolve) => {
          const timer = setTimeout(resolve, 10_000);
          unsubscribers.push(
            client.onUpdate(
              scenario.fn,
              scenario.subscribedArgs,
              (value) => {
                latest.set(scenario, value?.value ?? value);
                clearTimeout(timer);
                resolve();
              },
              () => resolve(),
            ),
          );
        }),
    ),
  );
  const syncEntries = () =>
    logs.entries.filter(
      (entry) => entry.udfType === "Query" && entry.caller !== "HttpApi",
    );
  /** Wait until no subscription re-executed for `quietMs` (bounded), so slow machines are not undercounted. */
  const quiesce = async (quietMs = 3_000, maxMs = 30_000) => {
    const deadline = Date.now() + maxMs;
    let seen = syncEntries().length;
    let quietSince = Date.now();
    while (Date.now() < deadline) {
      await sleep(100);
      const now = syncEntries().length;
      if (now !== seen) {
        seen = now;
        quietSince = Date.now();
      } else if (Date.now() - quietSince >= quietMs) return;
    }
  };
  await quiesce();
  const writes = [
    {
      name: "saveJobScans (1 item)",
      fn: "finishedGoods/jobScans:saveJobScans",
      args: () => ({
        warehouseId: ids.warehouseId,
        requestId: requestId("fanout"),
        locationText: "PERF",
        items: [
          {
            factoryOrder: "FO69999999",
            productBarcodeText: "PERF-FANOUT",
            source: "MANUAL",
            quantity: 1,
          },
        ],
      }),
    },
    {
      // A real placement write: reserve the first recommended destination.
      name: "reserve (awaiting pallet)",
      fn: "finishedGoods/workflow:reserve",
      args: async () => {
        const pallet = (
          await invoke(target, "query", "finishedGoods/workflow:getPallet", {
            warehouseId: ids.warehouseId,
            palletId: ids.awaitingPalletId,
          })
        ).value?.value;
        const recommended = (
          await invoke(target, "query", "finishedGoods/workflow:recommend", {
            warehouseId: ids.warehouseId,
            palletId: ids.awaitingPalletId,
          })
        ).value?.value;
        const candidate = recommended?.candidates?.[0];
        if (!candidate)
          throw Error(
            `no recommended destination: ${JSON.stringify(recommended?.reasons)}`,
          );
        const measuredAt = pallet?.pallet?.updatedAt ?? pallet?.updatedAt;
        return {
          warehouseId: ids.warehouseId,
          palletId: ids.awaitingPalletId,
          requestId: requestId("fanout-reserve"),
          zoneId: candidate.zoneId,
          ...(candidate.supportPositionId
            ? { supportPositionId: candidate.supportPositionId }
            : {}),
          ...(candidate.supportPalletId
            ? { supportPalletId: candidate.supportPalletId }
            : {}),
          xMm: candidate.xMm,
          yMm: candidate.yMm,
          rotation: candidate.rotation,
          ...(measuredAt === undefined
            ? {}
            : { expectedMeasurementUpdatedAt: measuredAt }),
        };
      },
    },
    {
      name: "cancelReservation (same pallet)",
      fn: "finishedGoods/workflow:cancelReservation",
      args: () => ({
        warehouseId: ids.warehouseId,
        palletId: ids.awaitingPalletId,
        requestId: requestId("fanout-cancel"),
      }),
    },
    {
      // A catalogue write: a new pallet for the busiest product.
      name: "createPallet (busiest product)",
      fn: "finishedGoods/workflow:createPallet",
      args: () => ({
        warehouseId: ids.warehouseId,
        productId: ids.productId,
        requestId: requestId("fanout-create"),
      }),
    },
  ];
  const results = [];
  for (const write of writes) {
    await quiesce();
    let writeArgs;
    try {
      writeArgs = await write.args();
    } catch (error) {
      results.push({
        write: write.name,
        error: String(error.message).slice(0, 200),
        reruns: 0,
        readDocs: 0,
        readBytes: 0,
        execMs: 0,
        byFunction: {},
      });
      continue;
    }
    await quiesce();
    const started = Date.now();
    const before = new Map(latest);
    const outcome = await invoke(target, "mutation", write.fn, writeArgs);
    await quiesce();
    // A re-run that falls back to scanning/reset makes the client restart its
    // chain: replay that chain and count it as follow-up work.
    const followStarted = Date.now();
    const followFns = new Set();
    for (const scenario of subscribed) {
      const now = latest.get(scenario);
      if (!scenario.settle || now === before.get(scenario)) continue;
      if (now?.status !== "scanning" && now?.status !== "reset") continue;
      followFns.add(scenario.fn);
      await settledArgs(scenario);
    }
    const followUps = followFns.size
      ? logs.entries.filter(
          (entry) =>
            followFns.has(entry.identifier) &&
            entry.caller === "HttpApi" &&
            !entry.cachedResult &&
            entry.executionTimestamp * 1000 >= followStarted,
        )
      : [];

    const reruns = logs.entries.filter(
      (entry) =>
        entry.udfType === "Query" &&
        entry.caller !== "HttpApi" &&
        !entry.cachedResult &&
        entry.executionTimestamp * 1000 >= started,
    );
    const byFunction = {};
    for (const entry of reruns) {
      const row = (byFunction[entry.identifier] ??= {
        reruns: 0,
        readDocs: 0,
        readBytes: 0,
      });
      row.reruns++;
      row.readDocs += entry.usageStats.databaseReadDocuments;
      row.readBytes += entry.usageStats.databaseReadBytes;
    }
    results.push({
      write: write.name,
      ...(outcome.error ? { error: outcome.error } : {}),
      writeOk: outcome.value?.ok === true && !refusal(outcome.value),
      ...(refusal(outcome.value) ? { refused: refusal(outcome.value) } : {}),
      subscriptions: subscribed.length,
      reruns: reruns.length,
      readDocs: reruns.reduce(
        (sum, entry) => sum + entry.usageStats.databaseReadDocuments,
        0,
      ),
      readBytes: reruns.reduce(
        (sum, entry) => sum + entry.usageStats.databaseReadBytes,
        0,
      ),
      execMs: Number(
        reruns
          .reduce((sum, entry) => sum + entry.executionTime * 1000, 0)
          .toFixed(1),
      ),
      followUpRequests: followUps.length,
      followUpReadDocs: followUps.reduce(
        (sum, entry) => sum + entry.usageStats.databaseReadDocuments,
        0,
      ),
      byFunction,
    });
    const created = outcome.value?.value?.ids ?? outcome.value?.value;
    if (write.fn.endsWith("saveJobScans") && Array.isArray(created))
      await invoke(
        target,
        "mutation",
        "finishedGoods/jobScans:deleteJobScans",
        {
          warehouseId: ids.warehouseId,
          requestId: requestId("fanout-del"),
          ids: created.map((row) => row?._id ?? row),
        },
      );
  }
  for (const unsubscribe of unsubscribers) unsubscribe();
  await client.close();
  return results;
}

/** Concurrent workers saving job scans into the same warehouse. */
async function contend(target, name, fn, argsFor, workers) {
  const { logs } = target;
  const started = Date.now();
  // ConvexHttpClient queues mutations per client: one client per worker.
  const clients = Array.from({ length: workers }, () =>
    httpClient(target.deployment),
  );
  const outcomes = await Promise.all(
    Array.from({ length: workers }, (_, index) =>
      invoke(target, "mutation", fn, argsFor(index), clients[index]),
    ),
  );
  const overlapping = outcomes.some((a, i) =>
    outcomes.some(
      (b, j) => i !== j && a.started >= b.started && a.started < b.ended,
    ),
  );
  await sleep(1_000);
  const entries = logs.entries.filter(
    (entry) =>
      entry.identifier === fn && entry.executionTimestamp * 1000 >= started - 5,
  );
  const rtts = outcomes.map((outcome) => outcome.rtt).sort((a, b) => a - b);
  return {
    name,
    workers,
    failed: outcomes.filter(
      (outcome) => outcome.error || refusal(outcome.value),
    ).length,
    overlapping,
    executions: entries.length,
    occRetries: entries.filter((entry) => entry.occInfo || entry.willRetry)
      .length,
    occInfo: entries
      .filter((entry) => entry.occInfo)
      .map((entry) => entry.occInfo)
      .slice(0, 3),
    rttMsMax: Number(rtts.at(-1).toFixed(1)),
    rttMsP50: Number(rtts[Math.floor(workers / 2)].toFixed(1)),
  };
}

/** Concurrent writers in one warehouse; executions > workers means OCC retries. */
async function profileContention(target, workers = 8) {
  const scans = await contend(
    target,
    "saveJobScans",
    "finishedGoods/jobScans:saveJobScans",
    (index) => ({
      warehouseId: ids.warehouseId,
      requestId: requestId(`occ-${index}`),
      locationText: "PERF",
      items: [
        {
          factoryOrder: `FO6998${String(index).padStart(4, "0")}`,
          productBarcodeText: `PERF-OCC-${index}`,
          source: "MANUAL",
          quantity: 1,
        },
      ],
    }),
    workers,
  );
  const pallets = await contend(
    target,
    "createPallet (same product)",
    "finishedGoods/workflow:createPallet",
    (index) => ({
      warehouseId: ids.warehouseId,
      productId: ids.productId,
      requestId: requestId(`occ-pallet-${index}`),
    }),
    workers,
  );
  return [scans, pallets];
}

const scenarios = queryScenarios(ids).filter(
  (scenario) => !only?.length || only.includes(scenario.screen),
);
const loadBefore = loadavg();
const queries = [];
for (const scenario of scenarios) {
  const byTarget = await profileQuery(scenario);
  queries.push({
    screen: scenario.screen,
    fn: scenario.fn,
    label: scenario.label ?? "",
    ...(scenario.legacy ? { legacy: true } : {}),
    targets: byTarget,
  });
  console.log(
    [
      scenario.screen,
      scenario.fn + (scenario.label ? ` (${scenario.label})` : ""),
    ]
      .concat(
        Object.entries(byTarget).map(
          ([name, result]) =>
            `${name}: docs=${result.readDocs} bytes=${result.readBytes} exec=${result.execMsP50}ms req=${result.requests} ${result.lastError ?? ""}${result.resultCode ?? ""}`,
        ),
      )
      .join("  |  "),
  );
}
const perTarget = {};
for (const target of targets) {
  const flows = skip.has("flows") ? [] : await profileFlows(target);
  for (const flow of flows)
    console.log(
      target.name,
      "flow",
      flow.flow,
      JSON.stringify(
        flow.steps.map((step) => [
          step.fn,
          step.readDocs,
          step.writeDocs,
          step.execMsP50,
        ]),
      ),
      flow.note ?? "",
    );
  const fanout = skip.has("fanout")
    ? []
    : await profileFanout(target, scenarios);
  for (const row of fanout)
    console.log(
      target.name,
      "fanout",
      row.write,
      `ok=${row.writeOk}`,
      `reruns=${row.reruns}`,
      `docs=${row.readDocs}`,
      `bytes=${row.readBytes}`,
      row.error ?? "",
    );
  const contention = skip.has("contention")
    ? null
    : await profileContention(target);
  for (const row of contention ?? [])
    console.log(target.name, "contention", JSON.stringify(row));
  perTarget[target.name] = { flows, fanout, contention };
}
for (const target of targets) await target.logs.stop();

function convexDigest(root) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", "convex"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    try {
      hash.update(readFileSync(`${root}/${file}`));
    } catch {
      hash.update("<deleted>");
    }
  }
  return hash.digest("hex").slice(0, 16);
}
const git = (root, ...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
mkdirSync("output/perf", { recursive: true });
const report = {
  label,
  generatedAt: new Date().toISOString(),
  samples,
  restoredFrom: restore || null,
  loadAverage: { before: loadBefore, after: loadavg() },
  dataset: ids.counts,
  targets: await Promise.all(
    targets.map(async (target) => ({
      name: target.name,
      revision: git(target.root, "rev-parse", "HEAD"),
      dirty:
        git(target.root, "status", "--porcelain", "--", "convex").length > 0,
      // Content digest of the backend source that was deployed and measured.
      convexDigest: convexDigest(target.root),
      backend: (
        await (await fetch(`${target.deployment.url}/version`)).text()
      ).trim(),
    })),
  ),
  queries,
  perTarget,
};
writeFileSync(`output/perf/${label}.json`, JSON.stringify(report, null, 2));
console.log(`wrote output/perf/${label}.json`);
process.exit(0);
