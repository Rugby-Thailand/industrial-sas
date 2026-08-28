"use client";

import { Archive, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { DeviceTable } from "@/components/platform/DeviceTable";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import {
  TableAction,
  TableRowActions,
} from "@/components/table/TableRowControls";
import { RowWriteRegion } from "@/features/masterData/RowWriteRegion";
import { MasterDataPanel } from "@/features/masterData/MasterDataPanel";
import {
  bindDeviceInstallationRef,
  listDevicesRef,
  registerDeviceRef,
  retireDeviceRef,
  type DeviceType,
  type DeviceRow,
} from "@/lib/convex/platformApi";
import { readOrCreateInstallationId } from "@/lib/device/installationId";

import { EntityWriteForm } from "../masterData/EntityWriteForm";

export function DeviceRegistryPanel() {
  const t = useTranslations("DeviceRegistry");
  const writeT = useTranslations("Write");
  const workspace = useWorkspace();

  return (
    <div className="flex flex-col gap-6">
      <EntityWriteForm
        testId="form-device-register"
        mutationRef={registerDeviceRef}
        legend={t("registerLegend")}
        description={t("registerDescription")}
        submitLabel={t("register")}
        requiredMessage={writeT("required")}
        fields={[
          {
            name: "label",
            label: t("labelField"),
            kind: "text",
            required: true,
          },
          {
            name: "deviceType",
            label: t("typeField"),
            kind: "select",
            required: true,
            placeholder: t("selectType"),
            options: (["HANDHELD", "TABLET", "WORKSTATION"] as const).map(
              (value) => ({ value, label: t(`type.${value}`) }),
            ),
          },
          {
            name: "bindCurrent",
            label: t("bindCurrentField"),
            hint: t("bindCurrentHint"),
            kind: "select",
            required: true,
            placeholder: t("selectBinding"),
            options: [
              { value: "YES", label: t("bindCurrentYes") },
              { value: "NO", label: t("bindCurrentNo") },
            ],
          },
        ]}
        toArgs={(values, requestId) => ({
          requestId,
          label: values["label"] ?? "",
          deviceType: (values["deviceType"] ?? "HANDHELD") as DeviceType,
          ...(workspace.selectedWarehouseId === undefined
            ? {}
            : { warehouseId: workspace.selectedWarehouseId }),
          ...(values["bindCurrent"] === "YES"
            ? { installationId: readOrCreateInstallationId() }
            : {}),
        })}
      />

      <MasterDataPanel<DeviceRow, { maxPageSize?: number; cursor?: string }>
        queryRef={listDevicesRef}

        scope="ORG"
        buildArgs={({ cursor }) => (cursor === undefined ? {} : { cursor })}
        renderRows={(rows) => (
          <RowWriteRegion mutationRef={bindDeviceInstallationRef}>
            {({ submit: bind, busy: binding }) => (
              <RowWriteRegion mutationRef={retireDeviceRef}>
                {({ submit: retire, busy: retiring }) => (
                  <DeviceTable
                    rows={rows}
                    renderAction={(row) =>
                      row.status === "RETIRED" ? (
                        <span className="text-xs text-muted">
                          {t("retiredNote")}
                        </span>
                      ) : (
                        <TableRowActions>
                          {row.installationBound ? null : (
                            <TableAction
                              label={t("bindCurrent")}
                              disabled={binding || retiring}
                              data-testid={`device-bind-${row.deviceId}`}
                              onClick={() =>
                                bind(row.deviceId, (requestId) => ({
                                  requestId,
                                  deviceId: row.deviceId,
                                  installationId: readOrCreateInstallationId(),
                                }))
                              }
                            >
                              <Link2 aria-hidden="true" className="size-4" />
                            </TableAction>
                          )}
                          <TableAction
                            label={t("retire")}
                            variant="destructive"
                            disabled={binding || retiring}
                            data-testid={`device-retire-${row.deviceId}`}
                            onClick={() =>
                              retire(row.deviceId, (requestId) => ({
                                requestId,
                                deviceId: row.deviceId,
                              }))
                            }
                          >
                            <Archive aria-hidden="true" className="size-4" />
                          </TableAction>
                        </TableRowActions>
                      )
                    }
                  />
                )}
              </RowWriteRegion>
            )}
          </RowWriteRegion>
        )}
      />
    </div>
  );
}
