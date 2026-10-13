"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { LoaderCircle, Search, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { CursorPagination } from "@/components/system/CursorPagination";
import { QueryGate } from "@/components/system/QueryGate";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { useCatalogueSync } from "@/hooks/useCatalogueSync";
import { useWorkflowStep } from "@/hooks/useWorkflowStep";
import { useDraftKey } from "@/hooks/useDraftKey";
import { useDebouncedSearch } from "@/hooks/useScanContinuation";
import { useScanRecovery } from "@/hooks/useScanRecovery";
import { Button } from "@/components/ui/button";
import { CheckboxControl } from "@/components/ui/CheckboxControl";
import {
  Dialog,
  type DialogCompletionHandle,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/Notice";
import { PageContainer } from "@/components/ui/PageContainer";
import { Panel } from "@/components/ui/Panel";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
import type { RefValue } from "@/lib/convex/clientRef";
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
import { JobScanRecordEditor } from "./JobScanRecordEditor";
import { JobScanRecordRow } from "./JobScanRecordRow";
import { pickedLocationPayload, type PickedLocation } from "./ticketDraft";
import { LocationPicker } from "./LocationPicker";
import { useJobScanRecordState } from "./useJobScanRecordState";

const hasRecordRows = (value: object) =>
  "items" in value && Array.isArray(value.items) && value.items.length > 0;

export function JobScanRecordsScreen() {
  const viewScope = useDraftKey("job-scan-records");
  if (!viewScope) return <Loading />;
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => (
        <Records
          key={`${viewScope}:${warehouseId}`}
          warehouseId={warehouseId}
          viewKey={`${viewScope}:${warehouseId}`}
        />
      )}
    </QueryGate>
  );
}

type RecordPage = RefValue<typeof fgRefs.listJobScans>;

function Records({
  warehouseId,
  viewKey,
}: {
  warehouseId: string;
  viewKey: string;
}) {
  const t = useTranslations("JobScan");
  const canManage = useCanManage();
  const operation = useOperation();
  const assign = useMutation(fgRefs.assignJobScanLocation);
  const deleteScans = useMutation(fgRefs.deleteJobScans);
  const { state: criteria, update: updateCriteria } =
    useJobScanRecordState(viewKey);
  const { filter, search } = criteria;
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
  const remapCompletion = useRef<DialogCompletionHandle>(null);
  const deletionCompletion = useRef<DialogCompletionHandle>(null);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState<RecordPage["items"][number] | null>(
    null,
  );
  const [remapReview, setRemapReview] = useState<{
    location: PickedLocation;
    records: RecordPage["items"];
  } | null>(null);
  const [deletion, setDeletion] = useState<{
    ids: string[];
    requestId: string;
  } | null>(null);
  const locale = useLocale();
  const typedSearch = search.trim();
  const settledSearch = useDebouncedSearch(typedSearch);
  const settled = typedSearch === settledSearch;
  const paging = useCursorPagination({
    scope: `job-scans:${viewKey}`,
    criteria: { filter, search: typedSearch },
  });
  const requestKey = JSON.stringify([
    filter,
    settledSearch,
    paging.cursor,
    paging.pageSize,
  ]);
  const recovery = useScanRecovery(requestKey);
  // Rows answer only the settled criteria: obsolete pages are never shown.
  const outcome = useQuery(
    fgRefs.listJobScans,
    settled
      ? {
          warehouseId,
          filter,
          ...(settledSearch ? { search: settledSearch } : {}),
          cursor: paging.cursor,
          pageSize: paging.pageSize,
          progressive: true,
          ...(recovery.cursor ? { scanCursor: recovery.cursor } : {}),
          ...(recovery.attempt ? { attempt: recovery.attempt } : {}),
        }
      : "skip",
  );
  const tracked = recovery.track(outcome);
  useCatalogueSync({
    outcome: tracked.outcome,
    continuation: tracked.continuation,
    paging,
    resetKey: recovery.key,
    hasRows: hasRecordRows,
  });
  // Keep rows already found for this page visible while its scan continues.
  // Those retained rows are read-only until the next answer arrives: their
  // membership may have changed, so no action may target them.
  const [shown, setShown] = useState<{
    key: string;
    progress: string;
    value: RecordPage;
  } | null>(null);
  const latest = outcome?.ok ? outcome.value : undefined;
  const progress = latest
    ? JSON.stringify([
        latest.status,
        latest.scanned,
        latest.continueCursor,
        latest.items.length,
      ])
    : "";
  if (
    settled &&
    latest &&
    (shown?.key !== recovery.key || shown.progress !== progress)
  )
    setShown({ key: recovery.key, progress, value: latest });
  const current =
    !settled || (outcome && !outcome.ok)
      ? undefined
      : (latest ?? (shown?.key === recovery.key ? shown.value : undefined));
  // Rows from the current subscription's own answer, not a retained one.
  const fresh = Boolean(settled && latest);
  const scanning = current?.status === "scanning";
  const checked = current?.status === "scanning" ? current.scanned : 0;
  const failed = current?.status === "reset";
  const retry = () => {
    paging.reset();
    // Same-page retries need new arguments, hence a fresh subscription.
    recovery.retry();
  };
  const ready = current?.status === "ready" ? current : undefined;
  const result = current && current.status !== "reset" ? current : undefined;
  // Every mutation entry point requires fresh rows and an idle operation.
  const actionable = canManage && fresh && !operation.busy;
  const records = result?.items;
  const visibleIds = records?.map((record) => record.id) ?? [];
  const visibleIdSet = new Set(visibleIds);
  const deletionVisible =
    deletion !== null && deletion.ids.every((id) => visibleIdSet.has(id));
  if (deletion && fresh && !operation.busy && !deleting && !deletionVisible)
    setDeletion(null);
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
  const availablePicking =
    locationSelection?.scope === selectionScope &&
    locationSelection.ids.every((id) => visibleIdSet.has(id))
      ? locationSelection
      : null;
  const locationStep = useWorkflowStep(
    "jobRecordsLocation",
    `job-records:${warehouseId}`,
    availablePicking !== null,
    undefined,
    { blocked: operation.busy },
  );
  const picking = locationStep.active ? availablePicking : null;
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

  const toggle = (id: string) => {
    if (!actionable) return;
    updateSelection((ids) =>
      ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
    );
  };

  function clearSelection() {
    updateSelection(() => []);
    setLocationSelection(null);
    operation.setError("");
  }

  function openLocationPicker(ids: string[]) {
    if (!actionable || !ids.length) return;
    updateSelection(() => ids);
    setLocationSelection({ scope: selectionScope, ids: [...ids] });
    locationStep.enter();
    operation.setError("");
    operation.clearRequests();
  }

  const confirmDelete = (ids: string[]) => {
    if (!actionable || !ids.length) return;
    operation.setError("");
    setDeletion({ ids: [...ids], requestId: crypto.randomUUID() });
  };

  async function onDelete() {
    // A confirmation opened on fresh rows waits while they are being updated.
    if (!deletion || !actionable || !deletionVisible) return;
    // Live query rows can disappear as soon as the delete commits. Preserve the
    // owned confirmation until the successful operation consumes its entry.
    setDeleting(true);
    const saved = await operation.run(
      async () => written(await deleteScans({ warehouseId, ...deletion })),
      () => {
        operation.complete(() =>
          deletionCompletion.current?.complete(() => {
            updateSelection((current) =>
              current.filter((id) => !deletion.ids.includes(id)),
            );
            setLocationSelection(null);
            setDeletion(null);
            setDeleting(false);
            paging.reset();
          }),
        );
      },
    );
    if (saved === null) setDeleting(false);
  }

  return (
    <PageContainer size="wide" actionInset="responsive">
      <Heading
        backFallbackHref="/finished-goods/scan"
        title={t("records")}
        helpText={t("recordsSubtitle")}
        description={t("locationNotStock")}
      />
      <div className="space-y-3">
        <div
          role="group"
          aria-label={t("recordList.status")}
          className="grid grid-cols-3 border-b border-border sm:flex"
        >
          {(["UNMAPPED", "MAPPED", "ALL"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              disabled={operation.busy || editing !== null}
              onClick={() => {
                updateCriteria({ filter: value });
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
            disabled={operation.busy || editing !== null}
            maxLength={200}
            onChange={(event) => {
              updateCriteria({ search: event.target.value });
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
            <fieldset
              disabled={operation.busy || editing !== null}
              className="space-y-3"
            >
              <h2 className="text-lg font-semibold">{t("selectLocation")}</h2>
              {!fresh && (
                <p role="status" className="text-sm text-muted">
                  {t("recordList.actionsWait")}
                </p>
              )}
              <fieldset disabled={!fresh} className="contents">
                <LocationPicker
                  warehouseId={warehouseId}
                  allowUnmapped={false}
                  canReadImage={canManage}
                  browseWithoutSearch
                  onPick={(location) => {
                    if (!actionable || !pickedLocationPayload(location)) return;
                    const chosen =
                      records?.filter((record) =>
                        picking.ids.includes(record.id),
                      ) ?? [];
                    if (chosen.length !== picking.ids.length) return;
                    setRemapReview({ location, records: chosen });
                  }}
                />
              </fieldset>
              <Button
                variant="outline"
                className="w-full"
                onClick={locationStep.back}
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
                disabled={!actionable || isPicking}
                onChange={() => {
                  if (actionable)
                    updateSelection(() =>
                      allVisibleSelected ? [] : visibleIds,
                    );
                }}
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
                disabled={!actionable || isPicking}
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
        ) : failed ? (
          <Notice tone="danger" role="alert" title={t("recordList.loadFailed")}>
            <Button variant="outline" className="mt-3" onClick={retry}>
              {t("recordList.retry")}
            </Button>
          </Notice>
        ) : !records ? (
          typedSearch ? (
            <p
              role="status"
              className="flex min-h-12 items-center gap-2 text-sm text-muted"
            >
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
              {t("recordList.searching")}
            </p>
          ) : (
            <Loading />
          )
        ) : !records.length && !scanning ? (
          typedSearch ? (
            <EmptyState
              title={t("recordList.noMatches", { search: typedSearch })}
              body={t("recordList.noMatchesHint")}
              action={
                <Button
                  variant="outline"
                  disabled={operation.busy || editing !== null}
                  onClick={() => {
                    updateCriteria({ search: "" });
                    clearSelection();
                  }}
                >
                  {t("recordList.clearSearch")}
                </Button>
              }
            />
          ) : (
            <EmptyState title={t("empty")} />
          )
        ) : (
          <>
            {tracked.stalled && (
              <Notice
                tone="danger"
                role="alert"
                title={t("recordList.stalled")}
                className="mb-3"
              >
                <Button variant="outline" className="mt-3" onClick={retry}>
                  {t("recordList.retry")}
                </Button>
              </Notice>
            )}
            {records.length > 0 && (
              <ul
                aria-busy={scanning}
                className="divide-y divide-border border-b border-border"
              >
                {records.map((record) => (
                  <JobScanRecordRow
                    key={record.id}
                    record={record}
                    canManage={canManage}
                    selected={selected.includes(record.id)}
                    disabled={!actionable || picking !== null}
                    onToggle={() => toggle(record.id)}
                    onChangeLocation={() => openLocationPicker([record.id])}
                    onDelete={() => confirmDelete([record.id])}
                    onEdit={() => {
                      if (actionable) setEditing(record);
                    }}
                  />
                ))}
              </ul>
            )}
            {tracked.paused ? (
              <div className="flex flex-wrap items-center gap-3 py-3 text-sm text-muted">
                <p role="status">
                  {t("recordList.paused", { count: checked })}
                </p>
                <Button variant="outline" onClick={recovery.resume}>
                  {t("recordList.continue")}
                </Button>
              </div>
            ) : (
              scanning &&
              !tracked.stalled && (
                <p
                  role="status"
                  className="flex min-h-12 items-center gap-2 text-sm text-muted"
                >
                  <LoaderCircle
                    aria-hidden="true"
                    className="size-4 animate-spin motion-reduce:animate-none"
                  />
                  {t("recordList.searchProgress", { count: checked })}
                  {!fresh ? ` ${t("recordList.actionsWait")}` : ""}
                </p>
              )
            )}
          </>
        )}
      </div>
      {result && (paging.canPrevious || !result.isDone) && (
        <CursorPagination
          onFirst={paging.reset}
          historyTruncated={paging.historyTruncated}
          page={paging.page}
          pageSize={paging.pageSize}
          onPageSizeChange={paging.setPageSize}
          onPrevious={paging.previous}
          onNext={() => {
            if (ready && !ready.isDone) paging.next(ready.continueCursor);
          }}
          canPrevious={paging.canPrevious}
          canNext={Boolean(ready && !ready.isDone)}
          loading={!ready || operation.busy}
          locale={locale}
        />
      )}

      {!deletion && <ErrorNotice message={operation.error} />}

      {editing && (
        <JobScanRecordEditor
          key={editing.id}
          warehouseId={warehouseId}
          record={
            records?.find((record) => record.id === editing.id) ?? editing
          }
          onClose={() => setEditing(null)}
        />
      )}
      <Dialog
        open={remapReview !== null}
        completionRef={remapCompletion}
        backPending={operation.busy}
        onOpenChange={(open) => {
          if (!open && !operation.busy) setRemapReview(null);
        }}
      >
        {remapReview && (
          <DialogContent
            closeLabel={t("cancel")}
            showCloseButton={!operation.busy}
          >
            <DialogHeader>
              <DialogTitle>
                {t("remapReviewTitle", { count: remapReview.records.length })}
              </DialogTitle>
              <DialogDescription>{t("locationNotStock")}</DialogDescription>
            </DialogHeader>
            <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
              {remapReview.records.map((record) => (
                <li key={record.id}>
                  {record.factoryOrder}:{" "}
                  {record.locationCode ?? record.locationText} →{" "}
                  {remapReview.location.code}
                </li>
              ))}
            </ul>
            <ErrorNotice message={operation.error} />
            {remapReview.records.some(
              (snapshot) =>
                !records?.some(
                  (record) =>
                    record.id === snapshot.id &&
                    record.version === snapshot.version,
                ),
            ) && (
              <p role="alert" className="text-sm text-warning">
                {t("recordConflict")}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={operation.busy || editing !== null}
                onClick={() => setRemapReview(null)}
              >
                {t("cancel")}
              </Button>
              <Button
                disabled={
                  !actionable ||
                  remapReview.records.some(
                    (snapshot) =>
                      !records?.some(
                        (record) =>
                          record.id === snapshot.id &&
                          record.version === snapshot.version,
                      ),
                  )
                }
                onClick={() => {
                  const location = pickedLocationPayload(remapReview.location);
                  if (!location || !actionable) return;
                  const target = {
                    ids: remapReview.records.map((record) => record.id),
                    location,
                    expectedVersions: remapReview.records.map((record) => ({
                      id: record.id,
                      version: record.version,
                    })),
                  };
                  void operation.run(
                    async () =>
                      written(
                        await assign({
                          warehouseId,
                          requestId: operation.request(JSON.stringify(target)),
                          ...target,
                        }),
                      ),
                    () => {
                      operation.complete(() =>
                        remapCompletion.current?.complete(() =>
                          locationStep.complete(() => {
                            clearSelection();
                            operation.clearRequests();
                          }),
                        ),
                      );
                    },
                  );
                }}
              >
                {t("remapConfirm", { count: remapReview.records.length })}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog
        open={deletion !== null}
        completionRef={deletionCompletion}
        backPending={operation.busy}
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
            {!fresh && (
              <p role="status" className="text-sm text-muted">
                {t("recordList.actionsWait")}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={operation.busy || editing !== null}
                onClick={() => setDeletion(null)}
              >
                {t("cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={!actionable}
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
              disabled={!actionable}
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
