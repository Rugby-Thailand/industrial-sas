"use client";

/**
 * The device registry, as an administrator reads it (`FF-P1-08`).
 *
 * Deliberately dull, and deliberately complete: every registered scanner and
 * workstation, whether an installation is bound to it, when it last checked in,
 * and whether it has been retired. The point of the screen is that somebody can
 * stand next to a handheld, read the label on its case, and find the same label
 * here — so the label is the row header and the identifiers are secondary.
 *
 * What it does **not** render is the installation value itself. It is a
 * correlation string, the registry has no reason to show it, and putting it on
 * every row would spread a device-identifying value across screenshots, exports,
 * and support tickets for no reader.
 */
import { useTranslations } from "next-intl";

import { DeviceTable } from "@/components/platform/DeviceTable";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import {
  RowActionButton,
  RowWriteRegion,
} from "@/features/masterData/RowWriteRegion";
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
import { previewDevicesFor } from "@/lib/preview/operatorWorkPreview";

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
        // Organization-scoped: a device belongs to the tenant, and its home
        // warehouse is a field on the row rather than the scope of the read.
        scope="ORG"
        buildArgs={({ cursor }) => (cursor === undefined ? {} : { cursor })}
        previewRowsFor={previewDevicesFor}
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
                        <span className="flex flex-wrap gap-2">
                          {row.installationBound ? null : (
                            <RowActionButton
                              busy={binding || retiring}
                              testId={`device-bind-${row.deviceId}`}
                              label={t("bindCurrent")}
                              title={t("bindCurrentActionHint")}
                              onClick={() =>
                                bind(row.deviceId, (requestId) => ({
                                  requestId,
                                  deviceId: row.deviceId,
                                  installationId: readOrCreateInstallationId(),
                                }))
                              }
                            />
                          )}
                          <RowActionButton
                            busy={binding || retiring}
                            testId={`device-retire-${row.deviceId}`}
                            label={t("retire")}
                            title={t("retireHint")}
                            onClick={() =>
                              retire(row.deviceId, (requestId) => ({
                                requestId,
                                deviceId: row.deviceId,
                              }))
                            }
                          />
                        </span>
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
