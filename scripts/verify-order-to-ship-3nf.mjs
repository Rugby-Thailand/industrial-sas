#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

const DEFAULT_LIMIT = 1_000;
const MAX_LIMIT = 10_000;

const { deploymentArgs, limit } = parseArguments(process.argv.slice(2));
const inlineQuery = buildIntegrityQuery(limit);
const command = [
  "exec",
  "convex",
  "run",
  "--inline-query",
  inlineQuery,
  ...deploymentArgs,
];
const result = spawnSync("pnpm", command, {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  process.stderr.write(
    "Order-to-ship integrity check returned an unreadable response.\n",
  );
  process.stderr.write(result.stdout);
  process.exit(1);
}

process.stdout.write(
  `Order-to-ship 3NF integrity: ${report.passed ? "PASS" : "FAIL"}\n`,
);
process.stdout.write(
  `  ${report.counts.designRequests} design requests · ` +
    `${report.counts.factoryPackets} factory packets · ` +
    `${report.counts.factoryPacketFiles} packet/file relationships\n`,
);

if (!report.complete) {
  process.stderr.write(
    `  Incomplete: at least one table exceeded the ${limit}-row verification limit.\n`,
  );
}

for (const [name, count] of Object.entries(report.issues)) {
  if (count > 0) process.stderr.write(`  ${name}: ${count}\n`);
}

process.exitCode = report.passed ? 0 : 1;

function parseArguments(args) {
  const deploymentArgs = [];
  let limit = DEFAULT_LIMIT;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--prod") {
      deploymentArgs.push("--prod");
      continue;
    }
    if (argument === "--deployment") {
      const deployment = args[index + 1];
      if (deployment === undefined || deployment.startsWith("--")) {
        usage("--deployment requires a deployment reference");
      }
      deploymentArgs.push("--deployment", deployment);
      index += 1;
      continue;
    }
    if (argument === "--limit") {
      const requested = Number(args[index + 1]);
      if (
        !Number.isSafeInteger(requested) ||
        requested < 1 ||
        requested > MAX_LIMIT
      ) {
        usage(`--limit must be an integer from 1 to ${MAX_LIMIT}`);
      }
      limit = requested;
      index += 1;
      continue;
    }
    usage(`unknown argument: ${argument}`);
  }

  if (
    deploymentArgs.includes("--prod") &&
    deploymentArgs.includes("--deployment")
  ) {
    usage("use either --prod or --deployment, not both");
  }

  return { deploymentArgs, limit };
}

function usage(problem) {
  process.stderr.write(`${problem}\n`);
  process.stderr.write(
    "Usage: pnpm verify:order-to-ship-3nf [--prod | --deployment <ref>] [--limit <rows>]\n",
  );
  process.exit(2);
}

function buildIntegrityQuery(limit) {
  return `
const limit = ${limit};
const requestLegacyFields = ["customerId", "customerProductCode", "designKey", "specification"];
const packetLegacyFields = ["customerId", "customerOrderNumber", "customerReference", "revisionNumber", "specification", "approvedFileIds", "releaseEvidence", "quantity"];
const requestRows = await ctx.db.query("designRequests").take(limit + 1);
const packetRows = await ctx.db.query("factoryPackets").take(limit + 1);
const linkRows = await ctx.db.query("factoryPacketFiles").take(limit + 1);
const complete = requestRows.length <= limit && packetRows.length <= limit && linkRows.length <= limit;
const requests = requestRows.slice(0, limit);
const packets = packetRows.slice(0, limit);
const links = linkRows.slice(0, limit);
const issues = {
  legacyFields: 0,
  invalidRequestRelationships: 0,
  invalidPacketRelationships: 0,
  invalidPacketFileRelationships: 0,
  duplicateRequestPerLine: 0,
  duplicatePacketPerLine: 0,
  duplicatePacketFileRelationships: 0,
};
const seenRequests = new Set();
for (const request of requests) {
  if (requestLegacyFields.some((field) => Object.hasOwn(request, field))) issues.legacyFields += 1;
  const key = request.orgId + ":" + request.customerOrderLineId;
  if (seenRequests.has(key)) issues.duplicateRequestPerLine += 1;
  seenRequests.add(key);
  const line = await ctx.db.get(request.customerOrderLineId);
  const order = line === null ? null : await ctx.db.get(line.customerOrderId);
  if (line === null || order === null || line.orgId !== request.orgId || order.orgId !== request.orgId) {
    issues.invalidRequestRelationships += 1;
  }
}
const seenPackets = new Set();
for (const packet of packets) {
  if (packetLegacyFields.some((field) => Object.hasOwn(packet, field))) issues.legacyFields += 1;
  const key = packet.orgId + ":" + packet.customerOrderLineId;
  if (seenPackets.has(key)) issues.duplicatePacketPerLine += 1;
  seenPackets.add(key);
  const line = await ctx.db.get(packet.customerOrderLineId);
  const revision = await ctx.db.get(packet.masterCardRevisionId);
  const order = line === null ? null : await ctx.db.get(line.customerOrderId);
  if (line === null || revision === null || order === null || line.orgId !== packet.orgId || revision.orgId !== packet.orgId || order.orgId !== packet.orgId || line.masterCardRevisionId !== packet.masterCardRevisionId) {
    issues.invalidPacketRelationships += 1;
  }
}
const seenLinks = new Set();
for (const link of links) {
  const key = link.orgId + ":" + link.factoryPacketId + ":" + link.masterCardFileId;
  if (seenLinks.has(key)) issues.duplicatePacketFileRelationships += 1;
  seenLinks.add(key);
  const packet = await ctx.db.get(link.factoryPacketId);
  const file = await ctx.db.get(link.masterCardFileId);
  if (packet === null || file === null || packet.orgId !== link.orgId || file.orgId !== link.orgId || packet.masterCardRevisionId !== file.masterCardRevisionId) {
    issues.invalidPacketFileRelationships += 1;
  }
}
const passed = complete && Object.values(issues).every((count) => count === 0);
return {
  passed,
  complete,
  counts: {
    designRequests: requests.length,
    factoryPackets: packets.length,
    factoryPacketFiles: links.length,
  },
  issues,
};`;
}
