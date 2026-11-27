/**
 * Stand-in for `convex/react` in the visual fixture only. Every query is
 * answered from `fixtureData.ts` in memory: there is no Convex client, no
 * network request, no identity and no write. Mutations and actions refuse.
 */
import { getFunctionName, type FunctionReference } from "convex/server";
import { useMemo, type ReactNode } from "react";

import { answer } from "./fixtureData";

type Reference = FunctionReference<"query" | "mutation" | "action">;

const name = (reference: unknown) => getFunctionName(reference as Reference);

export const useConvexAuth = () => ({
  isAuthenticated: true,
  isLoading: false,
});

export function useQuery(reference: unknown, args: unknown) {
  const queryName = name(reference);
  const serialized = JSON.stringify(args ?? {});
  // Mirror Convex's stable result until the subscription arguments change.
  return useMemo(() => {
    const parameters: unknown = JSON.parse(serialized);
    return parameters === "skip" ? undefined : answer(queryName, parameters);
  }, [queryName, serialized]);
}

export function useQuery_experimental({
  query,
  args,
}: {
  readonly query: unknown;
  readonly args: unknown;
}) {
  const data = useQuery(query, args);
  return data === undefined
    ? { status: "pending" as const }
    : { status: "success" as const, data };
}

const client = Object.freeze({
  connectionState: () => ({ isWebSocketConnected: true, inflightMutations: 0 }),
  subscribeToConnectionState: () => () => undefined,
  query: async (reference: unknown, args: unknown) => {
    // A short delay keeps loading states real without stalling captures.
    await new Promise((resolve) => setTimeout(resolve, 60));
    return answer(name(reference), args);
  },
});
export const useConvex = () => client;

const refuse = () => async () => {
  throw new Error("The visual fixture performs no writes or actions.");
};
export const useMutation = refuse;
export const useAction = refuse;

export const ConvexProvider = ({ children }: { children: ReactNode }) =>
  children;
export class ConvexReactClient {}
