import { sanitizeObservabilityEvent, type ObservabilityEvent } from "./event";
import { sentryObservabilityEvent } from "./sentryPolicy";

export interface ObservabilityPort {
  /** Report one event. Must not throw, must not block, must not retry forever. */
  readonly record: (event: ObservabilityEvent) => void;
}

// Destinations remain opt-in. Console is a development aid; Sentry activation
// also requires its reviewed account/configuration and a delivery check.
// Neither a configured sink nor a successful local test proves remote delivery
// (docs/operations/release-runbook.md).
export const OBSERVABILITY_SINKS = ["none", "console", "sentry"] as const;
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
  if (
    sink === "sentry" &&
    process.env.NEXT_PUBLIC_SENTRY_ENABLED === "1" &&
    process.env.NEXT_PUBLIC_SENTRY_DSN
  )
    return {
      record: (event) => {
        try {
          if (event.code === "web.vital") return;
          const safe = sentryObservabilityEvent(event);
          void import("./sentryClient")
            .then((module) => module.recordSentryEvent(safe))
            .catch(() => {});
        } catch {
          // Telemetry failure must not change an application operation.
        }
      },
    };
  return sink === "console"
    ? createConsoleObservabilityPort()
    : nullObservabilityPort;
}
