"use client";

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
