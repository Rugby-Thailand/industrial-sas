/**
 * The one bridge between navigation callers and the shell's unsaved-work
 * owner (`NavigationGuardProvider`). The owner holds every registered draft,
 * the single history buffer, the browser listeners and the one prompt; this
 * module only forwards to it, so callers outside React (search, AI, deep
 * links) and query readers need no provider import.
 *
 * - `guardedNavigate(action)` asks the owner once. Without an owner (tests,
 *   auth/public shells) the action runs directly.
 * - `onNavigationIntent(listener)` is told after a navigation was permitted,
 *   immediately before it runs. It never blocks navigation (sensitive-data
 *   hygiene such as hiding payslip amounts).
 * - `isGuardTraversal()` is true only while the owner traverses its own
 *   buffer entry (restoring a cancelled Back, or removing the buffer before
 *   a permitted move). Query readers must keep their committed snapshot then.
 */
export type Transition = () => void;

export interface NavigationGuardOwner {
  readonly requestTransition: (action: Transition) => void;
  readonly isTraversing: () => boolean;
}

let owner: NavigationGuardOwner | null = null;
const intentListeners = new Set<() => void>();

/** Internal: the shell provider is the only caller. Returns its release. */
export function registerNavigationGuardOwner(
  next: NavigationGuardOwner,
): () => void {
  if (owner !== null && owner !== next && process.env.NODE_ENV !== "production")
    console.error(
      "A second navigation guard owner was mounted; only one shell may own navigation.",
    );
  owner = next;
  return () => {
    // StrictMode and remounts may release an owner that was already replaced.
    if (owner === next) owner = null;
  };
}

/** Internal: the owner announces a permitted navigation before running it. */
export function announceNavigationIntent(): void {
  for (const listener of [...intentListeners]) listener();
}

export function guardedNavigate(action: Transition): void {
  const current = owner;
  if (current === null) {
    announceNavigationIntent();
    action();
    return;
  }
  current.requestTransition(action);
}

export function onNavigationIntent(listener: () => void): () => void {
  intentListeners.add(listener);
  return () => {
    intentListeners.delete(listener);
  };
}

export function isGuardTraversal(): boolean {
  return owner?.isTraversing() ?? false;
}
