import { makeFunctionReference, type DefaultFunctionArgs } from "convex/server";
import type { Infer } from "convex/values";
import type { TenantFunctionOutcome } from "../lib/tenantFunctions";
import type { connectionView, lineEvent } from "./validators";

type TenantActor = { orgId: string; actorId: string };
type TestTarget = { connectionId: string; groupId: string };

export type LineWebhookEvent = Infer<typeof lineEvent>;

function eventsQuery<Args extends DefaultFunctionArgs, Result>(name: string) {
  return makeFunctionReference<"query", Args, Result>(
    `customerLine/events:${name}`,
  );
}

function eventsMutation<Args extends DefaultFunctionArgs, Result>(
  name: string,
) {
  return makeFunctionReference<"mutation", Args, Result>(
    `customerLine/events:${name}`,
  );
}

export const lineViewer = makeFunctionReference<
  "query",
  Record<string, never>,
  TenantFunctionOutcome<{ canManageConnection: boolean }>
>("customerLine/groups:viewer");

export const authorizeConnection = eventsQuery<
  Record<string, never>,
  TenantActor | null
>("authorizeConnection");

export const saveConnection = eventsMutation<
  TenantActor & {
    botUserId: string;
    basicId: string;
    name: string;
    secretCiphertext: string;
    tokenCiphertext: string;
    webhookKey: string;
    primary?: boolean;
  },
  | { ok: true; connection: Infer<typeof connectionView> }
  | { ok: false; code: string }
>("saveConnection");

export const readConnectionTest = eventsQuery<
  TenantActor & TestTarget,
  {
    to: string;
    tokenCiphertext: string;
    revision: number;
    groupVersion: number;
  } | null
>("readConnectionTest");

export const finishConnectionTest = eventsMutation<
  TenantActor &
    TestTarget & {
      revision: number;
      groupVersion: number;
    },
  boolean
>("finishConnectionTest");

export const findConnection = eventsQuery<
  { webhookKey: string },
  {
    _id: string;
    botUserId: string;
    secretCiphertext: string;
    tokenCiphertext?: string;
    state: "setup" | "active";
    revision: number;
  } | null
>("findConnection");

export const acceptEvents = eventsMutation<
  {
    connectionId: string;
    revision: number;
    destination: string;
    events: LineWebhookEvent[];
  },
  { status: "ok" | "stale"; applied: number; skipped: number }
>("acceptEvents");

type JoinRef = { groupId: string; timestamp: number };

export const lookupGroupNames = makeFunctionReference<
  "action",
  { webhookKey: string; revision: number; groups: JoinRef[] },
  null
>("customerLine/transport:lookupGroupNames");

export const updateGroupNames = makeFunctionReference<
  "mutation",
  {
    connectionId: string;
    revision: number;
    names: (JoinRef & { name: string })[];
  },
  null
>("customerLine/transportGroupNames:updateGroupNames");

export const claimReply = eventsMutation<
  { questionId: string },
  {
    to: string;
    tokenCiphertext: string;
    text: string;
    retryKey: string;
    leaseId: string;
  } | null
>("claimReply");

export const authorizeReply = eventsQuery<
  { questionId: string; leaseId: string },
  boolean
>("authorizeReply");

export const finishReply = eventsMutation<
  {
    questionId: string;
    leaseId: string;
    state: "accepted" | "failed" | "unknown";
    acceptedRequestId?: string;
  },
  boolean
>("finishReply");

export const deliverReplyReference = makeFunctionReference<
  "action",
  { questionId: string },
  null
>("customerLine/transport:deliverReply");
