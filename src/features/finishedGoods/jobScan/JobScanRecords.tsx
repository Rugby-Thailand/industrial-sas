"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Search, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { CursorPagination } from "@/components/system/CursorPagination";
import { QueryGate } from "@/components/system/QueryGate";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { useDebouncedSearch } from "@/hooks/useScanContinuation";
import { Button } from "@/components/ui/button";
import { CheckboxControl } from "@/components/ui/CheckboxControl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/ui/PageContainer";
import { Panel } from "@/components/ui/Panel";
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
import { JobScanRecordRow } from "./JobScanRecordRow";
import { pickedLocationPayload } from "./ticketDraft";
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
  const canManage = useCanManage();
  const operation = useOperation();
  const assign = useMutation(fgRefs.assignJobScanLocation);
  const deleteScans = useMutation(fgRefs.deleteJobScans);
  const [filter, setFilter] = useState<Filter>("UNMAPPED");
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<{
    scope: string;
    ids: string[];
  }>({
    scope: "",
    ids: [],
  });
  const [locationSelection, setLocationSelection] = useState<{
    scope: string;
    ids: string[];
  } | null>(null);
  const locationPanel = useRef<HTMLDivElement>(null);
  const [deletion, setDeletion] = useState<{
    ids: string[];
    requestId: string;
  } | null>(null);
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
  const visibleIds = records?.map((record) => record.id) ?? [];
  const visibleIdSet = new Set(visibleIds);
  const selectionScope = JSON.stringify([
    filter,
    settledSearch,
    paging.cursor,
    paging.pageSize,
  ]);
  if (selection.scope !== selectionScope) {
    setSelection({ scope: selectionScope, ids: [] });
    setLocationSelection(null);
  }
  // Only records visible on this page can be acted on, including live removals.
  const selected =
    selection.scope === selectionScope
      ? selection.ids.filter((id) => visibleIdSet.has(id))
      : [];
  const picking =
    locationSelection?.scope === selectionScope &&
    locationSelection.ids.every((id) => visibleIdSet.has(id))
      ? locationSelection
      : null;
  const isPicking = picking !== null;
  useEffect(() => {
    if (!isPicking) return;
    // The menu must release its focus trap before the picker receives focus.
    const frame = requestAnimationFrame(() => {
      locationPanel.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
      locationPanel.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [isPicking]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const someVisibleSelected = visibleIds.some((id) => selected.includes(id));

  function updateSelection(update: (ids: string[]) => string[]) {
    setSelection((current) => ({
      scope: selectionScope,
      ids: update(
        current.scope === selectionScope
          ? current.ids.filter((id) => visibleIdSet.has(id))
          : [],
      ),
    }));
  }

  const toggle = (id: string) =>
    updateSelection((ids) =>
      ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
    );

  function clearSelection() {
    updateSelection(() => []);
    setLocationSelection(null);
    operation.setError("");
  }

  function openLocationPicker(ids: string[]) {
    if (!canManage || operation.busy || !ids.length) return;
    updateSelection(() => ids);
    setLocationSelection({ scope: selectionScope, ids: [...ids] });
    operation.setError("");
    operation.clearRequests();
  }

  const confirmDelete = (ids: string[]) => {
    if (!canManage || operation.busy || !ids.length) return;
    operation.setError("");
    setDeletion({ ids: [...ids], requestId: crypto.randomUUID() });
  };

  async function onDelete() {
    if (!deletion || !canManage) return;
    const result = await operation.run(async () =>
      written(await deleteScans({ warehouseId, ...deletion })),
    );
    if (result === null) return;
    updateSelection((current) =>
      current.filter((id) => !deletion.ids.includes(id)),
    );
    setLocationSelection(null);
    setDeletion(null);
    paging.reset();
  }

  return (
    <PageContainer size="wide" actionInset="responsive">
      <Heading
        title={t("records")}
        helpText={t("recordsSubtitle")}
        description={t("locationNotStock")}
      />
      <div className="space-y-3">
        <div
          role="group"
          className="grid grid-cols-3 border-b border-border sm:flex"
        >
          {(["UNMAPPED", "MAPPED", "ALL"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              disabled={operation.busy}
              onClick={() => {
                setFilter(value);
                clearSelection();
              }}
              className={cn(
                "-mb-px min-h-11 border-b-2 px-2 text-sm font-medium transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-w-44 sm:px-6 md:min-h-9",
                filter === value
                  ? "border-link text-text"
                  : "border-transparent text-muted",
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
            className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted"
          />
          <Input
            value={search}
            disabled={operation.busy}
            onChange={(event) => {
              setSearch(event.target.value);
              clearSelection();
            }}
            placeholder={t("search")}
            className="pl-12"
          />
        </label>
      </div>

      {picking && (
        <div
          ref={locationPanel}
          tabIndex={-1}
          role="region"
          aria-label={t("selectLocation")}
        >
          <Panel className="space-y-3">
            <fieldset disabled={operation.busy} className="space-y-3">
              <h2 className="text-lg font-semibold">{t("selectLocation")}</h2>
              <LocationPicker
                warehouseId={warehouseId}
                allowUnmapped={false}
                onPick={async (location) => {
                  const mapped = pickedLocationPayload(location);
                  if (!canManage || !mapped || operation.busy) return;
                  const target = { ids: picking.ids, location: mapped };
                  const result = await operation.run(async () =>
                    written(
                      await assign({
                        warehouseId,
                        requestId: operation.request(JSON.stringify(target)),
                        ...target,
                      }),
                    ),
                  );
                  if (result === null) return;
                  clearSelection();
                  operation.clearRequests();
                }}
              />
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setLocationSelection(null)}
              >
                {t("cancel")}
              </Button>
            </fieldset>
          </Panel>
        </div>
      )}
      <div>
        {canManage && records && records.length > 0 && (
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border py-2">
            <label className="flex min-h-touch min-w-0 cursor-pointer items-center gap-4 text-sm sm:text-base">
              <CheckboxControl
                className="size-6 shrink-0 accent-primary"
                aria-label={t("selectAll")}
                checked={allVisibleSelected}
                ref={(input) => {
                  if (input)
                    input.indeterminate =
                      someVisibleSelected && !allVisibleSelected;
                }}
                disabled={operation.busy || isPicking}
                onChange={() =>
                  updateSelection(() => (allVisibleSelected ? [] : visibleIds))
                }
              />
              <span aria-live="polite">
                {selected.length
                  ? t("selectedCount", { count: selected.length })
                  : t("selectAll")}
              </span>
            </label>
            {selected.length > 0 && (
              <Button
                variant="destructive"
                className="bg-danger text-destructive-foreground hover:bg-danger/90"
                aria-label={t("deleteSelected", { count: selected.length })}
                disabled={operation.busy || isPicking}
                onClick={() => confirmDelete(selected)}
              >
                <Trash2 aria-hidden="true" className="size-5" />
                {t("deleteCount", { count: selected.length })}
              </Button>
            )}
          </div>
        )}
        {outcome && !outcome.ok ? (
          <LedgerPanelStatus
            state={{ kind: "DENIED", requestId: outcome.requestId }}
          />
        ) : !records ? (
          <Loading />
        ) : !records.length ? (
          <EmptyState title={t("empty")} />
        ) : (
          <ul className="divide-y divide-border border-b border-border">
            {records.map((record) => (
              <JobScanRecordRow
                key={record.id}
                record={record}
                canManage={canManage}
                selected={selected.includes(record.id)}
                disabled={operation.busy || picking !== null}
                onToggle={() => toggle(record.id)}
                onChangeLocation={() => openLocationPicker([record.id])}
                onDelete={() => confirmDelete([record.id])}
              />
            ))}
          </ul>
        )}
      </div>
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
          loading={outcome === undefined || operation.busy}
          locale={locale}
        />
      )}

      {!deletion && <ErrorNotice message={operation.error} />}

      <Dialog
        open={deletion !== null}
        onOpenChange={(open) => {
          if (!open && !operation.busy) setDeletion(null);
        }}
      >
        {deletion && (
          <DialogContent
            size="sm"
            closeLabel={t("cancel")}
            showCloseButton={false}
          >
            <DialogHeader className="pr-0">
              <DialogTitle>
                {t("deleteTitle", { count: deletion.ids.length })}
              </DialogTitle>
              <DialogDescription>{t("deleteDescription")}</DialogDescription>
            </DialogHeader>
            <ErrorNotice message={operation.error} />
            <DialogFooter>
              <Button
                variant="outline"
                disabled={operation.busy}
                onClick={() => setDeletion(null)}
              >
                {t("cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={operation.busy}
                onClick={onDelete}
              >
                <Trash2 aria-hidden="true" />
                {operation.busy ? t("deleting") : t("delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {canManage && selected.length > 0 && !picking && (
        <StickyActionBar placement="responsive">
          <div className="mx-auto max-w-3xl">
            <Button
              className="w-full whitespace-normal"
              disabled={operation.busy}
              onClick={() => openLocationPicker(selected)}
            >
              {t("mapSelected", { count: selected.length })}
            </Button>
          </div>
        </StickyActionBar>
      )}
    </PageContainer>
  );
}
