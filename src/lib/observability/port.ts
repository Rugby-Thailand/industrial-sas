/**
 * `ObservabilityPort` (`INT-05`) and the two adapters this repository is allowed
 * to have.
 *
 * ### Why there is no Sentry adapter
 *
 * Plan §10 Phase 1 lists "Sentry" among the deliverables, and it is not here.
 * A vendor adapter needs a DSN, a project, and a data-processing agreement with
 * a subprocessor that has to appear in the tenant's register (`ADR-0012` §15) —
 * none of which exists. Writing one now would mean either a placeholder DSN
 * that silently drops every event, or a real one pointing at an account nobody
 * has agreed to. Both are worse than the honest gap.
 *
 * What *is* here is the seam. `ObservabilityPort` is one method; a vendor
 * adapter is a file that implements it and a line in `resolveObservabilityPort`.
 * The events, the redaction, and the call sites are all real, so the day the
 * subprocessor is approved the change is additive.
 *
 * ### The two adapters
 *
 * - **`none`** — discards. The default, and the only correct default: an
 *   unconfigured environment must not write telemetry to a place nobody chose.
 * - **`console`** — writes one JSON line per event to the browser console.
 *   Structured on purpose, so it can be piped into anything, and never
 *   interpolated into a message, so it cannot be mistaken for prose.
 *
 * ### Never throws, never awaits
 *
 * `record` returns `void` and swallows its own failures. A telemetry sink that
 * can fail an operator's scan is a defect; a lost event is an inconvenience.
 */
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

/** Discards every event. The default. */
export const nullObservabilityPort: ObservabilityPort = Object.freeze({
  record: () => undefined,
});

/**
 * One JSON line per event.
 *
 * `console.info` rather than `console.error` even for an `error` severity: the
 * browser's error channel is where uncaught exceptions go, and mixing a
 * deliberate telemetry record into it makes both harder to read. The severity
 * is a field.
 */
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

/**
 * Pick an adapter from a sink name.
 *
 * An unrecognized name resolves to `none` rather than throwing, because this
 * runs during application start-up and a typo in an environment variable must
 * not be a blank screen. The environment guard is what turns that typo into a
 * build failure instead.
 */
export function resolveObservabilityPort(
  sink: string | undefined,
): ObservabilityPort {
  return sink === "console"
    ? createConsoleObservabilityPort()
    : nullObservabilityPort;
}
