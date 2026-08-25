export interface WarehouseOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface OrganizationSummary {
  readonly id: string;
  readonly name: string;
}

export interface WorkspaceSnapshot {
  readonly organization: OrganizationSummary;
  readonly warehouses: readonly WarehouseOption[];
  /** Bounded grants used only to remove destinations that cannot be opened. */
  readonly navigationPermissions: readonly string[];

  readonly complete: boolean;
}

export interface WorkspaceState extends WorkspaceSnapshot {
  readonly selectedWarehouseId: string | undefined;
  readonly selectable: boolean;
}

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
