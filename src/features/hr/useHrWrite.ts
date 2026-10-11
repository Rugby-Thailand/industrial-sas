"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { sessionPreferences } from "@/lib/browser/storage";

/**
 * The outcome of one HR write as the employee or reviewer should understand it.
 *
 * SAVED — the server confirmed persistence. REFUSED — the server definitely
 * did not apply it (business rule or rolled-back transaction). DENIED — no
 * permission. UNCERTAIN — the response was lost; the same request ID is kept
 * so a retry either replays the saved result or applies it exactly once.
 */
export type HrWriteState<Value> =
  | { readonly kind: "IDLE" }
  | { readonly kind: "PENDING" }
  | { readonly kind: "SAVED"; readonly value: Value }
  | { readonly kind: "REFUSED"; readonly code: string; readonly field?: string }
  | { readonly kind: "DENIED" }
  | { readonly kind: "UNCERTAIN" };

interface Outcome {
  readonly ok: boolean;
  readonly value?: unknown;
}

const STORAGE_PREFIX = "hr-request:";
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function errorCode(error: unknown): string | null {
  const data =
    typeof error === "object" && error !== null && "data" in error
      ? (error as { data: unknown }).data
      : null;
  return typeof data === "object" &&
    data !== null &&
    "code" in data &&
    typeof (data as { code: unknown }).code === "string"
    ? (data as { code: string }).code
    : null;
}

export function classifyOutcome<Value>(outcome: unknown): HrWriteState<Value> {
  const result = outcome as Outcome | null | undefined;
  if (result === null || typeof result !== "object")
    return { kind: "UNCERTAIN" };
  if (!result.ok) return { kind: "DENIED" };
  const value = result.value as
    | {
        written?: boolean;
        error?: { code?: string; field?: string };
      }
    | undefined;
  if (value?.written === true) return { kind: "SAVED", value: value as Value };
  if (value?.written === false)
    return {
      kind: "REFUSED",
      code: value.error?.code ?? "UNKNOWN",
      ...(value.error?.field === undefined ? {} : { field: value.error.field }),
    };
  return { kind: "UNCERTAIN" };
}

/**
 * One write intent (`scope`) with a stable request ID until the server gives
 * a definite answer. Duplicate submissions while pending are ignored.
 */
export function useHrWrite<Value = Record<string, unknown>>(intent: string) {
  // Intents are isolated per organization and signed-in actor, so a cached
  // request ID can never be reused by another account in the same tab.
  const identity = useHrAccess().identityKey ?? "anonymous";
  const scope = `${identity}|${intent}`;
  // State belongs to one intent: a different scope reads as IDLE without an
  // effect, while an uncertain request ID stays in session storage.
  const [entry, setEntry] = useState<{
    readonly scope: string;
    readonly state: HrWriteState<Value>;
  }>({ scope, state: { kind: "IDLE" } });
  const state: HrWriteState<Value> =
    entry.scope === scope ? entry.state : { kind: "IDLE" };
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(true);
  const currentScope = useRef(scope);
  // Memory copy, so a retry reuses the ID even when storage is unavailable.
  const remembered = useRef(new Map<string, string>());
  // The exact command sent for an intent whose outcome is uncertain. `submit`
  // and `retry` resend it verbatim (same payload, same request ID) until a
  // definite answer, even if the form changed meanwhile.
  const pinned = useRef(
    new Map<string, (requestId: string) => Promise<unknown>>(),
  );
  const key = `${STORAGE_PREFIX}${scope}`;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    currentScope.current = scope;
  }, [scope]);

  const requestId = useCallback(() => {
    const inMemory = remembered.current.get(key);
    if (inMemory !== undefined) return inMemory;
    const saved = sessionPreferences.read(
      key,
      (value) =>
        typeof value === "string" && ID_PATTERN.test(value) ? value : null,
      null,
    );
    const id = saved ?? crypto.randomUUID();
    remembered.current.set(key, id);
    if (saved === null) sessionPreferences.write(key, id);
    return id;
  }, [key]);

  /**
   * Send once per intent at a time. The returned state is IDLE when the user
   * has meanwhile moved to another record or left, so callers never apply a
   * late result (banner, navigation, download) to something else.
   */
  const run = useCallback(
    async (
      send: (requestId: string) => Promise<unknown>,
    ): Promise<HrWriteState<Value>> => {
      if (inFlight.current.has(key)) return { kind: "PENDING" };
      inFlight.current.add(key);
      const command = send;
      pinned.current.set(key, command);
      setEntry({ scope, state: { kind: "PENDING" } });
      let next: HrWriteState<Value>;
      try {
        next = classifyOutcome<Value>(await command(requestId()));
      } catch (error) {
        const code = errorCode(error);
        // A coded server error rolled the transaction back; anything else
        // (network, timeout, lost response) may or may not have applied.
        next =
          code === null ? { kind: "UNCERTAIN" } : { kind: "REFUSED", code };
      }
      if (next.kind !== "UNCERTAIN") pinned.current.delete(key);
      if (next.kind !== "UNCERTAIN" && next.kind !== "DENIED") {
        remembered.current.delete(key);
        sessionPreferences.remove(key);
      }
      inFlight.current.delete(key);
      const current = mounted.current && currentScope.current === scope;
      if (!current) return { kind: "IDLE" };
      setEntry({ scope, state: next });
      return next;
    },
    [key, requestId, scope],
  );

  /** Resend the pinned command after an uncertain outcome. */
  const retry = useCallback(async (): Promise<HrWriteState<Value>> => {
    const command = pinned.current.get(key);
    if (command === undefined) return { kind: "IDLE" };
    return await run(command);
  }, [key, run]);

  /**
   * The form entry point: a new command, unless an earlier one for this intent
   * is still uncertain — then that exact command is resent instead, so an
   * ordinary submit can never overwrite it.
   */
  const submit = useCallback(
    async (
      send: (requestId: string) => Promise<unknown>,
    ): Promise<HrWriteState<Value>> =>
      await run(pinned.current.get(key) ?? send),
    [key, run],
  );

  const reset = useCallback(
    () => setEntry({ scope, state: { kind: "IDLE" } }),
    [scope],
  );
  return {
    state,
    run,
    submit,
    retry,
    reset,
    pending: state.kind === "PENDING",
    /** Inputs stay fixed while pending or uncertain: the retry is verbatim. */
    locked: state.kind === "PENDING" || state.kind === "UNCERTAIN",
  };
}

/**
 * The only write payload persisted by this module. Clock mutations currently
 * accept {requestId, expectedBusinessDate}; employeeId + scope are replay guards, never
 * substitute for server authorization. Do not widen this to form evidence,
 * salary values, documents or generic mutation callbacks.
 */
export interface HrClockCommand {
  readonly kind: "CLOCK_IN" | "CLOCK_OUT";
  readonly employeeId: string;
  readonly expectedBusinessDate: string;
  readonly requestId: string;
}
interface StoredClockCommand extends HrClockCommand {
  readonly schema: 1;
  readonly scope: string;
}
const CLOCK_STORAGE_KEY = "hr-clock-command:v1";
const CLOCK_STORAGE_UNAVAILABLE = Symbol("clock-storage-unavailable");
// One tab-local fallback, containing only the same clock descriptor. This
// preserves exact retries even if session storage is blocked by the browser.
let clockFallback: StoredClockCommand | null = null;

function decodeClockCommand(value: unknown): StoredClockCommand | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",") !==
      "employeeId,expectedBusinessDate,kind,requestId,schema,scope" ||
    row.schema !== 1 ||
    typeof row.scope !== "string" ||
    !row.scope ||
    row.scope.length > 512 ||
    typeof row.employeeId !== "string" ||
    !row.employeeId ||
    row.employeeId.length > 128 ||
    typeof row.expectedBusinessDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.expectedBusinessDate) ||
    (row.kind !== "CLOCK_IN" && row.kind !== "CLOCK_OUT") ||
    typeof row.requestId !== "string" ||
    !ID_PATTERN.test(row.requestId)
  )
    return null;
  return {
    schema: 1,
    scope: row.scope,
    employeeId: row.employeeId,
    expectedBusinessDate: row.expectedBusinessDate,
    kind: row.kind,
    requestId: row.requestId,
  };
}
function readClockCommand(): StoredClockCommand | null {
  const record = sessionPreferences.read<
    StoredClockCommand | null | typeof CLOCK_STORAGE_UNAVAILABLE
  >(CLOCK_STORAGE_KEY, decodeClockCommand, CLOCK_STORAGE_UNAVAILABLE);
  // A readable empty/invalid record wins over memory (e.g. storage was cleared).
  return record === CLOCK_STORAGE_UNAVAILABLE ? clockFallback : record;
}
function clearClockCommand(scope: string) {
  const stored = readClockCommand();
  if (stored?.scope === scope || clockFallback?.scope === scope)
    sessionPreferences.remove(CLOCK_STORAGE_KEY);
  if (clockFallback?.scope === scope) clockFallback = null;
}
/** Run above the page gate, so logout also clears recovery after child unmount. */
export function clearHrClockRecoveryExcept(identity?: string) {
  const stored = readClockCommand();
  const keep = (scope: string) =>
    identity !== undefined && scope.startsWith(`${identity}|clock:`);
  if (stored && !keep(stored.scope)) clearClockCommand(stored.scope);
  if (clockFallback && !keep(clockFallback.scope))
    clearClockCommand(clockFallback.scope);
}

/**
 * Durable, strictly clock-only intent. Pending/reload recovery is uncertain,
 * never a fabricated receipt. Changing the organization/actor/employee clears
 * the old descriptor. Definite answers remove it; lost responses retain the
 * original kind + args + requestId across navigation/remount.
 */
export function useHrClockWrite<Value = Record<string, unknown>>(
  employeeId: string,
  businessDate: string,
  send: (command: HrClockCommand) => Promise<unknown>,
) {
  const identity = useHrAccess().identityKey ?? "anonymous";
  const scope = `${identity}|clock:${employeeId}`;
  const [entry, setEntry] = useState<{
    readonly scope: string;
    readonly command: StoredClockCommand | null;
    readonly state: HrWriteState<Value>;
  }>(() => {
    const stored = readClockCommand();
    const command =
      stored?.scope === scope && stored.employeeId === employeeId
        ? stored
        : null;
    return {
      scope,
      command,
      state: command ? { kind: "UNCERTAIN" } : { kind: "IDLE" },
    };
  });
  const current =
    entry.scope === scope
      ? entry
      : {
          scope,
          command: null,
          state: { kind: "IDLE" } as HrWriteState<Value>,
        };
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const currentScope = useRef(scope);
  const commandRef = useRef<StoredClockCommand | null>(current.command);
  const sendRef = useRef(send);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    currentScope.current = scope;
    commandRef.current = entry.scope === scope ? entry.command : null;
    sendRef.current = send;
    const stored = readClockCommand();
    if (
      clockFallback &&
      (clockFallback.scope !== scope || clockFallback.employeeId !== employeeId)
    )
      clearClockCommand(clockFallback.scope);
    if (
      stored &&
      (stored.scope !== scope || stored.employeeId !== employeeId)
    ) {
      clearClockCommand(stored.scope);
    }
  }, [employeeId, entry.command, entry.scope, scope, send]);
  const run = useCallback(
    async (kind?: HrClockCommand["kind"]): Promise<HrWriteState<Value>> => {
      if (inFlight.current) return { kind: "PENDING" };
      const retained =
        commandRef.current?.scope === scope ? commandRef.current : null;
      if (
        !retained &&
        (!kind || !employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate))
      )
        return { kind: "IDLE" };
      const command: StoredClockCommand = retained ?? {
        schema: 1,
        scope,
        employeeId,
        expectedBusinessDate: businessDate,
        kind: kind!,
        requestId: crypto.randomUUID(),
      };
      commandRef.current = command;
      clockFallback = command;
      sessionPreferences.write(CLOCK_STORAGE_KEY, command);
      inFlight.current = true;
      setEntry({ scope, command, state: { kind: "PENDING" } });
      let next: HrWriteState<Value>;
      try {
        // Project the strict API args: no storage metadata goes to the server.
        next = classifyOutcome<Value>(
          await sendRef.current({
            kind: command.kind,
            employeeId: command.employeeId,
            expectedBusinessDate: command.expectedBusinessDate,
            requestId: command.requestId,
          }),
        );
      } catch (error) {
        const code = errorCode(error);
        next =
          code === null ? { kind: "UNCERTAIN" } : { kind: "REFUSED", code };
      }
      inFlight.current = false;
      if (next.kind !== "UNCERTAIN") {
        clearClockCommand(scope);
        if (commandRef.current?.scope === scope) commandRef.current = null;
      }
      if (!mounted.current || currentScope.current !== scope)
        return { kind: "IDLE" };
      setEntry({
        scope,
        command: next.kind === "UNCERTAIN" ? command : null,
        state: next,
      });
      return next;
    },
    [businessDate, employeeId, scope],
  );
  const retry = useCallback(() => run(), [run]);
  return {
    state: current.state,
    command: current.command,
    submit: run,
    retry,
    pending: current.state.kind === "PENDING",
  };
}
