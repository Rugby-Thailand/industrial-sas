"use client";
import { useEffect, useRef, useState, type SetStateAction } from "react";
import {
  useOperationLifecycle,
  type OperationTicket,
} from "./useOperationLifecycle";
import { usePendingGuard } from "@/components/providers/draftGuard";
import { guardedNavigate } from "@/lib/navigationGuard";
import { useRequestIdentity } from "./useRequestIdentity";

export function operationErrorCode(error: unknown): string {
  const data =
    typeof error === "object" && error !== null && "data" in error
      ? error.data
      : null;
  return data &&
    typeof data === "object" &&
    "code" in data &&
    typeof data.code === "string"
    ? data.code
    : error instanceof Error
      ? error.message
      : "";
}
type AsyncOperationOptions =
  | ((code: string) => string)
  | {
      scope?: string | undefined;
      describeError: (code: string) => string;
      navigation?: "write" | "owned" | "read";
    };

const EMPTY_STATE = { busy: false, error: "", errorCode: "" };

/** Execution is local to the workflow; no automatic retries or shared busy flag. */
export function useAsyncOperation(options: AsyncOperationOptions) {
  const describeError =
    typeof options === "function" ? options : options.describeError;
  const scope = typeof options === "function" ? undefined : options.scope;
  const identity = useRequestIdentity(scope);
  const lifecycle = useOperationLifecycle(scope);
  const [entry, setEntry] = useState<{
    readonly scope: string | undefined;
    readonly state: typeof EMPTY_STATE;
    readonly isCurrent?: () => boolean;
    readonly ticket?: OperationTicket;
  }>({ scope, state: EMPTY_STATE });
  const { busy, error, errorCode } =
    entry.scope === scope &&
    (entry.isCurrent === undefined || entry.isCurrent())
      ? entry.state
      : EMPTY_STATE;
  const writeGuard = usePendingGuard(
    busy && typeof options !== "function" && options.navigation === "write",
  );
  const successful = useRef<OperationTicket | null>(null);
  const [completion, setCompletion] = useState<{
    ticket: OperationTicket;
    action: () => void;
  }>();
  const consumedCompletion = useRef<typeof completion>(undefined);
  useEffect(() => {
    if (busy || !completion || consumedCompletion.current === completion)
      return;
    consumedCompletion.current = completion;
    if (
      !completion.ticket.isCurrent() ||
      successful.current !== completion.ticket
    )
      return;
    const action = () => {
      if (
        completion.ticket.isCurrent() &&
        successful.current === completion.ticket
      )
        completion.action();
    };
    writeGuard.settle(() => guardedNavigate(action));
  }, [busy, completion, writeGuard]);
  const complete = (action: () => void) => {
    const ticket = successful.current;
    const current = lifecycle.capture();
    if (ticket && ticket.isCurrent() && current())
      setCompletion({ ticket, action });
  };
  const setError = (next: SetStateAction<string>) => {
    const isCurrent = lifecycle.capture();
    if (!isCurrent()) return;
    setEntry((previous) => {
      if (!isCurrent()) return previous;
      const current =
        previous.scope === scope &&
        (previous.isCurrent === undefined || previous.isCurrent());
      const state = current ? previous.state : EMPTY_STATE;
      return {
        ...(current ? previous : { scope, isCurrent }),
        state: {
          ...state,
          error: typeof next === "function" ? next(state.error) : next,
        },
      };
    });
  };
  /** Put synchronous UI/navigation effects in onSuccess, never inside action. */
  async function run<T>(
    action: () => Promise<T>,
    onSuccess?: (value: T) => void,
  ): Promise<T | null> {
    const ticket = lifecycle.acquire();
    if (ticket === null) return null;
    successful.current = null;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      ticket.finish();
      if (ticket.isCurrent())
        setEntry((previous) =>
          previous.ticket === ticket
            ? { ...previous, state: { ...previous.state, busy: false } }
            : previous,
        );
    };
    setEntry({
      scope,
      ticket,
      isCurrent: ticket.isCurrent,
      state: { busy: true, error: "", errorCode: "" },
    });
    try {
      const value = await action();
      if (!ticket.isCurrent()) return null;
      release();
      successful.current = ticket;
      onSuccess?.(value);
      return value;
    } catch (error) {
      const code = operationErrorCode(error);
      if (ticket.isCurrent()) {
        setEntry((previous) =>
          previous.ticket === ticket
            ? {
                ...previous,
                state: {
                  ...previous.state,
                  errorCode: code,
                  error: describeError(code),
                },
              }
            : previous,
        );
      }
      return null;
    } finally {
      release();
    }
  }
  return {
    busy,
    error,
    errorCode,
    setError,
    run,
    complete,
    request: identity.request,
    clearRequests: () => {
      if (lifecycle.capture()()) identity.clearRequests();
    },
  };
}
