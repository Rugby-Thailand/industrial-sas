/**
 * The one bridge between programmatic navigation and the unsaved-work
 * guards. Every mounted `useWorkspaceNavigationGuard` registers its
 * `requestTransition`; `guardedNavigate` asks each in turn and runs the
 * navigation only when every guard allows it (nothing dirty, or the user
 * chose to save or discard). "Keep editing" in any guard cancels it.
 *
 * Clicked links and Back/Forward are already intercepted by the guard hook
 * itself; this bridge covers shell-initiated moves such as global search,
 * AI navigation and same-page record switches, without adding listeners.
 */
type Transition = () => void;
type RequestTransition = (action: Transition) => void;

const guards = new Set<RequestTransition>();

export function registerTransitionGuard(guard: RequestTransition): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

export function guardedNavigate(action: Transition): void {
  const chain = [...guards].reduceRight<Transition>(
    (next, guard) => () => guard(next),
    action,
  );
  chain();
}
