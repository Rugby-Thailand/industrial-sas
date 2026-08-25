import type { ObservabilityEvent } from "./event";

export interface ObservabilityPort {
  /** Report one event. Must not throw, must not block, must not retry forever. */
  readonly record: (event: ObservabilityEvent) => void;
}

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
        write(JSON.stringify({ observability: event }));
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
