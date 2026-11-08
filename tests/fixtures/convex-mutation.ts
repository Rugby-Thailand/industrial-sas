/**
 * Strict Convex mutation registry for DOM unit and a11y tests.
 *
 * `vitest.setup.ts` mocks `useMutation` with `getTestMutation`. Calling a
 * reference nobody registered rejects with its function name and fails the
 * test in `afterEach`; merely rendering `useMutation` registers nothing.
 * `registerTestMutation(reference, handler)` models any outcome: success,
 * refusal, replay, pending completion or transport failure. Registrations
 * reset before every test.
 *
 * A local `vi.mock("convex/react")` should use `useMutation: getTestMutation`
 * and register its spies in `beforeEach` or in the case itself. Handlers are
 * resolved at call time, so tests can still swap spies for pending writes,
 * retries and late completion. Register the exact reference from `fgRefs`,
 * `hrRefs` or the storage API; never add a fallback that registers whatever
 * reference the component asks for.
 */
import { act, cleanup } from "@testing-library/react";
import { getFunctionName } from "convex/server";

type Reference = Parameters<typeof getFunctionName>[0];
type Handler = (args: unknown) => unknown;
const handlers = new Map<string, Handler>();
const mutations = new Map<string, ReturnType<typeof createMutation>>();
const unexpected: string[] = [];

/** Register only the operations a test expects; handlers may model any outcome. */
export function registerTestMutation<Args, Result>(
  reference: Reference,
  handler: (args: Args) => Result,
) {
  handlers.set(getFunctionName(reference), (args) => handler(args as Args));
  return handler;
}

function createMutation(name: string) {
  const mutation = async (args: unknown) => {
    const handler = handlers.get(name);
    if (!handler) {
      unexpected.push(name);
      throw new Error(`Unexpected test mutation: ${name}`);
    }
    return handler(args);
  };
  // Optimistic client-cache updates have no server side effects in this mock.
  return Object.assign(mutation, { withOptimisticUpdate: () => mutation });
}

/** Resolve at call time so rendering a hook never authorizes a write. */
export function getTestMutation(reference: Reference) {
  const name = getFunctionName(reference);
  let mutation = mutations.get(name);
  if (!mutation) {
    mutation = createMutation(name);
    mutations.set(name, mutation);
  }
  return mutation;
}

/** Returns and clears the unregistered writes recorded since the last reset. */
export function takeUnexpectedTestMutations() {
  return unexpected.splice(0);
}

/**
 * Unmounts, lets writes that unmount effects start a microtask later land, then
 * fails on any unregistered write: a component may swallow the rejection.
 */
export async function finishTestMutations() {
  cleanup();
  await act(async () => {});
  const names = takeUnexpectedTestMutations();
  if (names.length > 0)
    throw new Error(
      `Unexpected test mutation: ${names.join(", ")}. Register the writes this test expects with registerTestMutation.`,
    );
}

export function resetTestMutations() {
  handlers.clear();
  mutations.clear();
  unexpected.length = 0;
}
