import { sanitizeObservabilityEvent, type ObservabilityEvent } from "./event";

export interface ObservabilityPort {
  /** Report one event. Must not throw, must not block, must not retry forever. */
  readonly record: (event: ObservabilityEvent) => void;
}

// Durable telemetry is deliberately absent (BD-12). `console` writes to the
// browser console of the person using the app; it is a development aid, not
// a central destination, and nothing here proves delivery anywhere. A future
// destination is added as a new sink only after its owner, data-processor
// review and delivery check exist (docs/operations/release-runbook.md).
export const OBSERVABILITY_SINKS = ["none", "console"] as const;
export type ObservabilitySink = (typeof OBSERVABILITY_SINKS)[number];

export const isObservabilitySink = (
  value: unknown,
): value is ObservabilitySink =>
  typeof value === "string" &&
  (OBSERVABILITY_SINKS as readonly string[]).includes(value);

export const nullObservabilityPort: ObservabilityPort = Object.freeze({
  record: () => undefined,
});

export function createConsoleObservabilityPort(
  write: (line: string) => void = (line) => console.info(line),
): ObservabilityPort {
  return Object.freeze({
    record: (event: ObservabilityEvent) => {
      try {
        // Re-apply the dimension allowlist: a sink never trusts its caller.
        write(
          JSON.stringify({ observability: sanitizeObservabilityEvent(event) }),
        );
      } catch {
        // A sink that throws is a sink that is not there. See the module note.
      }
    },
  });
}

export function resolveObservabilityPort(
  sink: string | undefined,
): ObservabilityPort {
  return sink === "console"
    ? createConsoleObservabilityPort()
    : nullObservabilityPort;
}
