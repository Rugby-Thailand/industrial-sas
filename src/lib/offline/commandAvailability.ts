import type { ConnectionStatus } from "../convex/connection";

import { describeAvailability, type ConnectionState } from "./intentQueue";

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

  readonly reasonCode: string | null;
}

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
