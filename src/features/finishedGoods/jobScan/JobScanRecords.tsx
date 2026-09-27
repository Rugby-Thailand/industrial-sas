"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Search } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { CursorPagination } from "@/components/system/CursorPagination";
import { QueryGate } from "@/components/system/QueryGate";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { useDebouncedSearch } from "@/hooks/useScanContinuation";
import { Button } from "@/components/ui/button";
import { CheckboxControl } from "@/components/ui/CheckboxControl";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/ui/PageContainer";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { cn } from "@/lib/utils";
import {
  ErrorNotice,
  Heading,
  Loading,
  useCanManage,
  useOperation,
  written,
} from "../shared";
import { LocationSummary } from "./JobScanScreen";
import { LocationPicker } from "./LocationPicker";

type Filter = "ALL" | "UNMAPPED" | "MAPPED";

export function JobScanRecordsScreen() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => <Records key={warehouseId} warehouseId={warehouseId} />}
    </QueryGate>
  );
}

function Records({ warehouseId }: { warehouseId: string }) {
  const t = useTranslations("JobScan");
  const format = useFormatter();
  const canManage = useCanManage();
  const operation = useOperation();
  const assign = useMutation(fgRefs.assignJobScanLocation);
  const [filter, setFilter] = useState<Filter>("UNMAPPED");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const locale = useLocale();
  const settledSearch = useDebouncedSearch(search.trim());
  const paging = useCursorPagination({
    scope: `job-scans:${warehouseId}`,
    criteria: { filter, search: settledSearch },
  });
  const outcome = useQuery(fgRefs.listJobScans, {
    warehouseId,
    filter,
    ...(settledSearch ? { search: settledSearch } : {}),
    cursor: paging.cursor,
    pageSize: paging.pageSize,
  });
  const result = outcome?.ok ? outcome.value : undefined;
  const records = result?.items;

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  return (
    <PageContainer size="form" actionInset="fixed">
      <Heading title={t("records")} description={t("recordsSubtitle")} />
      <div className="space-y-3">
        <div
          role="group"
          className="grid grid-cols-3 gap-1 rounded-lg bg-raised p-1"
        >
          {(["UNMAPPED", "MAPPED", "ALL"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setSelected([]);
                setPicking(false);
              }}
              className={cn(
                "min-h-10 rounded-md text-sm font-medium",
                filter === value ? "bg-surface shadow-sm" : "text-muted",
              )}
            >
              {value === "ALL"
                ? t("all")
                : value === "MAPPED"
                  ? t("mapped")
                  : t("unmapped")}
            </button>
          ))}
        </div>
        <label className="relative block">
          <span className="sr-only">{t("search")}</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
          />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setSelected([]);
              setPicking(false);
            }}
            placeholder={t("search")}
            className="min-h-11 pl-9"
          />
        </label>
      </div>

      {picking && (
        <Panel className="space-y-3">
          <h2 className="text-lg font-semibold">{t("selectLocation")}</h2>
          <LocationPicker
            warehouseId={warehouseId}
            allowUnmapped={false}
            onPick={async (location) => {
              if (!location.zoneId) return;
              const result = await operation.run(async () =>
                written(
                  await assign({
                    warehouseId,
                    requestId: crypto.randomUUID(),
                    ids: selected,
                    location: {
                      zoneId: location.zoneId!,
                      ...(location.supportPositionId
                        ? { supportPositionId: location.supportPositionId }
                        : {}),
                    },
                  }),
                ),
              );
              if (result === null) return;
              setSelected([]);
              setPicking(false);
            }}
          />
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setPicking(false)}
          >
            {t("cancel")}
          </Button>
        </Panel>
      )}
      {!records ? (
        <Loading />
      ) : !records.length ? (
        <EmptyState title={t("empty")} />
      ) : (
        <ul className="space-y-2">
          {records.map((record) => (
            <li
              key={record.id}
              className={cn(
                "flex gap-3 rounded-xl border bg-surface p-3",
                selected.includes(record.id) ? "border-link" : "border-border",
              )}
            >
              {canManage && (
                <CheckboxControl
                  className="mt-1 size-5"
                  aria-label={`${t("select")} ${record.factoryOrder}`}
                  checked={selected.includes(record.id)}
                  onChange={() => toggle(record.id)}
                />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">
                    {record.factoryOrder}
                  </span>
                  <span className="font-mono text-sm text-muted">
                    {record.productBarcodeText}
                  </span>
                </div>
                {(record.partName || record.quantity !== undefined) && (
                  <p className="text-sm">
                    {record.partName}
                    {record.quantity !== undefined &&
                      ` · ${format.number(record.quantity)}`}
                  </p>
                )}
                <LocationSummary
                  code={record.locationCode ?? record.locationText}
                  name={record.locationName}
                  mapped={record.mapped}
                />
                {record.mapped &&
                  record.locationText !== record.locationCode && (
                    <p className="text-xs text-muted">
                      “{record.locationText}”
                    </p>
                  )}
                <p className="flex items-center gap-2 text-xs text-muted">
                  <StatusBadge
                    tone="muted"
                    label={t(`source.${record.source}`)}
                  />
                  {format.dateTime(record.createdAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
              {record.imageUrl && (
                <a
                  href={record.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t("openPhoto")}
                  className="shrink-0"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote upload thumbnail */}
                  <img
                    src={record.imageUrl}
                    alt=""
                    className="h-20 w-14 rounded-md border border-border object-cover"
                  />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {(paging.canPrevious || (result && !result.isDone)) && (
        <CursorPagination
          onFirst={paging.reset}
          historyTruncated={paging.historyTruncated}
          page={paging.page}
          pageSize={paging.pageSize}
          onPageSizeChange={paging.setPageSize}
          onPrevious={paging.previous}
          onNext={() => {
            if (result) paging.next(result.continueCursor);
          }}
          canPrevious={paging.canPrevious}
          canNext={Boolean(result && !result.isDone)}
          loading={outcome === undefined}
          locale={locale}
        />
      )}

      <ErrorNotice message={operation.error} />

      {canManage && selected.length > 0 && !picking && (
        <StickyActionBar placement="fixed">
          <div className="mx-auto max-w-3xl">
            <Button
              className="min-h-12 w-full"
              onClick={() => setPicking(true)}
            >
              {t("mapSelected", { count: selected.length })}
            </Button>
          </div>
        </StickyActionBar>
      )}
    </PageContainer>
  );
}
