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
