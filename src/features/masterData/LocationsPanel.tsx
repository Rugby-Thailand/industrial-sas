"use client";

import { useTranslations } from "next-intl";

import { LocationsTable } from "@/components/masterData/LocationsTable";
import { TableStatusSwitch } from "@/components/table/TableRowControls";
import { DEFAULT_LEDGER_PAGE_SIZE } from "@/lib/convex/ledgerApi";
import {
  listLocationsRef,
  type LocationRow,
  type WarehouseScopedListArgs,
} from "@/lib/convex/masterDataApi";
import { updateLocationRef } from "@/lib/convex/masterDataApi";

import { LocationRowActions } from "./LocationRowActions";
import { MasterDataPanel } from "./MasterDataPanel";
import { RowWriteRegion } from "./RowWriteRegion";

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
              renderStatus={(row) => (
                <TableStatusSwitch
                  checked={row.status === "ACTIVE"}
                  disabled={busy}
                  label={t("toggleLocationStatus", { code: row.code })}
                  actionLabel={
                    row.status === "ACTIVE" ? t("deactivate") : t("reactivate")
                  }
                  testId={`location-toggle-${row.code}`}
                  onCheckedChange={(checked) =>
                    submit(row.locationId, (requestId) => ({
                      requestId,
                      warehouseId: row.warehouseId,
                      locationId: row.locationId,
                      status: checked ? "ACTIVE" : "INACTIVE",
                    }))
                  }
                />
              )}
              renderAction={(row) => (
                <LocationRowActions
                  row={row}
                  busy={busy}
                  onTypeChange={(locationType) =>
                    submit(row.locationId, (requestId) => ({
                      requestId,
                      warehouseId: row.warehouseId,
                      locationId: row.locationId,
                      locationType,
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
