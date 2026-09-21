"use client";
import { useEffect, useRef, useState } from "react";
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
    };

/** Execution is local to the workflow; no automatic retries or shared busy flag. */
export function useAsyncOperation(options: AsyncOperationOptions) {
  const describeError =
    typeof options === "function" ? options : options.describeError;
  const scope = typeof options === "function" ? undefined : options.scope;
  const identity = useRequestIdentity(scope);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const activeScope = useRef(scope);
  const generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (activeScope.current === scope) return;
    activeScope.current = scope;
    generation.current += 1;
    inFlight.current = false;
    setBusy(false);
    setError("");
    setErrorCode("");
  }, [scope]);
  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    if (inFlight.current) return null;
    inFlight.current = true;
    const runGeneration = generation.current;
    const current = () =>
      mounted.current && runGeneration === generation.current;
    if (current()) {
      setBusy(true);
      setError("");
      setErrorCode("");
    }
    try {
      return await action();
    } catch (error) {
      const code = operationErrorCode(error);
      if (current()) {
        setErrorCode(code);
        setError(describeError(code));
      }
      return null;
    } finally {
      if (runGeneration === generation.current) {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  return {
    busy,
    error,
    errorCode,
    setError,
    run,
    request: identity.request,
    clearRequests: identity.clearRequests,
  };
}
