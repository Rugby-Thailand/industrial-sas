// Local Convex backend profiler helpers. Loopback deployments only.
//
// Every number reported here comes from the backend's own per-execution
// `usageStats` (the same feed the Convex dashboard's log view aggregates), plus
// client round-trip time measured around each call. Nothing is estimated.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { ConvexClient, ConvexHttpClient } from "convex/browser";

export function loadDeployment(root = process.cwd()) {
  const config = JSON.parse(
    readFileSync(`${root}/.convex/local/default/config.json`, "utf8"),
  );
  const url = `http://127.0.0.1:${config.ports.cloud}`;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url))
    throw Error("Profiler only runs against a loopback deployment");
  const fixture = JSON.parse(
    readFileSync(`${root}/output/local-test-data.json`, "utf8"),
  );
  return { url, adminKey: config.adminKey, fixture };
}

let nonce = 0;
/** Unique identity per call: an ignored claim makes every query a cache miss. */
export function identity(clerk, extra = {}) {
  nonce += 1;
  return {
    subject: clerk.userId,
    issuer: "https://local-profiler.invalid",
    tokenIdentifier: `profiler|${clerk.userId}|${nonce}`,
    org_id: clerk.orgId,
    perf_nonce: `${process.pid}-${nonce}`,
    ...extra,
  };
}

export function httpClient(deployment) {
  return new ConvexHttpClient(deployment.url);
}

export function wsClient(deployment, clerk) {
  const client = new ConvexClient(deployment.url, {
    unsavedChangesWarning: false,
  });
  client.setAdminAuth(deployment.adminKey, identity(clerk));
  return client;
}

/** Long-polls the backend's function log stream and keeps every completion. */
export function startLogCollector(deployment) {
  const entries = [];
  let cursor = Date.now() - 1;
  let stopped = false;
  let controller;
  const loop = (async () => {
    while (!stopped) {
      controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2_000);
      try {
        const response = await fetch(
          `${deployment.url}/api/stream_function_logs?cursor=${cursor}`,
          {
            headers: { Authorization: `Convex ${deployment.adminKey}` },
            signal: controller.signal,
          },
        );
        const body = await response.json();
        for (const entry of body.entries)
          if (entry.kind === "Completion") entries.push(entry);
        cursor = body.newCursor ?? cursor;
      } catch (error) {
        if (error.name !== "AbortError") throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  })();
  return {
    entries,
    /** Wait until the stream has caught up past `since` (ms epoch). */
    async settle(since = Date.now()) {
      for (let i = 0; i < 100; i++) {
        if (cursor >= since) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
    async stop() {
      stopped = true;
      controller?.abort();
      await loop;
    },
  };
}

export function cliData(table, limit = 500) {
  const raw = execFileSync(
    "pnpm",
    [
      "exec",
      "convex",
      "data",
      table,
      "--limit",
      String(limit),
      "--format",
      "jsonLines",
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 1 << 28,
    },
  );
  return raw
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
}

export const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
};
const median = (values) => quantile(values, 0.5);
const round = (value, digits = 2) =>
  value === null ? null : Number(value.toFixed(digits));

/** Summarize backend completions for one scenario. */
export function summarizeExecutions(executions, rtts = []) {
  const pick = (fn) => executions.map(fn);
  const usage = (key) => pick((entry) => entry.usageStats?.[key] ?? 0);
  return {
    n: executions.length,
    errors: executions.filter((entry) => entry.error).length,
    occRetries: executions.filter((entry) => entry.occInfo || entry.willRetry)
      .length,
    execMsP50: round(median(pick((entry) => entry.executionTime * 1000))),
    execMsP95: round(
      quantile(
        pick((entry) => entry.executionTime * 1000),
        0.95,
      ),
    ),
    userExecMsP50: round(
      median(pick((entry) => (entry.userExecutionTime ?? 0) * 1000)),
    ),
    rttMsP50: round(median(rtts)),
    readDocs: median(usage("databaseReadDocuments")),
    readBytes: median(usage("databaseReadBytes")),
    writeDocs: median(usage("databaseWriteDocuments")),
    writeBytes: median(usage("databaseWriteBytes")),
    writeIndexRows: median(usage("databaseWriteIndexRows")),
    returnBytes: median(pick((entry) => entry.returnBytes ?? 0)),
    memoryMb: median(usage("memoryUsedMb")),
  };
}
