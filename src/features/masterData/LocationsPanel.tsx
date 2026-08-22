"use client";

/**
 * The locations panel.
 *
 * Warehouse-scoped, so it waits for a selection and the server revalidates the
 * chosen warehouse against the actor's membership on every call.
 */
import { useTranslations } from "next-intl";

import { LocationsTable } from "@/components/masterData/LocationsTable";
import { DEFAULT_LEDGER_PAGE_SIZE } from "@/lib/convex/ledgerApi";
import {
  listLocationsRef,
  type LocationRow,
  type WarehouseScopedListArgs,
} from "@/lib/convex/masterDataApi";
import { updateLocationRef } from "@/lib/convex/masterDataApi";

import { MasterDataPanel } from "./MasterDataPanel";
import { RowActionButton, RowWriteRegion } from "./RowWriteRegion";

export function LocationsPanel() {
  const t = useTranslations("MasterData");

  return (
    <MasterDataPanel<LocationRow, WarehouseScopedListArgs>
      queryRef={listLocationsRef}
      scope="WAREHOUSE"
      buildArgs={({ warehouseId, cursor }) => ({
        warehouseId,
        maxPageSize: DEFAULT_LEDGER_PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor }),
      })}
      renderRows={(rows) => (
        <RowWriteRegion mutationRef={updateLocationRef}>
          {({ submit, busy }) => (
            <LocationsTable
              rows={rows}
              renderAction={(row) => (
                <RowActionButton
                  busy={busy}
                  testId={`location-toggle-${row.code}`}
                  label={
                    row.status === "ACTIVE" ? t("deactivate") : t("reactivate")
                  }
                  onClick={() =>
                    submit(row.locationId, (requestId) => ({
                      requestId,
                      // The row's own warehouse, not the shell's selection: they
                      // are the same here, and sending the row's is what keeps
                      // them the same if the shell ever lists across sites.
                      warehouseId: row.warehouseId,
                      locationId: row.locationId,
                      status: row.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                    }))
                  }
                />
              )}
            />
          )}
        </RowWriteRegion>
      )}
    />
  );
}
