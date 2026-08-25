import {
  classifyCommand,
  decideDispatch,
  type ConnectionState,
  type DispatchDecision,
} from "../../../convex/model/platform/commandClassification";

export type { ConnectionState, DispatchDecision };

export const MAX_QUEUED_INTENTS = 50;

export type QueuedIntentState = "PENDING" | "SENDING" | "FAILED";

export interface QueuedIntent {
  readonly requestId: string;
  readonly operation: string;

  readonly args: Readonly<Record<string, unknown>>;

  readonly capturedAt: number;
  readonly state: QueuedIntentState;

  readonly attempts: number;

  readonly lastErrorCode?: string;
}

export interface IntentQueue {
  readonly intents: readonly QueuedIntent[];
  /** Intents dropped because the cap was reached, oldest first. */
  readonly dropped: readonly QueuedIntent[];
}

export const emptyIntentQueue = (): IntentQueue =>
  Object.freeze({ intents: Object.freeze([]), dropped: Object.freeze([]) });

const frozen = (
  intents: readonly QueuedIntent[],
  dropped: readonly QueuedIntent[],
): IntentQueue =>
  Object.freeze({
    intents: Object.freeze([...intents]),
    dropped: Object.freeze([...dropped]),
  });

export type SubmitOutcome =
  | { readonly kind: "SEND"; readonly queue: IntentQueue }
  | {
      readonly kind: "QUEUED";
      readonly queue: IntentQueue;
      readonly reasonCode: string;
    }
  | {
      readonly kind: "BLOCKED";
      readonly queue: IntentQueue;
      readonly reasonCode: string;
    };

export function submitIntent(
  queue: IntentQueue,
  intent: {
    readonly requestId: string;
    readonly operation: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly capturedAt: number;
    readonly connection: ConnectionState;
    readonly referenceDataStale?: boolean;
  },
): SubmitOutcome {
  const decision = decideDispatch({
    operation: intent.operation,
    connection: intent.connection,
    ...(intent.referenceDataStale === undefined
      ? {}
      : { referenceDataStale: intent.referenceDataStale }),
  });

  if (decision.kind === "SEND") return { kind: "SEND", queue };
  if (decision.kind === "BLOCK") {
    return { kind: "BLOCKED", queue, reasonCode: decision.reasonCode };
  }

  const already = queue.intents.some(
    (queued) => queued.requestId === intent.requestId,
  );
  if (already) {
    return { kind: "QUEUED", queue, reasonCode: decision.reasonCode };
  }

  const queued: QueuedIntent = Object.freeze({
    requestId: intent.requestId,
    operation: intent.operation,
    args: intent.args,
    capturedAt: intent.capturedAt,
    state: "PENDING" as const,
    attempts: 0,
  });

  const next = [...queue.intents, queued];
  if (next.length <= MAX_QUEUED_INTENTS) {
    return {
      kind: "QUEUED",
      reasonCode: decision.reasonCode,
      queue: frozen(next, queue.dropped),
    };
  }

  const dropIndex = queue.intents.findIndex(
    (intent) => intent.state !== "SENDING",
  );
  if (dropIndex === -1) {
    return {
      kind: "BLOCKED",
      queue,
      reasonCode: "intentQueueFull",
    };
  }
  const dropped = next[dropIndex]!;
  const retained = next.filter((_intent, index) => index !== dropIndex);
  return {
    kind: "QUEUED",
    reasonCode: decision.reasonCode,
    queue: frozen(retained, [...queue.dropped, dropped]),
  };
}

export function nextIntent(queue: IntentQueue): QueuedIntent | null {
  return queue.intents.find((intent) => intent.state !== "SENDING") ?? null;
}

export function markSending(
  queue: IntentQueue,
  requestId: string,
): IntentQueue {
  return frozen(
    queue.intents.map((intent) =>
      intent.requestId === requestId
        ? Object.freeze({
            ...intent,
            state: "SENDING" as const,
            attempts: intent.attempts + 1,
          })
        : intent,
    ),
    queue.dropped,
  );
}

export function settleIntent(
  queue: IntentQueue,
  requestId: string,
): IntentQueue {
  return frozen(
    queue.intents.filter((intent) => intent.requestId !== requestId),
    queue.dropped,
  );
}

export function failIntent(
  queue: IntentQueue,
  requestId: string,
  errorCode: string,
): IntentQueue {
  return frozen(
    queue.intents.map((intent) =>
      intent.requestId === requestId
        ? Object.freeze({
            ...intent,
            state: "FAILED" as const,
            lastErrorCode: errorCode,
          })
        : intent,
    ),
    queue.dropped,
  );
}

export const discardIntent = settleIntent;

export const pendingCount = (queue: IntentQueue): number =>
  queue.intents.filter((intent) => intent.state !== "SENDING").length;

export function describeAvailability(input: {
  readonly operation: string;
  readonly connection: ConnectionState;
  readonly referenceDataStale?: boolean;
}): {
  readonly available: boolean;
  readonly queueable: boolean;
  readonly reasonCode: string | null;
} {
  const definition = classifyCommand(input.operation);
  const decision = decideDispatch(input);
  return {
    available: decision.kind !== "BLOCK",
    queueable: definition.classification === "QUEUEABLE",
    reasonCode: decision.kind === "SEND" ? null : decision.reasonCode,
  };
}
