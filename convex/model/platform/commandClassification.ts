import { isRecord, isString } from "../guards";

export type CommandClassification = "QUEUEABLE" | "BLOCKED_OFFLINE";

export interface CommandDefinition {
  readonly operation: string;
  readonly classification: CommandClassification;
  /** True when a replay under the same `requestId` commits exactly once. */
  readonly idempotent: boolean;

  readonly dependsOnServerState: boolean;

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

export const COMMAND_CLASSIFICATIONS: readonly CommandDefinition[] =
  Object.freeze([
    define({
      operation: "platform.device.seen",
      idempotent: true,
      dependsOnServerState: false,
      reasonCode: "deviceSeenIsCorrelationOnly",
    }),

    define({
      operation: "work.task.heartbeat",
      idempotent: true,
      dependsOnServerState: true,
      reasonCode: "heartbeatProvesLivenessNow",
    }),

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

export const UNKNOWN_COMMAND: CommandDefinition = Object.freeze({
  operation: "",
  classification: "BLOCKED_OFFLINE" as const,
  idempotent: false,
  dependsOnServerState: true,
  reasonCode: "commandNotClassified",
});

export function classifyCommand(operation: string): CommandDefinition {
  if (!isString(operation)) return UNKNOWN_COMMAND;
  const found = BY_OPERATION.get(operation);
  return found ?? Object.freeze({ ...UNKNOWN_COMMAND, operation });
}

export const isQueueable = (operation: string): boolean =>
  classifyCommand(operation).classification === "QUEUEABLE";

export type ConnectionState = "CONNECTED" | "DISCONNECTED" | "UNKNOWN";

export interface DispatchInput {
  readonly operation: string;
  readonly connection: ConnectionState;

  readonly referenceDataStale?: boolean;
}

export type DispatchDecision =
  | { readonly kind: "SEND" }
  | { readonly kind: "QUEUE"; readonly reasonCode: string }
  | { readonly kind: "BLOCK"; readonly reasonCode: string };

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
