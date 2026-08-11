/**
 * The active organization and warehouse — resolved as a pure function of the
 * environment and the operator's last choice.
 *
 * ### Why the warehouse is client state and the organization is not
 *
 * The organization is *never* chosen in the browser. It comes from the verified
 * token's active-organization claim and is mapped to a document server-side
 * (`INV-0001-02`, `ADR-0001` §1); a client-supplied `orgId` is the classic
 * cross-tenant leak, and no function in this repository accepts one. What the
 * UI holds is therefore a *label* for the organization the server already
 * resolved — never an identifier that selects one.
 *
 * The warehouse is different. `listBalances` and `listTransactions` both take a
 * `warehouseId` argument, and the server revalidates it on every call: the
 * document must exist, belong to the resolved tenant, be `ACTIVE`, and be inside
 * the actor's membership scope (`INV-0006-04`). A wrong or hostile value is a
 * denial, not a leak, which is what makes it safe for the browser to remember one
 * between visits.
 *
 * ### Where the list comes from
 *
 * With an identity provider configured, from the server — a read that does not
 * exist yet, because it needs a resolved tenant. Until it does, the honest answer
 * in `SERVER` mode is an *empty* list and `available: false`, so the selector
 * renders an explanation instead of an empty dropdown. In preview mode the list
 * is the synthetic fixture, clearly labelled as such everywhere it appears.
 */
import { PREVIEW_ORG_ID, PREVIEW_WAREHOUSES } from "../preview/ledgerPreview";

import type { AppEnvironment } from "../environment";

/** One selectable warehouse, with both label languages carried as data (B-10). */
export interface WarehouseOption {
  readonly id: string;
  readonly code: string;
  readonly nameTh: string;
  readonly nameEn: string;
}

export interface OrganizationSummary {
  readonly id: string;
  readonly nameTh: string;
  readonly nameEn: string;
}

export interface WorkspaceState {
  /** `undefined` until a verified token resolves one. */
  readonly organization: OrganizationSummary | undefined;
  readonly warehouses: readonly WarehouseOption[];
  readonly selectedWarehouseId: string | undefined;
  /** Whether a warehouse can be chosen at all right now. */
  readonly selectable: boolean;
  readonly source: "SERVER" | "PREVIEW";
}

/** The synthetic organization. Only ever reachable in preview mode. */
export const PREVIEW_ORGANIZATION: OrganizationSummary = Object.freeze({
  id: PREVIEW_ORG_ID,
  nameTh: "บริษัท สยามอินดัสเทรียล จำกัด",
  nameEn: "Siam Industrial Co., Ltd.",
});

/**
 * Resolve the workspace.
 *
 * A stored warehouse that is not in the available list is discarded rather than
 * kept: it is either stale (the membership changed) or someone else's, and
 * carrying it forward would send every read to a warehouse the server will
 * refuse. When exactly one warehouse is available it is selected automatically —
 * a single-site tenant should not have to choose from a list of one before it can
 * see stock.
 */
export function resolveWorkspace(
  environment: AppEnvironment,
  storedWarehouseId: string | undefined,
): WorkspaceState {
  if (environment.previewMode) {
    return frozen({
      organization: PREVIEW_ORGANIZATION,
      warehouses: PREVIEW_WAREHOUSES,
      selectedWarehouseId: chooseWarehouse(
        PREVIEW_WAREHOUSES,
        storedWarehouseId,
      ),
      selectable: true,
      source: "PREVIEW",
    });
  }

  return frozen({
    organization: undefined,
    warehouses: [],
    selectedWarehouseId: undefined,
    selectable: false,
    source: "SERVER",
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

const frozen = (state: WorkspaceState): WorkspaceState => Object.freeze(state);

/** The label for a warehouse in the active locale, with its code for scanning. */
export const warehouseLabel = (
  warehouse: WarehouseOption,
  locale: string,
): string =>
  `${warehouse.code} · ${locale === "th" ? warehouse.nameTh : warehouse.nameEn}`;

/** The label for an organization in the active locale. */
export const organizationLabel = (
  organization: OrganizationSummary,
  locale: string,
): string => (locale === "th" ? organization.nameTh : organization.nameEn);
