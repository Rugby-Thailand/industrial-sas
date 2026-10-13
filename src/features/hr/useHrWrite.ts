"use client";

import {
  useCallback,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { useOperationLifecycle } from "@/hooks/useOperationLifecycle";
import { sessionPreferences } from "@/lib/browser/storage";

type Send = (requestId: string) => Promise<unknown>;
type Recovery = {
  readonly operation: string;
  readonly requestId: string;
  readonly reconcile: (send: () => Promise<unknown>) => Promise<void>;
};

/** Only a definite server answer releases the original command identity. */
export type HrWriteState<Value> =
  | { readonly kind: "IDLE" }
  | { readonly kind: "PENDING" }
  | { readonly kind: "SAVED"; readonly value: Value }
  | { readonly kind: "REFUSED"; readonly code: string; readonly field?: string }
  | { readonly kind: "DENIED" }
  | {
      readonly kind: "UNCERTAIN";
      readonly recovery?: Recovery;
      readonly recoveryUnavailable?: boolean;
    }
  | { readonly kind: "RECONCILED"; readonly applied: boolean };

const IDLE = Object.freeze({ kind: "IDLE" } as const);
const STORAGE_PREFIX = "hr-request:";
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
interface RequestRecord {
  readonly version: 1;
  readonly requestId: string;
  readonly payload?: unknown;
  readonly operation?: string;
}
interface Owner {
  state: HrWriteState<unknown>;
  record?: RequestRecord | undefined;
  command?: Send | undefined;
  readonly listeners: Set<() => void>;
}
// A live request belongs to the command, not a mounted form. Remounting while
// its promise is pending subscribes to the same owner instead of sending twice.
const owners = new Map<string, Owner>();

function readRecord(key: string): RequestRecord | null | undefined {
  const record = sessionPreferences.read(
    key,
    (value) => {
      if (value === null) return null;
      if (typeof value === "string" && ID_PATTERN.test(value))
        return { version: 1 as const, requestId: value };
      if (
        typeof value === "object" &&
        value !== null &&
        "version" in value &&
        value.version === 1 &&
        "requestId" in value &&
        typeof value.requestId === "string" &&
        ID_PATTERN.test(value.requestId)
      )
        return value as RequestRecord;
      // Malformed recovery data is never interpreted as a fresh command.
      return { version: 1 as const, requestId: "" };
    },
    undefined,
  );
  return record === undefined && sessionPreferences.has(key)
    ? { version: 1, requestId: "" }
    : record;
}
function ownerFor(key: string): Owner {
  const saved = readRecord(key);
  const current = owners.get(key);
  if (
    current &&
    (saved === undefined ||
      current.state.kind === "PENDING" ||
      (saved === null &&
        !current.record &&
        (current.listeners.size > 0 || current.state.kind === "IDLE")) ||
      (saved !== null && saved.requestId === current.record?.requestId))
  )
    return current;
  const owner: Owner = {
    state: saved ? { kind: "UNCERTAIN" } : { kind: "IDLE" },
    ...(saved ? { record: saved } : {}),
    listeners: new Set(),
  };
  owners.set(key, owner);
  return owner;
}
function publish(owner: Owner, state: HrWriteState<unknown>) {
  owner.state = state;
  for (const listener of owner.listeners) listener();
}
function clearOwner(owner: Owner, key: string) {
  owner.record = undefined;
  owner.command = undefined;
  sessionPreferences.remove(key);
  if (owners.get(key) === owner) owners.delete(key);
}
function pinCommand(owner: Owner, command: Send) {
  owner.command = command;
}
function beginCommand(
  owner: Owner,
  key: string,
  payload: unknown,
  operation: string | undefined,
): boolean | null {
  const saved = readRecord(key);
  if (saved === undefined) return false;
  // Storage can change after the form renders. Adopt that command rather
  // than overwriting a request whose outcome this owner has not seen.
  if (saved !== null) {
    owner.record = saved;
    publish(owner, { kind: "UNCERTAIN" });
    return null;
  }
  owners.set(key, owner);
  owner.record = {
    version: 1,
    requestId: crypto.randomUUID(),
    ...(payload === undefined ? {} : { payload: structuredClone(payload) }),
    ...(operation === undefined ? {} : { operation }),
  };
  return sessionPreferences.write(key, owner.record);
}

function errorCode(error: unknown): string | null {
  const data =
    typeof error === "object" && error !== null && "data" in error
      ? error.data
      : null;
  return typeof data === "object" &&
    data !== null &&
    "code" in data &&
    typeof data.code === "string"
    ? data.code
    : null;
}
export function classifyOutcome<Value>(outcome: unknown): HrWriteState<Value> {
  const result = outcome as {
    ok?: boolean;
    value?: { written?: boolean; error?: { code?: string; field?: string } };
  } | null;
  if (result === null || typeof result !== "object")
    return { kind: "UNCERTAIN" };
  if (result.ok !== true)
    return { kind: result.ok === false ? "DENIED" : "UNCERTAIN" };
  if (result.value?.written === true)
    return { kind: "SAVED", value: result.value as Value };
  if (result.value?.written === false)
    return {
      kind: "REFUSED",
      code: result.value.error?.code ?? "UNKNOWN",
      ...(result.value.error?.field === undefined
        ? {}
        : { field: result.value.error.field }),
    };
  return { kind: "UNCERTAIN" };
}

/** The exact registered operation whose legacy/opaque command needs recovery. */
function operationFor(intent: string): string | undefined {
  const operations: readonly [string, string][] = [
    ["clock:CLOCK_IN:", "hr.attendance.clockIn"],
    ["clock:CLOCK_OUT:", "hr.attendance.clockOut"],
    ["shortcut-preferences", "hr.preferences.save"],
    ["employee:", "hr.employee.save"],
    ["holiday:delete:", "hr.holiday.delete"],
    ["holiday:", "hr.holiday.save"],
    ["access:", "hr.access.set"],
    ["decision:", "hr.correction.decide"],
    ["dispose:", "hr.attendance.dispose"],
    ["correction:", "hr.correction.submit"],
    ["period:create:", "hr.period.create"],
    ["period:close:", "hr.period.closeVersion"],
    ["period:revise:", "hr.period.revise"],
    ["period:export:", "hr.period.exportVersion"],
    ["policy-draft:", "hr.policy.saveDraft"],
    ["policy-activate:", "hr.policy.activate"],
    ["opening:", "hr.leave.reconcileOpening"],
    ["leave-resubmit:", "hr.leave.resubmit"],
    ["leave-submit:", "hr.leave.submit"],
    ["leave-cancel:", "hr.leave.cancel"],
    ["leave-renewal:", "hr.leave.renewEntitlements"],
    ["leave-review:", "hr.leave.decide"],
    ["leave-adjust:", "hr.leave.adjust"],
    ["announcement-cancel-schedule:", "hr.announcements.cancelSchedule"],
    ["announcement-receipt:", "hr.announcements.recordReceipt"],
    ["notifications-mark-all", "hr.notifications.markAll"],
    ["notification-read:", "hr.notifications.markOne"],
    ["payslip-import-stage", "hr.payslip.stage"],
    ["payslip-publish:", "hr.payslip.publish"],
  ];
  return operations.find(([prefix]) => intent.startsWith(prefix))?.[1];
}

export interface HrCommandRecovery<Payload> {
  readonly decode: (payload: unknown) => Payload | undefined;
  readonly send: (payload: Payload, requestId: string) => Promise<unknown>;
}

/** New submission and explicit retry are separate actions. Recovery owns its ID and payload. */
export function useHrWrite<Value = Record<string, unknown>, Payload = never>(
  intent: string,
  recovery?: HrCommandRecovery<Payload>,
) {
  const identity = useHrAccess().identityKey ?? "anonymous";
  const key = `${STORAGE_PREFIX}${identity}|${intent}`;
  const owner = useMemo(() => ownerFor(key), [key]);
  const { capture } = useOperationLifecycle(key);
  const abandoned = useRef(new WeakSet<Owner>());
  useInsertionEffect(
    () => () => {
      abandoned.current.add(owner);
    },
    [owner],
  );
  const currentOwner = useRef(owner);
  useLayoutEffect(() => {
    currentOwner.current = owner;
  }, [owner]);
  const mounted = useRef(true);
  const page = useRef("");
  useLayoutEffect(() => {
    mounted.current = true;
    page.current = window.location.pathname;
    return () => {
      mounted.current = false;
    };
  }, []);
  const subscribe = useCallback(
    (listener: () => void) => {
      owner.listeners.add(listener);
      return () => {
        owner.listeners.delete(listener);
        if (
          owner.listeners.size === 0 &&
          !owner.record &&
          owners.get(key) === owner
        )
          owners.delete(key);
      };
    },
    [key, owner],
  );
  const snapshot = useCallback(
    () =>
      abandoned.current.has(owner) && owner.state.kind === "SAVED"
        ? IDLE
        : owner.state,
    [owner],
  );
  const snapshotState = useSyncExternalStore(subscribe, snapshot, snapshot);
  const storedPayload = recovery?.decode(owner.record?.payload);
  const clear = useCallback(() => {
    clearOwner(owner, key);
  }, [key, owner]);
  const liveResult = useCallback(
    (state: HrWriteState<Value>) =>
      mounted.current &&
      currentOwner.current === owner &&
      page.current === window.location.pathname
        ? state
        : ({ kind: "IDLE" } as const),
    [owner],
  );
  const runCommand = useCallback(
    async (command: Send): Promise<HrWriteState<Value>> => {
      if (!capture()()) return { kind: "IDLE" };
      if (owner.state.kind === "PENDING") return { kind: "PENDING" };
      const isCurrent = capture();
      pinCommand(owner, command);
      publish(owner, { kind: "PENDING" });
      let next: HrWriteState<Value>;
      try {
        next = classifyOutcome<Value>(await command(owner.record!.requestId));
      } catch (error) {
        const code = errorCode(error);
        next =
          code === null ? { kind: "UNCERTAIN" } : { kind: "REFUSED", code };
      }
      if (next.kind !== "UNCERTAIN") clear();
      publish(owner, next);
      return isCurrent() ? liveResult(next) : { kind: "IDLE" };
    },
    [capture, clear, liveResult, owner],
  );
  const submit = useCallback(
    async (
      send: Send,
      payload?: Payload,
      operation?: string,
    ): Promise<HrWriteState<Value>> => {
      if (!capture()()) return { kind: "IDLE" };
      // Never attach a new form's closure to a request with an unknown outcome.
      if (owner.record) return liveResult(owner.state as HrWriteState<Value>);
      const persisted = beginCommand(
        owner,
        key,
        payload,
        operation ?? operationFor(intent),
      );
      if (persisted === null)
        return liveResult(owner.state as HrWriteState<Value>);
      if (!persisted) {
        // Discard only an identity minted here: unreadable storage may still
        // hold an older unknown command and must never be removed blindly.
        if (owner.record) clear();
        const refused = {
          kind: "REFUSED",
          code: "REQUEST_RECOVERY_UNAVAILABLE",
        } as const;
        publish(owner, refused);
        return liveResult(refused);
      }
      return await runCommand(send);
    },
    [capture, clear, intent, key, liveResult, owner, runCommand],
  );
  const submitCommand = useCallback(
    async (payload: Payload) => {
      if (!recovery) return { kind: "IDLE" } as const;
      const frozen = structuredClone(payload);
      return await submit(
        (requestId) => recovery.send(frozen, requestId),
        frozen,
      );
    },
    [recovery, submit],
  );
  const retry = useCallback(async (): Promise<HrWriteState<Value>> => {
    if (!owner.record) return { kind: "IDLE" };
    const command =
      storedPayload === undefined
        ? owner.command
        : (requestId: string) => recovery!.send(storedPayload, requestId);
    if (!command) return liveResult({ kind: "UNCERTAIN" });
    return await runCommand(command);
  }, [liveResult, owner, recovery, runCommand, storedPayload]);
  const operation = owner.record?.operation ?? operationFor(intent);
  const reconcile = useCallback(
    async (send: () => Promise<unknown>) => {
      if (!capture()() || owner.state.kind === "PENDING" || !owner.record)
        return;
      publish(owner, { kind: "PENDING" });
      let next: HrWriteState<Value> = { kind: "UNCERTAIN" };
      try {
        const outcome = (await send()) as {
          ok?: boolean;
          value?: { resolved?: boolean; status?: string };
        };
        if (
          outcome?.ok &&
          outcome.value?.resolved === true &&
          (outcome.value.status === "COMMITTED" ||
            outcome.value.status === "FENCED")
        ) {
          clear();
          next = {
            kind: "RECONCILED",
            applied: outcome.value.status === "COMMITTED",
          };
        }
      } catch {
        /* Keep ownership when reconciliation also loses its response. */
      }
      publish(owner, next);
    },
    [capture, clear, owner],
  );
  const blocked =
    snapshotState.kind === "UNCERTAIN" &&
    !owner.command &&
    storedPayload === undefined;
  const state =
    blocked &&
    operation &&
    owner.record &&
    ID_PATTERN.test(owner.record.requestId)
      ? {
          ...snapshotState,
          recovery: { operation, requestId: owner.record.requestId, reconcile },
        }
      : blocked &&
          owner.record &&
          (!operation || !ID_PATTERN.test(owner.record.requestId))
        ? { ...snapshotState, recoveryUnavailable: true }
        : snapshotState;
  const reset = useCallback(() => {
    if (capture()() && !owner.record) publish(owner, { kind: "IDLE" });
  }, [capture, owner]);
  return {
    state: state as HrWriteState<Value>,
    // `run` remains the new-command entry point for older callers.
    run: submit,
    submit,
    submitCommand,
    retry,
    reset,
    pending: state.kind === "PENDING",
    locked: state.kind === "PENDING" || state.kind === "UNCERTAIN",
    recoveredPayload: storedPayload,
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
const CLOCK_STORAGE_INVALID = Symbol("clock-storage-invalid");
let clockFallback: StoredClockCommand | null = null;
interface ClockOwner {
  readonly scope: string;
  readonly listeners: Set<() => void>;
  command: StoredClockCommand | null;
  state: HrWriteState<unknown>;
}
const clockOwners = new Map<string, ClockOwner>();

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
function readClockRecord() {
  return sessionPreferences.read<
    | StoredClockCommand
    | null
    | typeof CLOCK_STORAGE_UNAVAILABLE
    | typeof CLOCK_STORAGE_INVALID
  >(
    CLOCK_STORAGE_KEY,
    (value) =>
      value === null
        ? null
        : (decodeClockCommand(value) ?? CLOCK_STORAGE_INVALID),
    CLOCK_STORAGE_UNAVAILABLE,
  );
}
function readClockCommand(): StoredClockCommand | null {
  const record = readClockRecord();
  return record === CLOCK_STORAGE_UNAVAILABLE
    ? clockFallback
    : typeof record === "symbol"
      ? null
      : record;
}
function pinClock(owner: ClockOwner, command: StoredClockCommand | null) {
  owner.command = command;
}
function publishClock(owner: ClockOwner, state: HrWriteState<unknown>) {
  owner.state = state;
  for (const listener of owner.listeners) listener();
}
function clearClockCommand(scope: string, requestId?: string) {
  const matches = (row: StoredClockCommand | null) =>
    row?.scope === scope &&
    (requestId === undefined || row.requestId === requestId);
  if (matches(readClockCommand())) sessionPreferences.remove(CLOCK_STORAGE_KEY);
  if (matches(clockFallback)) clockFallback = null;
}
/** Run above the page gate, so logout also clears recovery after child unmount. */
export function clearHrClockRecoveryExcept(identity?: string) {
  const keep = (scope: string) =>
    identity !== undefined && scope.startsWith(`${identity}|clock:`);
  const stored = readClockCommand();
  if (stored && !keep(stored.scope)) clearClockCommand(stored.scope);
  if (clockFallback && !keep(clockFallback.scope))
    clearClockCommand(clockFallback.scope);
  for (const [scope, owner] of clockOwners)
    if (!keep(scope)) {
      clockOwners.delete(scope);
      owner.command = null;
      publishClock(owner, { kind: "IDLE" });
    }
}
function clockOwnerFor(scope: string, employeeId: string): ClockOwner {
  const stored = readClockRecord();
  const current = clockOwners.get(scope);
  if (
    current &&
    (current.state.kind === "PENDING" ||
      stored === CLOCK_STORAGE_UNAVAILABLE ||
      (stored === null &&
        current.command === null &&
        (current.listeners.size > 0 || current.state.kind === "IDLE")) ||
      (typeof stored !== "symbol" &&
        stored !== null &&
        stored.requestId === current.command?.requestId))
  )
    return current;
  const command =
    typeof stored === "symbol"
      ? null
      : stored?.scope === scope && stored.employeeId === employeeId
        ? stored
        : null;
  const owner: ClockOwner = {
    scope,
    command,
    listeners: new Set(),
    state:
      stored === CLOCK_STORAGE_INVALID
        ? { kind: "UNCERTAIN", recoveryUnavailable: true }
        : command
          ? { kind: "UNCERTAIN" }
          : { kind: "IDLE" },
  };
  clockOwners.set(scope, owner);
  return owner;
}

/** Strict clock-only recovery, shared by remounts while the original promise is live. */
export function useHrClockWrite<Value = Record<string, unknown>>(
  employeeId: string,
  businessDate: string,
  send: (command: HrClockCommand) => Promise<unknown>,
) {
  const identity = useHrAccess().identityKey ?? "anonymous";
  const scope = `${identity}|clock:${employeeId}`;
  const owner = useMemo(
    () => clockOwnerFor(scope, employeeId),
    [scope, employeeId],
  );
  const { capture } = useOperationLifecycle(scope);
  useLayoutEffect(() => {
    clearHrClockRecoveryExcept(identity);
    for (const [other, previous] of clockOwners)
      if (other !== scope) {
        clearClockCommand(other);
        clockOwners.delete(other);
        previous.command = null;
        publishClock(previous, { kind: "IDLE" });
      }
    const stored = readClockCommand();
    if (stored && stored.scope !== scope) clearClockCommand(stored.scope);
  }, [identity, owner, scope]);
  const subscribe = useCallback(
    (listener: () => void) => {
      // StrictMode replays subscription cleanup without creating a new hook.
      // Reattach this owner only when no newer workflow has taken its scope.
      if (!clockOwners.has(scope)) clockOwners.set(scope, owner);
      owner.listeners.add(listener);
      return () => {
        owner.listeners.delete(listener);
        if (
          !owner.listeners.size &&
          !owner.command &&
          clockOwners.get(scope) === owner
        )
          clockOwners.delete(scope);
      };
    },
    [owner, scope],
  );
  const snapshot = useCallback(() => owner.state, [owner]);
  const state = useSyncExternalStore(
    subscribe,
    snapshot,
    snapshot,
  ) as HrWriteState<Value>;
  const run = useCallback(
    async (kind?: HrClockCommand["kind"]): Promise<HrWriteState<Value>> => {
      if (clockOwners.get(scope) !== owner || !capture()())
        return { kind: "IDLE" };
      if (owner.state.kind === "PENDING") return { kind: "PENDING" };
      // Only explicit Retry can execute an existing command. New clicks never become recovery.
      if (kind && (owner.command || owner.state.kind === "UNCERTAIN"))
        return owner.state as HrWriteState<Value>;
      const isCurrent = capture();
      let command = owner.command;
      if (!command) {
        if (!kind || !employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate))
          return { kind: "IDLE" };
        const stored = readClockRecord();
        if (stored === CLOCK_STORAGE_INVALID) {
          publishClock(owner, { kind: "UNCERTAIN", recoveryUnavailable: true });
          return owner.state as HrWriteState<Value>;
        }
        if (stored === CLOCK_STORAGE_UNAVAILABLE || stored !== null) {
          const refused = {
            kind: "REFUSED",
            code: "REQUEST_RECOVERY_UNAVAILABLE",
          } as const;
          publishClock(owner, refused);
          return refused;
        }
        command = {
          schema: 1,
          scope,
          employeeId,
          expectedBusinessDate: businessDate,
          kind,
          requestId: crypto.randomUUID(),
        };
        if (!sessionPreferences.write(CLOCK_STORAGE_KEY, command)) {
          const refused = {
            kind: "REFUSED",
            code: "REQUEST_RECOVERY_UNAVAILABLE",
          } as const;
          publishClock(owner, refused);
          return refused;
        }
        pinClock(owner, command);
        clockFallback = command;
      }
      publishClock(owner, { kind: "PENDING" });
      let next: HrWriteState<Value>;
      try {
        next = classifyOutcome<Value>(
          await send({
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
      if (clockOwners.get(scope) !== owner) return { kind: "IDLE" };
      if (next.kind !== "UNCERTAIN") {
        clearClockCommand(scope, command.requestId);
        pinClock(owner, null);
      }
      publishClock(owner, next);
      return isCurrent() ? next : { kind: "IDLE" };
    },
    [businessDate, capture, employeeId, owner, scope, send],
  );
  const retry = useCallback(() => run(), [run]);
  return {
    state,
    command: owner.command,
    submit: run,
    retry,
    pending: state.kind === "PENDING",
    locked: state.kind === "PENDING" || state.kind === "UNCERTAIN",
  };
}
