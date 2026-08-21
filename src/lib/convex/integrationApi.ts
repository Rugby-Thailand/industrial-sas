import { makeFunctionReference } from "convex/server";

import type { TenantOutcome } from "./ledgerApi";
import type { MasterDataWriteOutcome } from "./masterDataApi";

export type IntegrationAdapterKind =
  "WEBHOOK" | "ERP" | "EMAIL" | "LINE" | "PRINTER";

export type IntegrationAdapterStatus = "ENABLED" | "DEGRADED" | "DISABLED";

export interface IntegrationHealthRow {
  readonly adapterId: string;
  readonly code: string;
  readonly displayName: string;
  readonly kind: IntegrationAdapterKind;
  readonly status: IntegrationAdapterStatus;
  readonly pending: number;
  readonly retrying: number;
  readonly delivering: number;
  readonly deadLetter: number;
  readonly lastSuccessAt?: number;
  readonly lastFailureAt?: number;
  readonly lastFailureCode?: string;
  readonly complete: boolean;
}

export interface IntegrationHealthPayload {
  readonly adapters: readonly IntegrationHealthRow[];
  readonly complete: boolean;
  readonly asOf: number;
}

type WriteResult = TenantOutcome<MasterDataWriteOutcome>;

export const listIntegrationHealthRef = makeFunctionReference<
  "query",
  Record<string, never>,
  TenantOutcome<IntegrationHealthPayload>
>("integrations/delivery:listIntegrationHealth");

export const registerIntegrationAdapterRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly code: string;
    readonly displayName: string;
    readonly kind: IntegrationAdapterKind;
    readonly configurationKey: string;
  },
  WriteResult
>("integrations/delivery:registerAdapter");

export const setIntegrationAdapterStatusRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly adapterId: string;
    readonly status: "ENABLED" | "DISABLED";
  },
  WriteResult
>("integrations/delivery:setAdapterStatus");

export const retryIntegrationMessageRef = makeFunctionReference<
  "mutation",
  {
    readonly requestId: string;
    readonly messageId: string;
  },
  WriteResult
>("integrations/delivery:retryMessage");
