"use client";

import { useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "../../../convex/_generated/api";
import { clientRef } from "@/lib/convex/clientRef";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { useScanContinuation } from "@/hooks/useScanContinuation";
import { useCatalogueSync } from "@/hooks/useCatalogueSync";
import { CursorPagination } from "@/components/system/CursorPagination";
import { DataGate } from "@/components/system/DataGate";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Link } from "@/i18n/navigation";
import { storageBuildingPath } from "@/lib/navigation";
import { useState } from "react";
import { MapPinned } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { useCan } from "@/hooks/useCan";
import {
  CompleteNamedLayoutDialog,
  type NamedLocationTarget,
} from "./CompleteNamedLayoutDialog";

const reference = clientRef(api.finishedGoods.jobScanLocations.page);
export function NamedLocationCatalogue({
  warehouseId,
  search,
  status,
  building,
  floor,
}: {
  warehouseId: string;
  search: string;
  status: string;
  building: string;
  floor: string;
}) {
  const locale = useLocale();
  const t = useTranslations("JobScan");
  const tl = useTranslations("StorageLayouts.layoutActions.named");
  const canManage = useCan("masterData.storageLayout.manage");
  // Held above the rows: a completed location leaves this list reactively.
  const [completing, setCompleting] = useState<NamedLocationTarget>();
  const [completed, setCompleted] = useState<{
    code: string;
    floorNumber: number;
    buildingId: string;
  }>();
  const criteria = {
    warehouseId,
    search,
    ...(status !== "ALL" ? { status } : {}),
    ...(building !== "ALL" ? { buildingId: building } : {}),
    ...(floor !== "ALL" ? { floorNumber: Number(floor) } : {}),
  };
  const paging = useCursorPagination({
    scope: `named-locations:${warehouseId}`,
    criteria,
  });
  const scan = useScanContinuation(
    JSON.stringify([criteria, paging.cursor, paging.pageSize]),
  );
  const outcome = useQuery(reference, {
    ...criteria,
    pageSize: paging.pageSize,
    ...(paging.cursor ? { cursor: paging.cursor } : {}),
    ...(scan.cursor ? { scanCursor: scan.cursor } : {}),
  });
  useCatalogueSync({
    outcome,
    continuation: scan,
    paging,
    resetKey: JSON.stringify(criteria),
  });
  return (
    <section className="space-y-3" aria-label={t("registeredLocations")}>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("registeredLocations")}</h2>
        <p className="text-sm text-muted">{t("registeredLocationsHint")}</p>
      </div>
      {completed ? (
        <Notice
          tone="success"
          role="status"
          title={tl("done", {
            code: completed.code,
            floor: completed.floorNumber,
          })}
        >
          <Link
            className="mt-2 inline-flex min-h-11 items-center text-sm text-link underline-offset-4 hover:underline"
            href={`${storageBuildingPath(completed.buildingId)}?floor=${completed.floorNumber}`}
          >
            {tl("openFloor", { floor: completed.floorNumber })}
          </Link>
        </Notice>
      ) : null}
      {completing ? (
        <CompleteNamedLayoutDialog
          warehouseId={warehouseId}
          location={completing}
          onClose={() => setCompleting(undefined)}
          onCompleted={(result) => {
            setCompleted({ ...result, buildingId: completing.buildingId });
            setCompleting(undefined);
          }}
        />
      ) : null}
      <DataGate outcome={outcome}>
        {(result) =>
          result.status === "ready" ? (
            <>
              {result.page.length ? (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {result.page.map((row) =>
                    row.location ? (
                      <li key={row._id} className="space-y-2 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-semibold break-all">
                            {row.location.code}
                          </span>
                          <span className="text-sm">{row.location.name}</span>
                          <StatusBadge
                            tone="warning"
                            label={t("layoutPending")}
                          />
                        </div>
                        <p className="text-sm text-muted">
                          <Link
                            className="text-link hover:underline"
                            href={storageBuildingPath(row.location.buildingId)}
                          >
                            {row.location.buildingName}
                          </Link>
                          {row.location.floorNumber === undefined
                            ? ""
                            : ` · ${t("floorNumber", { number: row.location.floorNumber })}`}
                        </p>
                        <p className="text-sm text-muted">
                          {t("dimensionsNotRecorded")}
                        </p>
                        {canManage ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const location = row.location!;
                              setCompleted(undefined);
                              setCompleting({
                                locationId: location.locationId,
                                code: location.code,
                                name: location.name,
                                buildingId: location.buildingId,
                                floorNumber: location.floorNumber,
                              });
                            }}
                            aria-label={`${tl("complete")} · ${row.location.code}`}
                          >
                            <MapPinned aria-hidden="true" className="size-4" />
                            {tl("complete")}
                          </Button>
                        ) : null}
                      </li>
                    ) : null,
                  )}
                </ul>
              ) : (
                <p className="text-sm text-muted">
                  {t("noRegisteredLocations")}
                </p>
              )}
              <CursorPagination
                locale={locale}
                label={t("registeredLocationPagination")}
                page={paging.page}
                pageSize={paging.pageSize}
                onPageSizeChange={paging.setPageSize}
                onPrevious={paging.previous}
                onNext={() => paging.next(result.continueCursor)}
                canPrevious={paging.canPrevious}
                canNext={!result.isDone}
              />
            </>
          ) : (
            <p role="status" className="text-sm text-muted">
              {t("checkingLocation")}
            </p>
          )
        }
      </DataGate>
    </section>
  );
}
