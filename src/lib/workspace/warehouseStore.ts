import { guardedNavigate } from "@/lib/navigationGuard";

export const WAREHOUSE_STORAGE_KEY = "industrial-sas.warehouse";
export const LEGACY_WAREHOUSE_STORAGE_KEY = "industrial-ssa.warehouse";
type Listener = () => void;
const listeners = new Set<Listener>();
// A tab owns its accepted scope. Another tab changing localStorage cannot
// replace this snapshot until this tab's draft/pending owner permits it.
let accepted: { value: string | null } | undefined;
let releaseStorage: (() => void) | undefined;
let requestVersion = 0;

const notify = (): void => {
  for (const listener of listeners) listener();
};

function storedValue(): string | null {
  try {
    const value = window.localStorage.getItem(WAREHOUSE_STORAGE_KEY);
    if (value !== null) return value;
    const legacy = window.localStorage.getItem(LEGACY_WAREHOUSE_STORAGE_KEY);
    if (legacy === null) return null;
    try {
      window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, legacy);
      window.localStorage.removeItem(LEGACY_WAREHOUSE_STORAGE_KEY);
    } catch {
      // Readable storage can still restore a choice when writes are blocked.
    }
    return legacy;
  } catch {
    return null;
  }
}

function requestChoice(value: string | null, persist: boolean): void {
  if (value === readStoredWarehouse()) return;
  const version = ++requestVersion;
  guardedNavigate(() => {
    // A newer choice or provider lifetime supersedes an old approval.
    if (version !== requestVersion) return;
    if (persist && value !== null) {
      try {
        window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, value);
        window.localStorage.removeItem(LEGACY_WAREHOUSE_STORAGE_KEY);
      } catch {
        // Keep this tab's accepted choice even when persistence is unavailable.
      }
    }
    accepted = { value };
    notify();
  });
}

export function subscribeWarehouse(listener: Listener): () => void {
  listeners.add(listener);
  if (!releaseStorage) {
    const onStorage = (event: StorageEvent) => {
      if (
        event.storageArea !== null &&
        event.storageArea !== window.localStorage
      )
        return;
      if (event.key === WAREHOUSE_STORAGE_KEY)
        requestChoice(event.newValue, false);
      else if (event.key === null || event.key === LEGACY_WAREHOUSE_STORAGE_KEY)
        requestChoice(storedValue(), false);
    };
    window.addEventListener("storage", onStorage);
    releaseStorage = () => window.removeEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    releaseStorage?.();
    releaseStorage = undefined;
    accepted = undefined;
    requestVersion++;
  };
}

export function readStoredWarehouse(): string | null {
  accepted ??= { value: storedValue() };
  return accepted.value;
}
export const serverWarehouseSnapshot = (): string | null => null;

/** All same-tab callers, including non-shell entry points, ask the owner. */
export function writeStoredWarehouse(warehouseId: string): void {
  requestChoice(warehouseId, true);
}
