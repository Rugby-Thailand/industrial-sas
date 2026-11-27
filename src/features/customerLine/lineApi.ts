import { makeFunctionReference } from "convex/server";
import type { TenantFunctionOutcome } from "../../../convex/lib/tenantFunctions";

export type LineGroupState = "pending" | "active" | "paused" | "disconnected";
export type LineProviderDeparture = "pending" | "left" | "failed";
export type LineQuestionState =
  "open" | "queued" | "accepted" | "failed" | "unknown" | "canceled";
export type LineContactState = "observed" | "verified" | "revoked" | "left";
export type LineConnectionState = "setup" | "active" | "disconnected";

export interface LineViewer {
  readonly canRead: boolean;
  readonly canManageGroups: boolean;
  readonly canSend: boolean;
  readonly canManageConnection: boolean;
}

export interface LineGroup {
  readonly _id: string;
  readonly name: string;
  readonly state: LineGroupState;
  readonly customerId?: string;
  readonly customerName?: string;
  readonly version: number;
  readonly lastActivityAt: number;
  readonly providerDeparture?: LineProviderDeparture;
}

export interface LineQuestion {
  readonly _id: string;
  readonly text: string;
  readonly senderLabel: string;
  readonly createdAt: number;
  readonly state: LineQuestionState;
  readonly replyText?: string;
}

export interface LineContact {
  readonly _id: string;
  readonly name: string;
  readonly state: LineContactState;
}

export interface LinePrimaryConnectionSummary {
  readonly name: string;
  readonly basicId: string;
  readonly state: LineConnectionState;
}

export interface LinePrimaryConnection extends LinePrimaryConnectionSummary {
  readonly _id: string;
  readonly webhookPath: string;
  readonly identityVerifiedAt: number;
  readonly webhookVerifiedAt?: number;
  readonly testSentAt?: number;
}

export interface LinePage<T> {
  readonly page: readonly T[];
  readonly continueCursor: string | null;
}

export type LineMutationValue =
  | null
  | boolean
  | LinePrimaryConnection
  | {
      readonly ok?: boolean;
      readonly code?: string;
      readonly message?: string;
    };

export const CUSTOMER_LINE_PATH = "/master-data/customers/line";
export const CUSTOMER_LINE_SETTINGS_PATH =
  "/master-data/customers/line/settings";

export function customerLineGroupPath(
  groupId: string,
  customerId?: string,
): string {
  const path = `${CUSTOMER_LINE_PATH}/${encodeURIComponent(groupId)}`;
  return customerId ? `${path}?${new URLSearchParams({ customerId })}` : path;
}

/**
 * Typed Convex function references for `customerLine/*`.
 * Uses `makeFunctionReference` so UI compiles cleanly alongside concurrent backend codegen.
 */
export const customerLineRefs = {
  viewer: makeFunctionReference<
    "query",
    Record<string, never>,
    TenantFunctionOutcome<LineViewer>
  >("customerLine/groups:viewer"),
  listGroups: makeFunctionReference<
    "query",
    { readonly customerId?: string; readonly cursor?: string },
    TenantFunctionOutcome<LinePage<LineGroup>>
  >("customerLine/groups:listGroups"),
  listPendingGroups: makeFunctionReference<
    "query",
    { readonly cursor?: string },
    TenantFunctionOutcome<LinePage<LineGroup>>
  >("customerLine/groups:listPendingGroups"),
  getGroup: makeFunctionReference<
    "query",
    { readonly groupId: string },
    TenantFunctionOutcome<LineGroup | null>
  >("customerLine/groups:getGroup"),
  listQuestions: makeFunctionReference<
    "query",
    { readonly groupId: string; readonly cursor?: string },
    TenantFunctionOutcome<LinePage<LineQuestion>>
  >("customerLine/groups:listQuestions"),
  listContacts: makeFunctionReference<
    "query",
    { readonly groupId: string; readonly cursor?: string },
    TenantFunctionOutcome<LinePage<LineContact>>
  >("customerLine/groups:listContacts"),
  getPrimaryConnectionSummary: makeFunctionReference<
    "query",
    Record<string, never>,
    TenantFunctionOutcome<LinePrimaryConnectionSummary | null>
  >("customerLine/groups:getPrimaryConnectionSummary"),
  getPrimaryConnection: makeFunctionReference<
    "query",
    Record<string, never>,
    TenantFunctionOutcome<LinePrimaryConnection | null>
  >("customerLine/groups:getPrimaryConnection"),
  approveGroup: makeFunctionReference<
    "mutation",
    {
      readonly groupId: string;
      readonly customerId: string;
      readonly expectedVersion: number;
      readonly confirmed: true;
    },
    TenantFunctionOutcome<LineMutationValue>
  >("customerLine/groups:approveGroup"),
  setGroupState: makeFunctionReference<
    "mutation",
    {
      readonly groupId: string;
      readonly expectedVersion: number;
      readonly state: LineGroupState;
    },
    TenantFunctionOutcome<LineMutationValue | { readonly groupId: string }>
  >("customerLine/groups:setGroupState"),
  setContact: makeFunctionReference<
    "mutation",
    {
      readonly groupId: string;
      readonly contactId: string;
      readonly verified: boolean;
      readonly name?: string;
    },
    TenantFunctionOutcome<LineMutationValue>
  >("customerLine/groups:setContact"),
  queueReply: makeFunctionReference<
    "mutation",
    {
      readonly groupId: string;
      readonly questionId: string;
      readonly text: string;
      readonly confirmedAudience: true;
    },
    TenantFunctionOutcome<LineMutationValue>
  >("customerLine/groups:queueReply"),
  disconnectConnection: makeFunctionReference<
    "mutation",
    { readonly connectionId: string },
    TenantFunctionOutcome<LineMutationValue>
  >("customerLine/groups:disconnectConnection"),
  connectPrimary: makeFunctionReference<
    "action",
    { readonly channelSecret: string; readonly accessToken: string },
    TenantFunctionOutcome<LineMutationValue>
  >("customerLine/transport:connectPrimary"),
  testConnection: makeFunctionReference<
    "action",
    { readonly connectionId: string; readonly groupId: string },
    TenantFunctionOutcome<LineMutationValue>
  >("customerLine/transport:testConnection"),
} as const;

export const LINE_ERROR_CODES = [
  "DENIED",
  "FORBIDDEN",
  "VERSION_CONFLICT",
  "NOT_FOUND",
  "PROVIDER_LEFT",
  "CONNECTION_NOT_READY",
  "CONNECTION_NOT_FOUND",
  "GROUP_STALE",
  "GROUP_NOT_PENDING",
  "GROUP_DISCONNECTED",
  "GROUP_NOT_ACTIVE",
  "CUSTOMER_UNAVAILABLE",
  "INVALID_TRANSITION",
  "CONTACT_NOT_FOUND",
  "CONTACT_LEFT",
  "INVALID_NAME",
  "NAME_REQUIRED",
  "INVALID_TEXT",
  "QUESTION_NOT_FOUND",
  "DELIVERY_UNCERTAIN",
  "QUESTION_NOT_OPEN",
  "INVALID_STATE",
  "INVALID_INPUT",
  "INVALID_CREDENTIALS",
  "BOT_CONFLICT",
  "PROVIDER_ERROR",
  "LINE_CREDENTIALS_INVALID",
  "LINE_STORAGE_UNAVAILABLE",
  "LINE_PROVIDER_UNAVAILABLE",
  "LINE_BOT_VERIFICATION_FAILED",
  "LINE_CONNECTION_UNAVAILABLE",
  "LINE_TEST_TARGET_UNAVAILABLE",
  "LINE_TEST_UNCONFIRMED",
  "LINE_TEST_FAILED",
  "LINE_TEST_PROOF_UNAVAILABLE",
  "UNKNOWN",
] as const;

export type LineErrorCode = (typeof LINE_ERROR_CODES)[number];

export function normalizeLineErrorCode(code: unknown): LineErrorCode {
  if (typeof code === "string") {
    const normalized = code.trim().toUpperCase();
    if ((LINE_ERROR_CODES as readonly string[]).includes(normalized)) {
      return normalized as LineErrorCode;
    }
  }
  return "UNKNOWN";
}

export type LineWriteOutcome =
  { readonly ok: true } | { readonly ok: false; readonly code: LineErrorCode };

/**
 * Interprets a Convex `TenantFunctionOutcome` from `customerLine` mutations and actions.
 * Core mutation success returns `outcome.value === null`; any nested string `code`
 * (even without `ok: false`) or `ok: false` is treated as failure.
 */
export function readLineWriteOutcome(outcome: unknown): LineWriteOutcome {
  if (typeof outcome !== "object" || outcome === null) {
    return { ok: false, code: "UNKNOWN" };
  }
  const envelope = outcome as {
    ok?: unknown;
    value?: unknown;
    denial?: { code?: unknown };
  };
  if (envelope.ok !== true) {
    return { ok: false, code: "DENIED" };
  }
  const value = envelope.value;
  if (value === null || value === true || value === undefined) {
    return { ok: true };
  }
  if (typeof value === "object") {
    const record = value as { ok?: unknown; code?: unknown; error?: unknown };
    if (
      typeof record.code === "string" ||
      record.ok === false ||
      typeof record.error === "string"
    ) {
      return {
        ok: false,
        code: normalizeLineErrorCode(record.code ?? record.error),
      };
    }
    return { ok: true };
  }
  if (value === false) {
    return { ok: false, code: "UNKNOWN" };
  }
  return { ok: true };
}

function normalizeOrigin(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/u, "");
}

function deriveConvexSiteOrigin(
  convexUrl: string | undefined,
): string | undefined {
  const cleaned = normalizeOrigin(convexUrl);
  if (!cleaned) return undefined;
  try {
    const parsed = new URL(cleaned);
    if (parsed.hostname.endsWith(".convex.cloud")) {
      parsed.hostname = parsed.hostname.replace(
        /\.convex\.cloud$/u,
        ".convex.site",
      );
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

/**
 * Derives the full HTTPS webhook URL from `webhookPath` using `NEXT_PUBLIC_CONVEX_SITE_URL`,
 * falling back to the Convex deployment `.convex.site` host derived from `NEXT_PUBLIC_CONVEX_URL`.
 */
export function resolveLineWebhookUrl(
  webhookPath: string,
  options?: {
    readonly siteUrl?: string | undefined;
    readonly convexUrl?: string | undefined;
  },
): string {
  const normalizedPath = webhookPath.startsWith("/")
    ? webhookPath
    : `/${webhookPath}`;
  const explicitSite = normalizeOrigin(
    options?.siteUrl ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL,
  );
  if (explicitSite) return `${explicitSite}${normalizedPath}`;

  const derivedSite = deriveConvexSiteOrigin(
    options?.convexUrl ?? process.env.NEXT_PUBLIC_CONVEX_URL,
  );
  if (derivedSite) return `${derivedSite}${normalizedPath}`;

  return normalizedPath;
}
