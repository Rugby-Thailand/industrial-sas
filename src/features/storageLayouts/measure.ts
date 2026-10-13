import { browserQueryEvent } from "@/lib/browser/history";
import { isGuardTraversal } from "@/lib/navigationGuard";

/**
 * Survey values are kept to the millimetre. Returns integer millimetres, or
 * null for an empty, non-finite, negative or sub-millimetre value. Nothing is
 * rounded: 11.9605 m is rejected rather than saved as 11.961 m.
 */
export function measuredMillimetres(value: string): number | null {
  const text = value.trim();
  if (!/^\d+(?:\.\d{0,3})?$|^\.\d{1,3}$/.test(text)) return null;
  const mm = Math.round(Number(text) * 1_000);
  return Number.isSafeInteger(mm) ? mm : null;
}

/**
 * Run a foreground close once the shell guard has finished any traversal it
 * started when this editor's draft just became clean. A close issued during
 * that buffer removal would otherwise be refused and leave an owned entry.
 * The guard announces the end of its traversal with the shared query event.
 */
export function whenGuardIdle(action: () => void): void {
  if (!isGuardTraversal()) {
    action();
    return;
  }
  const retry = () => {
    window.removeEventListener(browserQueryEvent, retry);
    queueMicrotask(() => whenGuardIdle(action));
  };
  window.addEventListener(browserQueryEvent, retry);
}
