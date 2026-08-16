import { makeFunctionReference } from "convex/server";

import type { WorkspaceSnapshot } from "@/lib/workspace/workspace";

import type { TenantOutcome } from "./ledgerApi";

export const WORKSPACE_FUNCTION_PATH = "workspace/current:readCurrent" as const;

export const readCurrentWorkspaceRef = makeFunctionReference<
  "query",
  Record<string, never>,
  TenantOutcome<WorkspaceSnapshot>
>(WORKSPACE_FUNCTION_PATH);
