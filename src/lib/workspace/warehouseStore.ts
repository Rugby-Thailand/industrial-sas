/**
 * The operator's warehouse choice, as an external store.
 *
 * `localStorage` is exactly what `useSyncExternalStore` is for: state that lives
 * outside React, has no server value, and can change from somewhere React does
 * not control — another tab, in this case, which matters when a supervisor has
 * the same warehouse open twice.
 *
 * The alternative (read it in an effect and `setState`) is a cascading render on
 * every mount and reads as a bug even when it is not. This shape has one further
 * advantage: `getServerSnapshot` returns `null`, so the server and the first
 * client render agree by construction and there is no hydration mismatch to
 * reason about.
 *
 * Writes notify listeners explicitly. The `storage` event fires in *other*
 * documents only, so a write in this tab would otherwise not re-render the tab
 * that made it.
 */
export const WAREHOUSE_STORAGE_KEY = "industrial-ssa.warehouse";

type Listener = () => void;

const listeners = new Set<Listener>();

const notify = (): void => {
  for (const listener of listeners) listener();
};

/**
 * Subscribe to changes, from this tab or another.
 *
 * The `storage` listener is attached once per subscriber rather than once per
 * module so that unsubscribing is complete — a module-level listener would keep
 * a reference alive after the last consumer unmounted.
 */
export function subscribeWarehouse(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === WAREHOUSE_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The stored warehouse, or `null`.
 *
 * `null` rather than `undefined` because `useSyncExternalStore` compares
 * snapshots with `Object.is`, and both are stable primitives — but `null` is the
 * conventional "known absent" and keeps the server snapshot literally identical.
 *
 * A throwing `localStorage` (private-mode Safari, a locked-down device policy)
 * is treated as "no stored value". The cost is one re-selection, which is not
 * worth interrupting an operator over.
 */
export function readStoredWarehouse(): string | null {
  try {
    return window.localStorage.getItem(WAREHOUSE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The server has no storage, so it has no choice to report. */
export const serverWarehouseSnapshot = (): string | null => null;

export function writeStoredWarehouse(warehouseId: string): void {
  try {
    window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, warehouseId);
  } catch {
    // Unwritable storage costs a re-selection; see `readStoredWarehouse`.
  }
  notify();
}
