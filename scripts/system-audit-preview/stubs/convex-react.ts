import { getFunctionName, type FunctionReference } from "convex/server";
import type { ReactNode } from "react";
import { answer } from "../data";
type Reference = FunctionReference<"query" | "mutation" | "action">;
export function useQuery(ref: Reference, args: unknown) {
  return args === "skip" ? undefined : answer(getFunctionName(ref));
}
export function useQuery_experimental({
  query,
  args,
}: {
  query: Reference;
  args: unknown;
}) {
  return args === "skip"
    ? { status: "pending" as const }
    : { status: "success" as const, data: answer(getFunctionName(query)) };
}
const refuse = () => async () => {
  throw new Error(
    "Isolated visual fixture refuses backend writes and AI actions.",
  );
};
export const useMutation = refuse;
export const useAction = refuse;
export const useConvexAuth = () => ({
  isAuthenticated: true,
  isLoading: false,
});
export const useConvex = () => ({
  query: async (ref: Reference) => answer(getFunctionName(ref)),
  action: refuse(),
  mutation: refuse(),
});
export const ConvexProvider = ({ children }: { children: ReactNode }) =>
  children;
export class ConvexReactClient {}
