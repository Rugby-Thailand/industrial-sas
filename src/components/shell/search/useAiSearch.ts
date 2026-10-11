"use client";

import { useAction, useConvex } from "convex/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useHrAccess } from "@/components/providers/HrAccessProvider";
import { hrRefs } from "@/lib/convex/hrApi";
import {
  resolveIntent,
  type IntentLookups,
  type IntentOutcome,
  type PageSearchContext,
} from "@/lib/search/resolveIntent";

import type { DroppedValue } from "../../../../convex/model/search/intent";

export type AiErrorCode =
  | "AI_UNAVAILABLE"
  | "AI_TIMEOUT"
  | "AI_UNREADABLE"
  | "RATE_LIMITED"
  | "QUERY_INVALID"
  | "DENIED"
  | "FAILED";

export type AiState =
  | { readonly status: "IDLE" }
  | { readonly status: "RUNNING" }
  | {
      readonly status: "DONE";
      readonly outcome: IntentOutcome;
      readonly dropped: readonly DroppedValue[];
    }
  | {
      readonly status: "ERROR";
      readonly code: AiErrorCode;
      readonly retryAfterMs?: number;
    };

const IDLE: AiState = { status: "IDLE" };

const KNOWN_ERRORS = new Set<AiErrorCode>([
  "AI_UNAVAILABLE",
  "AI_TIMEOUT",
  "AI_UNREADABLE",
  "RATE_LIMITED",
  "QUERY_INVALID",
]);

/**
 * One AI interpretation per request, bound to the query, the visible page
 * context, the account and its grants. A change to any of them, a cancel,
 * or unmounting (closing the dialog, leaving the shell, switching account)
 * discards the answer: an old response can never navigate or show.
 */
export function useAiSearch(input: {
  readonly query: string;
  readonly granted: readonly string[];
  readonly context: PageSearchContext | null;
  readonly onNavigate: IntentNavigate;
}) {
  const hr = useHrAccess();
  const interpret = useAction(hrRefs.interpretSearch);
  const convex = useConvex();
  const key = JSON.stringify([
    input.query.trim(),
    hr.identityKey ?? "",
    input.granted,
    input.context,
  ]);
  const [entry, setEntry] = useState<{ key: string; state: AiState }>({
    key,
    state: IDLE,
  });
  const currentKey = useRef(key);
  useLayoutEffect(() => {
    currentKey.current = key;
  }, [key]);
  const sequence = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      // Every pending request of this mount is now stale.
      mounted.current = false;
      sequence.current += 1;
    };
  }, []);
  const state = entry.key === key ? entry.state : IDLE;

  // Exact codes are sent as codes with no name text, so the server
  // compares no names for them; a name is sent as text.
  const employeeArgs = (text: string, codes?: readonly string[]) =>
    codes === undefined ? { text } : { text: "", codes: [...codes] };
  const lookups: IntentLookups = {
    reviewEmployees: async (text, codes) => {
      const outcome = await convex.query(
        hrRefs.searchReviewEmployees,
        employeeArgs(text, codes),
      );
      return outcome.ok ? outcome.value : null;
    },
    adminEmployees: async (text, codes) => {
      const outcome = await convex.query(
        hrRefs.searchAdminEmployees,
        employeeArgs(text, codes),
      );
      return outcome.ok ? outcome.value : null;
    },
    periodsByRange: async (from, to) => {
      const outcome = await convex.query(hrRefs.searchPeriodsByRange, {
        from,
        to,
      });
      return outcome.ok ? outcome.value : null;
    },
  };

  const run = async () => {
    const requestKey = key;
    const id = (sequence.current += 1);
    const live = () =>
      mounted.current &&
      sequence.current === id &&
      currentKey.current === requestKey;
    const settle = (next: AiState) => {
      if (live()) setEntry({ key: requestKey, state: next });
    };
    setEntry({ key: requestKey, state: { status: "RUNNING" } });
    try {
      const context = input.context;
      const outcome = await interpret({
        query: input.query.trim(),
        context: {
          page: context?.page ?? null,
          employee: context?.employee !== undefined,
          date: context?.date !== undefined,
          period: context?.period !== undefined,
        },
      });
      if (!live()) return;
      if (!outcome.ok) return settle({ status: "ERROR", code: "DENIED" });
      const answer = outcome.value;
      if (!answer.ok)
        return settle({
          status: "ERROR",
          code: KNOWN_ERRORS.has(answer.code as AiErrorCode)
            ? (answer.code as AiErrorCode)
            : "FAILED",
          ...("retryAfterMs" in answer &&
          typeof answer.retryAfterMs === "number"
            ? { retryAfterMs: answer.retryAfterMs }
            : {}),
        });
      const resolved = await resolveIntent({
        intent: answer.intent,
        today: answer.today ?? null,
        granted: input.granted,
        ownCode: hr.employee?.code ?? null,
        context,
        lookups,
      });
      if (!live()) return;
      if (resolved.kind === "NAVIGATE" && input.onNavigate(resolved.target))
        return settle(IDLE);
      settle({
        status: "DONE",
        outcome: resolved,
        dropped: answer.intent.dropped,
      });
    } catch {
      settle({ status: "ERROR", code: "FAILED" });
    }
  };

  const cancel = useCallback(() => {
    sequence.current += 1;
    setEntry({ key: currentKey.current, state: IDLE });
  }, []);

  return { state, run, cancel };
}

export type IntentNavigate = (
  target: Extract<IntentOutcome, { kind: "NAVIGATE" }>["target"],
) => boolean;
