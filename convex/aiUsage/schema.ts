import { defineTable } from "convex/server";
import { v } from "convex/values";
import { byOrg, tenantFields } from "../lib/tenantTable";
import {
  feature,
  status,
  usageFields,
  metricFields,
} from "../model/aiUsage/usage";

const dimensions = {
  feature,
  environment: v.string(),
  actorUserId: v.id("users"),
  warehouseId: v.optional(v.id("warehouses")),
  requestedModel: v.string(),
  utcDay: v.number(),
};
export const aiUsageTables = {
  aiUsageEvents: defineTable(
    tenantFields({
      ...dimensions,
      operationId: v.string(),
      attemptNo: v.number(),
      provider: v.literal("OPENROUTER"),
      billingAccountRef: v.string(),
      startedAt: v.number(),
      finishedAt: v.optional(v.number()),
      durationMs: v.number(),
      status,
      httpStatus: v.optional(v.number()),
      errorCode: v.optional(v.string()),
      ...usageFields,
    }),
  )
    .index("by_orgId_operationId_attemptNo", byOrg("operationId", "attemptNo"))
    .index("by_orgId_providerGenerationId", byOrg("providerGenerationId"))
    .index("by_orgId_utcDay_startedAt", byOrg("utcDay", "startedAt")),
  aiUsageOperations: defineTable(
    tenantFields({
      ...dimensions,
      operationId: v.string(),
      startedAt: v.number(),
      durationMs: v.number(),
      status,
      attemptCount: v.number(),
      knownCostUsdNano: v.number(),
      unknownAttemptCount: v.number(),
      jobScanId: v.optional(v.id("finishedGoodsJobScans")),
    }),
  )
    .index("by_orgId_operationId", byOrg("operationId"))
    .index("by_orgId_utcDay_startedAt", byOrg("utcDay", "startedAt")),
  aiUsageDailySummaries: defineTable(
    tenantFields({ ...dimensions, summaryKey: v.string(), ...metricFields }),
  )
    .index("by_orgId_summaryKey", byOrg("summaryKey"))
    .index("by_orgId_utcDay", byOrg("utcDay")),
  aiCostSettings: defineTable(
    tenantFields({
      version: v.number(),
      effectiveAt: v.number(),
      usdThbRate: v.number(),
      feePercent: v.number(),
      source: v.string(),
      createdByUserId: v.id("users"),
    }),
  ).index("by_orgId_version", byOrg("version")),
};
