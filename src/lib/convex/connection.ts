/**
 * Connectivity, as the product defines it (`ADR-0009`).
 *
 * `INV-0009-07` is explicit: connectivity state is derived from *actual server
 * acknowledgement*, not from `navigator.onLine`. That is not pedantry — a
 * captive portal, a dead uplink, and a warehouse access point that associates but
 * routes nowhere all report `onLine: true`, and each of them is a shift where an
 * operator scans into a void. So this module reads the Convex client's own
 * WebSocket state, which is only `true` once a socket reached "ready" with the
 * backend on the other end.
 *
 * `hasEverConnected` is what separates "connecting" from "disconnected", and the
 * distinction matters to an operator: the first is a normal page load, the second
 * is a fault they may need to act on. Without it, a first paint and a dropped
 * link would show the same words.
 *
 * What this module does **not** decide is which operations stop. Blocking
 * correctness-sensitive work while disconnected (`INV-0009-03`) belongs with the
 * write flows, and there are none in this milestone — a read that fails is
 * visible as a failure and posts nothing.
 */
import type { AppEnvironment } from "../environment";

/** The subset of Convex's `ConnectionState` this decision needs. */
export interface ServerAcknowledgement {
  readonly isWebSocketConnected: boolean;
  readonly hasEverConnected: boolean;
}

export type ConnectionStatus =
  "NOT_CONFIGURED" | "PREVIEW" | "CONNECTING" | "CONNECTED" | "DISCONNECTED";

/**
 * Classify the connection.
 *
 * Preview mode is reported first and by name. Reporting it as "connected" would
 * be the single most misleading thing this application could say: it would mean
 * an operator reads synthetic numbers under a badge claiming the server agrees.
 */
export function classifyConnection(
  environment: AppEnvironment,
  acknowledgement: ServerAcknowledgement | undefined,
): ConnectionStatus {
  if (environment.previewMode) return "PREVIEW";
  if (!environment.backendConfigured) return "NOT_CONFIGURED";
  if (acknowledgement === undefined) return "CONNECTING";
  if (acknowledgement.isWebSocketConnected) return "CONNECTED";
  return acknowledgement.hasEverConnected ? "DISCONNECTED" : "CONNECTING";
}

/**
 * Whether a status means the server is currently answering.
 *
 * Preview is deliberately **not** healthy. Nothing that gates a real operation
 * may ever be satisfied by synthetic data.
 */
export const isServerHealthy = (status: ConnectionStatus): boolean =>
  status === "CONNECTED";
