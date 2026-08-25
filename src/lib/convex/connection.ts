import type { AppEnvironment } from "../environment";

export interface ServerAcknowledgement {
  readonly isWebSocketConnected: boolean;
  readonly hasEverConnected: boolean;
}

export type ConnectionStatus =
  "NOT_CONFIGURED" | "CONNECTING" | "CONNECTED" | "DISCONNECTED";

export function classifyConnection(
  environment: AppEnvironment,
  acknowledgement: ServerAcknowledgement | undefined,
): ConnectionStatus {
  if (!environment.backendConfigured) return "NOT_CONFIGURED";
  if (acknowledgement === undefined) return "CONNECTING";
  if (acknowledgement.isWebSocketConnected) return "CONNECTED";
  return acknowledgement.hasEverConnected ? "DISCONNECTED" : "CONNECTING";
}

export const isServerHealthy = (status: ConnectionStatus): boolean =>
  status === "CONNECTED";
