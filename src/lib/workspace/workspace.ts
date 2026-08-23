/** A warehouse the current membership may use. */
export interface WarehouseOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** The organization resolved from the verified identity token. */
export interface OrganizationSummary {
  readonly id: string;
  readonly name: string;
}

/** One bounded answer from the server workspace query. */
export interface WorkspaceSnapshot {
  readonly organization: OrganizationSummary;
  readonly warehouses: readonly WarehouseOption[];
  /** Bounded grants used only to remove destinations that cannot be opened. */
  readonly navigationPermissions: readonly string[];
  /** False when the membership has more warehouses than this answer includes. */
  readonly complete: boolean;
}

export interface WorkspaceState extends WorkspaceSnapshot {
  readonly selectedWarehouseId: string | undefined;
  readonly selectable: boolean;
}

/**
 * Resolve the active warehouse from a trusted server list and an untrusted local
 * preference. A stale or foreign preference is ignored.
 */
export function resolveWorkspace(
  snapshot: WorkspaceSnapshot,
  storedWarehouseId: string | undefined,
): WorkspaceState {
  const selectedWarehouseId = chooseWarehouse(
    snapshot.warehouses,
    storedWarehouseId,
  );

  return Object.freeze({
    ...snapshot,
    selectedWarehouseId,
    selectable: snapshot.warehouses.length > 0,
  });
}

const chooseWarehouse = (
  warehouses: readonly WarehouseOption[],
  storedWarehouseId: string | undefined,
): string | undefined => {
  const stored = warehouses.find(
    (warehouse) => warehouse.id === storedWarehouseId,
  );
  if (stored !== undefined) return stored.id;
  return warehouses.length === 1 ? warehouses[0]?.id : undefined;
};

export const warehouseLabel = (warehouse: WarehouseOption): string =>
  `${warehouse.code} · ${warehouse.name}`;

export const organizationLabel = (organization: OrganizationSummary): string =>
  organization.name;
