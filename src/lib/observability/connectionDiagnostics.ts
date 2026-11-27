import {
  MAX_CONNECTION_DURATION_SEC,
  MAX_CONNECTION_EPISODES,
  MAX_CONNECTION_RETRIES,
  normalizeRoute,
} from "./dimensions";
import { observabilityEvent, type ObservabilityEvent } from "./event";
import type { ObservabilityPort } from "./port";

type ConnectionStallOutcome = "ongoing" | "recovered";
type ConnectionStallPhase = "first" | "dropped";

interface ConnectionStallSample {
  readonly phase: ConnectionStallPhase;
  readonly outcome: ConnectionStallOutcome;
  readonly foreground: boolean;
  readonly backgrounded: boolean;
  readonly offline: boolean;
  readonly writesPending: boolean;
  readonly retries: number;
  readonly durationSec: number;
  readonly episodes: number;
  readonly route?: string;
}

export function connectionStallEvent(
  sample: ConnectionStallSample,
  occurredAt: number,
): ObservabilityEvent {
  const normalizedRoute =
    sample.route === undefined
      ? undefined
      : normalizeRoute(sample.route.split(/[?#]/, 1)[0]);
  return observabilityEvent({
    code: "connection.stall",
    severity: sample.outcome === "ongoing" ? "warning" : "info",
    dimensions: {
      phase: sample.phase,
      outcome: sample.outcome,
      foreground: sample.foreground,
      backgrounded: sample.backgrounded,
      offline: sample.offline,
      writesPending: sample.writesPending,
      retries: Math.min(sample.retries, MAX_CONNECTION_RETRIES),
      durationSec: Math.min(sample.durationSec, MAX_CONNECTION_DURATION_SEC),
      episodes: Math.min(sample.episodes, MAX_CONNECTION_EPISODES),
      ...(normalizedRoute === undefined ? {} : { route: normalizedRoute }),
    },
    occurredAt,
  });
}

type ConnectionSample = {
  isWebSocketConnected: boolean;
  hasEverConnected: boolean;
  connectionRetries?: number;
  inflightMutations?: number;
};

interface Episode {
  phase: "first" | "dropped";
  startedAt: number;
  graceMs: number;
  reported: boolean;
  backgrounded: boolean;
  offline: boolean;
  writesPending: boolean;
  retries: number;
}

/** Shares the shell's socket subscription and stall timer. Only opt-in sinks instantiate this. */
export function createConnectionDiagnostics(
  port: ObservabilityPort,
  firstGraceMs: number,
  reconnectGraceMs: number,
) {
  let current: Episode | undefined;
  let episodes = 0;

  function sampleBrowser() {
    if (!current) return;
    current.backgrounded ||= document.visibilityState !== "visible";
    current.offline ||= navigator.onLine === false;
  }

  function report(outcome: ConnectionStallOutcome) {
    if (!current || (outcome === "ongoing" && current.reported)) return;
    if (!current.reported) {
      if (episodes >= MAX_CONNECTION_EPISODES) return;
      episodes++;
      current.reported = true;
    }
    sampleBrowser();
    port.record(
      connectionStallEvent(
        {
          phase: current.phase,
          outcome,
          foreground: document.visibilityState === "visible",
          backgrounded: current.backgrounded,
          offline: current.offline,
          writesPending: current.writesPending,
          retries: current.retries,
          durationSec: Math.floor(
            (performance.now() - current.startedAt) / 1000,
          ),
          episodes,
          route: window.location.pathname,
        },
        Date.now(),
      ),
    );
  }

  function observe(state: ConnectionSample) {
    if (state.isWebSocketConnected) {
      // A suspended page can receive the recovery before its stall timer runs.
      if (
        current &&
        (current.reported ||
          performance.now() - current.startedAt >= current.graceMs)
      )
        report("recovered");
      current = undefined;
      return;
    }
    current ??= {
      phase: state.hasEverConnected ? "dropped" : "first",
      startedAt: performance.now(),
      graceMs: state.hasEverConnected ? reconnectGraceMs : firstGraceMs,
      reported: false,
      backgrounded: false,
      offline: false,
      writesPending: false,
      retries: 0,
    };
    current.writesPending ||= (state.inflightMutations ?? 0) > 0;
    current.retries = Math.max(current.retries, state.connectionRetries ?? 0);
    sampleBrowser();
  }

  return { observe, sampleBrowser, stalled: () => report("ongoing") };
}
