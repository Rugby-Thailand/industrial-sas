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
import { appHistoryIndex } from "./browser/appHistory";
export type Transition = () => void;
export interface TransitionOptions {
  /** Identity permits a context owner to revoke only its own queued prompt. */
  readonly intentOwner?: object;
  readonly preserveDraftScope?: string;
  readonly entry?: { claim?: () => boolean };
  readonly onCancel?: () => void;
}

export interface NavigationGuardOwner {
  readonly requestTransition: (
    action: Transition,
    options?: TransitionOptions,
  ) => void;
  readonly cancelTransition?: (intentOwner: object) => void;
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

export function guardedNavigate(
  action: Transition,
  options?: TransitionOptions,
): void {
  const current = owner;
  if (current === null) {
    announceNavigationIntent();
    action();
    return;
  }
  current.requestTransition(action, options);
}

export function onNavigationIntent(listener: () => void): () => void {
  intentListeners.add(listener);
  return () => {
    intentListeners.delete(listener);
  };
}

// A link inside a foreground (the mobile drawer) must consume that entry
// before routing. The owner's document click guard runs before the Link's
// own handler; it requests this transition instead of a plain route push.
// Registrations live only as long as their anchor.
const linkNavigations = new WeakMap<HTMLAnchorElement, Transition>();

/** Internal: register the transition a guarded click on `anchor` runs. */
export function registerLinkNavigation(
  anchor: HTMLAnchorElement,
  transition: Transition,
): () => void {
  linkNavigations.set(anchor, transition);
  return () => {
    if (linkNavigations.get(anchor) === transition)
      linkNavigations.delete(anchor);
  };
}

/** Internal: the owner's click guard reads the anchor's own transition. */
export function registeredLinkNavigation(
  anchor: HTMLAnchorElement,
): Transition | undefined {
  return linkNavigations.get(anchor);
}

export function isGuardTraversal(): boolean {
  return owner?.isTraversing() ?? false;
}

// Workflows register only while they have an earlier step in the current page.
// Both the shared Back button and a draft guard's browser Back use this seam.
export const BACK_AVAILABILITY_EVENT = "app-back-availability";
const historyBackHandlers = new Map<
  () => boolean,
  { priority: number; available: () => boolean }
>();
export function notifyBackAvailability(): void {
  window.dispatchEvent(new Event(BACK_AVAILABILITY_EVENT));
}
export function registerHistoryBackHandler(
  handler: () => boolean,
  priority = 0,
  available: () => boolean = () => true,
): () => void {
  historyBackHandlers.set(handler, { priority, available });
  notifyBackAvailability();
  return () => {
    historyBackHandlers.delete(handler);
    notifyBackAvailability();
  };
}
export function backWithinPage(): boolean {
  return [...historyBackHandlers]
    .reverse()
    .sort((a, b) => b[1].priority - a[1].priority)
    .some(([handler]) => handler());
}
export function hasBackWithinPage(): boolean {
  return [...historyBackHandlers.values()].some(({ available }) => available());
}

/** Traversal stays centralized so feature dismissals cannot bypass guards. */
export function traverseBack(): void {
  guardedNavigate(() => window.history.back());
}
export function navigateBack(
  router: { back: () => void; replace: (href: string) => void },
  fallback: string | null,
): void {
  if (backWithinPage()) return;
  if ((appHistoryIndex() ?? 0) > 0) router.back();
  else if (fallback !== null) guardedNavigate(() => router.replace(fallback));
}

export function safeInternalReturnHref(
  value: string,
  fallback: string,
): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return fallback;
  const destination = new URL(value, window.location.origin);
  return destination.origin === window.location.origin
    ? destination.pathname + destination.search + destination.hash
    : fallback;
}

/** Revoke only this owner's requested transition; unrelated navigation remains owned. */
export function cancelGuardedTransition(intentOwner: object): void {
  owner?.cancelTransition?.(intentOwner);
}
