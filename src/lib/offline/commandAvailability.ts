/**
 * From a connection status to "may this command be attempted, and what do we
 * tell the operator if not" (`ADR-0009`, `FF-P1-12`).
 *
 * A pure function, separate from the queue and from React, because it is the
 * translation between two vocabularies that already exist: the shell's
 * `ConnectionStatus` (`src/lib/convex/connection.ts`), which knows about
 * an unconfigured deployment, and the code-owned dispatch
 * decision (`convex/model/platform/commandClassification.ts`), which knows
 * whether a command may be deferred.
 *
 * An unconfigured application is treated as disconnected and fails closed.
 */
import type { ConnectionStatus } from "../convex/connection";

import { describeAvailability, type ConnectionState } from "./intentQueue";

/** How the shell's status reads to a command that must reach the server. */
export function connectionStateOf(status: ConnectionStatus): ConnectionState {
  switch (status) {
    case "CONNECTED":
      return "CONNECTED";
    case "DISCONNECTED":
    case "NOT_CONFIGURED":
      return "DISCONNECTED";
    case "CONNECTING":
      return "UNKNOWN";
  }
}

export interface CommandAvailability {
  readonly available: boolean;
  readonly queueable: boolean;
  /** A translation key under `OperatorWork.blockReason`, or `null` when sendable. */
  readonly reasonCode: string | null;
}

/** What a control should do about one command, given the shell's status. */
export function availabilityFor(input: {
  readonly operation: string;
  readonly status: ConnectionStatus;
  readonly referenceDataStale?: boolean;
}): CommandAvailability {
  return describeAvailability({
    operation: input.operation,
    connection: connectionStateOf(input.status),
    ...(input.referenceDataStale === undefined
      ? {}
      : { referenceDataStale: input.referenceDataStale }),
  });
}
