/**
 * Which commands may be queued while the link is down, and which must stop
 * (`ADR-0009` §4, `INV-0009-01`–`INV-0009-03`, plan §4 invariant 16).
 *
 * Status: **implemented as the code-owned classification.** The queue that
 * consumes it lives in the browser (`src/lib/offline/intentQueue.ts`); this
 * module is the single place that decides *what may go in it*, and it is
 * deliberately in `convex/model/**` rather than in `src/**` so the server and
 * the browser cannot disagree about a rule whose whole purpose is to keep the
 * ledger consistent.
 *
 * ### The rule, stated once
 *
 * A command is `QUEUEABLE` only when **both** of these hold:
 *
 * 1. It is idempotent under its `requestId` — replaying it commits once
 *    (`INV-0009-05`).
 * 2. Its correctness does not depend on stock, location, or QC state that the
 *    server may have changed while the device was away (`ADR-0009` §4).
 *
 * Everything else is `BLOCKED_OFFLINE`. There is no third value, and no
 * "queue it and we will see": a receipt posted from a queue against a lot that
 * was quarantined ten minutes earlier is exactly the conflict the ledger has no
 * way to resolve.
 *
 * Because the second condition is a property nobody can read off a function
 * signature, every entry states it as data — `dependsOnServerState` — and the
 * constructor refuses a `QUEUEABLE` entry that admits to either disqualifier.
 * A future command that is added carelessly therefore fails at module load,
 * which is a test failure rather than a warehouse incident.
 *
 * ### Why an unknown operation is blocked
 *
 * `classifyCommand` answers `BLOCKED_OFFLINE` for an operation it has never
 * heard of. Fail-closed is the only safe default here: the alternative is that
 * forgetting to classify a new posting command silently makes it queueable.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
import { isRecord, isString } from "../guards";

/* -------------------------------------------------------------------------- */
/* Classification                                                              */
/* -------------------------------------------------------------------------- */

/** The two — and only two — offline classes a command can hold. */
export type CommandClassification = "QUEUEABLE" | "BLOCKED_OFFLINE";

/**
 * One classified command.
 *
 * `reasonCode` is a stable key the UI translates, never a message: an operator
 * who is told "cannot be queued" deserves to know *why not* in their own
 * language, and D-06 puts that copy in `messages/`.
 */
export interface CommandDefinition {
  /** The operation name the command posts under, e.g. `work.task.claim`. */
  readonly operation: string;
  readonly classification: CommandClassification;
  /** True when a replay under the same `requestId` commits exactly once. */
  readonly idempotent: boolean;
  /** True when correctness depends on stock, location, QC, or lease state. */
  readonly dependsOnServerState: boolean;
  /** Stable translation key for why this command is blocked or queueable. */
  readonly reasonCode: string;
}

const define = (input: {
  readonly operation: string;
  readonly idempotent: boolean;
  readonly dependsOnServerState: boolean;
  readonly reasonCode: string;
}): CommandDefinition => {
  const classification: CommandClassification =
    input.idempotent && !input.dependsOnServerState
      ? "QUEUEABLE"
      : "BLOCKED_OFFLINE";
  return Object.freeze({ ...input, classification });
};

/**
 * The catalogue.
 *
 * Small on purpose. `ADR-0009` and plan §16 both say the queueable set is
 * expanded only when conflict ownership has been proved, so this list starts
 * with the commands whose correctness genuinely does not depend on server
 * state, and every stock-affecting command in the repository is named here
 * explicitly as blocked rather than left to the unknown-operation default —
 * a screen that wants to explain *why* the button is disabled needs a reason
 * code, and "we have never heard of this" is not one an operator can act on.
 */
export const COMMAND_CLASSIFICATIONS: readonly CommandDefinition[] =
  Object.freeze([
    define({
      operation: "platform.device.seen",
      idempotent: true,
      dependsOnServerState: false,
      reasonCode: "deviceSeenIsCorrelationOnly",
    }),
    /*
     * A heartbeat looks queueable — it is idempotent and writes no stock — and
     * it is deliberately not. A lease exists to say "somebody is holding this
     * right now", and a heartbeat replayed after twenty minutes in a dead zone
     * would assert a liveness the operator did not have, reviving a lease a
     * supervisor may already have reassigned. Queueing it would defeat the
     * thing it reports on.
     */
    define({
      operation: "work.task.heartbeat",
      idempotent: true,
      dependsOnServerState: true,
      reasonCode: "heartbeatProvesLivenessNow",
    }),
    /*
     * Evidence is append-only, but appending it requires holding the task, and
     * ownership is exactly the server state that changes while a device is
     * away. A queued entry would be refused on reconnect with
     * `TASK_NOT_HELD_BY_ACTOR` — correct, but an operator who was shown
     * "pending" for twenty minutes has been told the wrong thing.
     */
    define({
      operation: "work.evidence.record",
      idempotent: true,
      dependsOnServerState: true,
      reasonCode: "evidenceNeedsTaskLease",
    }),
    define({
      operation: "work.exception.report",
      idempotent: true,
      dependsOnServerState: true,
      reasonCode: "evidenceNeedsTaskLease",
    }),
    define({
      operation: "work.exception.resolve",
      idempotent: true,
      dependsOnServerState: true,
      reasonCode: "approvalNeedsFreshIdentity",
    }),
    define({
      operation: "work.attachment.authorizeUpload",
      idempotent: false,
      dependsOnServerState: true,
      reasonCode: "evidenceNeedsTaskLease",
    }),
    define({
      operation: "work.attachment.attach",
      idempotent: true,
      dependsOnServerState: true,
      reasonCode: "evidenceNeedsTaskLease",
    }),
    define({
      operation: "work.attachment.access",
      idempotent: false,
      dependsOnServerState: true,
      reasonCode: "privateFileNeedsFreshPermission",
    }),
    define({
      operation: "work.task.create",
      idempotent: false,
      dependsOnServerState: true,
      reasonCode: "createNeedsUniqueTaskNumber",
    }),
    define({
      operation: "work.task.claim",
      idempotent: false,
      dependsOnServerState: true,
      reasonCode: "claimRacesAnotherOperator",
    }),
    define({
      operation: "work.task.complete",
      idempotent: true,
      dependsOnServerState: true,
      reasonCode: "completionNeedsTaskLease",
    }),
    define({
      operation: "work.task.release",
      idempotent: true,
      dependsOnServerState: true,
      reasonCode: "releaseChangesTaskOwnership",
    }),
    define({
      operation: "work.task.reassign",
      idempotent: true,
      dependsOnServerState: true,
      reasonCode: "reassignChangesTaskOwnership",
    }),
    define({
      operation: "work.stepUp.approve",
      idempotent: true,
      dependsOnServerState: true,
      reasonCode: "approvalNeedsFreshIdentity",
    }),
    define({
      operation: "receiving.receipt.post",
      idempotent: true,
      dependsOnServerState: true,
      reasonCode: "postingReadsCurrentStock",
    }),
    define({
      operation: "putaway.task.claim",
      idempotent: false,
      dependsOnServerState: true,
      reasonCode: "claimRacesAnotherOperator",
    }),
    define({
      operation: "putaway.task.confirm",
      idempotent: true,
      dependsOnServerState: true,
      reasonCode: "postingReadsCurrentStock",
    }),
    define({
      operation: "quality.disposition.submit",
      idempotent: true,
      dependsOnServerState: true,
      reasonCode: "dispositionReadsCurrentQcState",
    }),
    define({
      operation: "quality.disposition.approve",
      idempotent: true,
      dependsOnServerState: true,
      reasonCode: "dispositionReadsCurrentQcState",
    }),
    define({
      operation: "inventory.transaction.post",
      idempotent: true,
      dependsOnServerState: true,
      reasonCode: "postingReadsCurrentStock",
    }),
    define({
      operation: "inventory.transaction.reverse",
      idempotent: true,
      dependsOnServerState: true,
      reasonCode: "reversalReadsCurrentStock",
    }),
  ]);

/*
 * The invariant the constructor cannot express on its own: a `QUEUEABLE` entry
 * must be idempotent and independent of server state. `define` derives the
 * classification from exactly those two flags, so this loop is what proves the
 * derivation was not bypassed by a later hand-written literal.
 */
for (const definition of COMMAND_CLASSIFICATIONS) {
  if (
    definition.classification === "QUEUEABLE" &&
    (!definition.idempotent || definition.dependsOnServerState)
  ) {
    throw new Error(
      `Command ${definition.operation} is QUEUEABLE but is not idempotent and state-independent.`,
    );
  }
}

const BY_OPERATION: ReadonlyMap<string, CommandDefinition> = new Map(
  COMMAND_CLASSIFICATIONS.map((definition) => [
    definition.operation,
    definition,
  ]),
);

/** The unknown-operation answer. Fail-closed; see the module note. */
export const UNKNOWN_COMMAND: CommandDefinition = Object.freeze({
  operation: "",
  classification: "BLOCKED_OFFLINE" as const,
  idempotent: false,
  dependsOnServerState: true,
  reasonCode: "commandNotClassified",
});

/** The classification of one operation. An unknown operation is blocked. */
export function classifyCommand(operation: string): CommandDefinition {
  if (!isString(operation)) return UNKNOWN_COMMAND;
  const found = BY_OPERATION.get(operation);
  return found ?? Object.freeze({ ...UNKNOWN_COMMAND, operation });
}

/** Convenience predicate over `classifyCommand`. */
export const isQueueable = (operation: string): boolean =>
  classifyCommand(operation).classification === "QUEUEABLE";

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How connected the client believes it is.
 *
 * Derived from an actual server acknowledgement rather than `navigator.onLine`
 * (`INV-0009-07`); `src/lib/convex/connection.ts` already owns that derivation
 * and this module only consumes its verdict.
 */
export type ConnectionState = "CONNECTED" | "DISCONNECTED" | "UNKNOWN";

export interface DispatchInput {
  readonly operation: string;
  readonly connection: ConnectionState;
  /**
   * True when the screen is rendering cached reference data whose freshness it
   * cannot vouch for (`INV-0009-06`). A correctness-sensitive command refuses
   * stale data even while connected, because "the read was old" and "the link
   * is down" are different failures with the same consequence.
   */
  readonly referenceDataStale?: boolean;
}

/**
 * What the client should do with an intent right now.
 *
 * `SEND` goes to the server. `QUEUE` is held with its `requestId` and rendered
 * as pending — never as done (`INV-0009-02`). `BLOCK` refuses, with a reason
 * the UI translates, and leaves the operator on the sanctioned fallback.
 */
export type DispatchDecision =
  | { readonly kind: "SEND" }
  | { readonly kind: "QUEUE"; readonly reasonCode: string }
  | { readonly kind: "BLOCK"; readonly reasonCode: string };

/**
 * Decide dispatch for one intent.
 *
 * `UNKNOWN` connectivity is treated as disconnected for a blocked command and
 * as sendable for a queueable one: the first attempt is what *establishes*
 * connectivity, and a queueable command that fails in flight is queued by the
 * caller rather than refused here. A blocked command optimistically sent into
 * an unknown link would show a spinner that resolves into a failure the
 * operator cannot distinguish from a refusal.
 */
export function decideDispatch(input: DispatchInput): DispatchDecision {
  if (!isRecord(input)) {
    return { kind: "BLOCK", reasonCode: UNKNOWN_COMMAND.reasonCode };
  }
  const definition = classifyCommand(input.operation);
  const connected = input.connection === "CONNECTED";

  if (definition.classification === "BLOCKED_OFFLINE") {
    if (!connected) {
      return { kind: "BLOCK", reasonCode: definition.reasonCode };
    }
    if (input.referenceDataStale === true) {
      return { kind: "BLOCK", reasonCode: "referenceDataStale" };
    }
    return { kind: "SEND" };
  }

  return connected
    ? { kind: "SEND" }
    : { kind: "QUEUE", reasonCode: definition.reasonCode };
}
