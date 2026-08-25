export const WAREHOUSE_STORAGE_KEY = "industrial-sas.warehouse";

export const LEGACY_WAREHOUSE_STORAGE_KEY = "industrial-ssa.warehouse";

type Listener = () => void;

const listeners = new Set<Listener>();

const notify = (): void => {
  for (const listener of listeners) listener();
};

export function subscribeWarehouse(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === WAREHOUSE_STORAGE_KEY ||
      event.key === LEGACY_WAREHOUSE_STORAGE_KEY
    )
      listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function readStoredWarehouse(): string | null {
  try {
    const warehouseId = window.localStorage.getItem(WAREHOUSE_STORAGE_KEY);
    if (warehouseId !== null) return warehouseId;

    const legacyWarehouseId = window.localStorage.getItem(
      LEGACY_WAREHOUSE_STORAGE_KEY,
    );
    if (legacyWarehouseId === null) return null;

    try {
      window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, legacyWarehouseId);
      window.localStorage.removeItem(LEGACY_WAREHOUSE_STORAGE_KEY);
    } catch {
      // A readable but unwritable store can still supply the existing choice.
    }
    return legacyWarehouseId;
  } catch {
    return null;
  }
}

export const serverWarehouseSnapshot = (): string | null => null;

export function writeStoredWarehouse(warehouseId: string): void {
  try {
    window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, warehouseId);
    window.localStorage.removeItem(LEGACY_WAREHOUSE_STORAGE_KEY);
  } catch {
    // Unwritable storage costs a re-selection; see `readStoredWarehouse`.
  }
  notify();
}
