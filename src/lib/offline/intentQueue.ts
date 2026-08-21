/**
 * The degraded-online intent queue (`ADR-0009`, `FF-P1-12`).
 *
 * A pure data structure. It holds intents, it does not send them: sending needs
 * a Convex client, and a queue that owned one could not be tested without a
 * deployment. The caller drains it.
 *
 * ### What it refuses to do
 *
 * - **It never queues a blocked command.** The classification is code-owned and
 *   shared with the server (`convex/model/platform/commandClassification.ts`),
 *   so a screen cannot decide for itself that a posting is safe to defer.
 * - **It never reports a queued intent as done** (`INV-0009-02`). The states are
 *   `PENDING`, `SENDING`, and `FAILED`; there is deliberately no `SUCCEEDED`,
 *   because a successful intent leaves the queue and the *server's* answer is
 *   what the screen shows.
 * - **It never re-mints a request ID.** The ID is assigned when the operator
 *   acts, and every retry carries the same one, which is what makes a replay a
 *   replay rather than a second write (`INV-0009-01`, `INV-0009-05`).
 * - **It never grows without bound.** Past the cap the *oldest* pending intent
 *   is dropped and reported, because silently discarding the newest would lose
 *   the work the operator just did, and silently discarding anything at all
 *   would be the "pending forever" state operators cannot distinguish from a
 *   broken app.
 */
import {
  classifyCommand,
  decideDispatch,
  type ConnectionState,
  type DispatchDecision,
} from "../../../convex/model/platform/commandClassification";

export type { ConnectionState, DispatchDecision };

/** How many intents one browser may hold. Small: this is a stopgap, not storage. */
export const MAX_QUEUED_INTENTS = 50;

export type QueuedIntentState = "PENDING" | "SENDING" | "FAILED";

export interface QueuedIntent {
  /** Assigned when the operator acted, and never regenerated. */
  readonly requestId: string;
  readonly operation: string;
  /** The command's arguments, opaque to the queue. */
  readonly args: Readonly<Record<string, unknown>>;
  /** When the operator acted, in epoch milliseconds. */
  readonly capturedAt: number;
  readonly state: QueuedIntentState;
  /** How many send attempts have been made. */
  readonly attempts: number;
  /** The structured failure code of the last attempt, when there was one. */
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

/** What `submitIntent` decided, and the queue that resulted. */
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

/**
 * Offer one intent to the queue.
 *
 * `SEND` means the caller should call the server now. `QUEUED` means it is held
 * and must be rendered as pending. `BLOCKED` means the operator has to wait or
 * use the sanctioned fallback — the queue is unchanged, so nothing about a
 * refused action is remembered as if it might still happen.
 *
 * Re-offering an intent whose `requestId` is already queued is idempotent: the
 * queue keeps the original, because the original carries the capture time and
 * the attempt count.
 */
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

  /*
   * Never evict an in-flight intent. Once a request is marked `SENDING`, the
   * browser no longer knows whether the server accepted it until that attempt
   * settles. Dropping it here would discard the only request ID that can safely
   * resolve that uncertainty. Prefer the oldest intent that is still pending or
   * failed; if every slot is in flight, refuse the new intent visibly.
   */
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

/**
 * The next intent to try, oldest first.
 *
 * Oldest first because the operator did them in that order and a queue that
 * replayed newest-first would show them completing backwards. `FAILED` intents
 * are included: a retry is the point.
 */
export function nextIntent(queue: IntentQueue): QueuedIntent | null {
  return queue.intents.find((intent) => intent.state !== "SENDING") ?? null;
}

/** Mark an intent as in flight, so a second drain does not send it twice. */
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

/**
 * Remove an intent the server accepted.
 *
 * There is no "succeeded" state to move it to. A committed intent is the
 * server's fact now, and leaving a local copy that says so is exactly the
 * optimistic cache `INV-0009-04` forbids.
 */
export function settleIntent(
  queue: IntentQueue,
  requestId: string,
): IntentQueue {
  return frozen(
    queue.intents.filter((intent) => intent.requestId !== requestId),
    queue.dropped,
  );
}

/** Record a failed attempt, keeping the intent and its original request ID. */
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

/** Discard an intent the operator abandoned. */
export const discardIntent = settleIntent;

/** How many intents are waiting, for the pending badge. */
export const pendingCount = (queue: IntentQueue): number =>
  queue.intents.filter((intent) => intent.state !== "SENDING").length;

/**
 * Whether a command may be attempted at all right now, for a button's disabled
 * state and its explanation.
 *
 * A screen calls this to decide what to render *before* the operator taps,
 * which is the difference between a disabled control with a reason and a tap
 * that fails.
 */
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
