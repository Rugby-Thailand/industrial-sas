"use client";

import { Spinner } from "@/components/ui/spinner";

import { useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { MapPin, Trash2, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { CursorPagination } from "@/components/system/CursorPagination";
import { QueryGate } from "@/components/system/QueryGate";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { useEffectiveWarehouse } from "@/lib/workspace/useEffectiveWarehouse";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { useCatalogueSync } from "@/hooks/useCatalogueSync";
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
import { Notice } from "@/components/ui/Notice";
import { PageContainer } from "@/components/ui/PageContainer";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
import type { RefValue } from "@/lib/convex/clientRef";
import { fgRefs } from "@/lib/convex/finishedGoodsApi";
import { requireWritten } from "@/lib/convex/mutationOutcome";
import { guardedNavigate } from "@/lib/navigationGuard";
import { cn } from "@/lib/utils";
import {
  ErrorNotice,
  Heading,
  Loading,
  useCanManage,
  useOperation,
} from "../shared";
import { JobScanRecordEditor } from "./JobScanRecordEditor";
import { JobScanRecordAssist } from "./JobScanRecordAssist";
import { JobScanRecordRow } from "./JobScanRecordRow";
import { JobScanRecordSearch } from "./JobScanRecordSearch";
import { pickedLocationPayload, type PickedLocation } from "./ticketDraft";
import { LocationPicker } from "./LocationPicker";
import { useJobScanRecordState } from "./useJobScanRecordState";

const hasRecordRows = (value: object) =>
  "items" in value && Array.isArray(value.items) && value.items.length > 0;

/** The header stays in place while the session and warehouse load. */
export function JobScanRecordsScreen({
  requestedWarehouseId,
}: {
  readonly requestedWarehouseId?: string;
} = {}) {
  const t = useTranslations("JobScan");
  const viewScope = useDraftKey("job-scan-records");
  const loadingLabel = t("recordList.loading");
  return (
    <PageContainer size="wide" actionInset="responsive">
      <Heading
        backFallbackHref="/finished-goods/scan"
        title={t("records")}
        helpText={t("recordsSubtitle")}
        description={t("locationNotStock")}
      />
      {viewScope ? (
        <QueryGate scope="WAREHOUSE" loadingLabel={loadingLabel}>
          {(activeWarehouseId) => (
            <JobScanRecordsWarehouseView
              viewScope={viewScope}
              activeWarehouseId={activeWarehouseId}
              loadingLabel={loadingLabel}
              {...(requestedWarehouseId ? { requestedWarehouseId } : {})}
            />
          )}
        </QueryGate>
      ) : (
        <Loading label={loadingLabel} />
      )}
    </PageContainer>
  );
}

function JobScanRecordsWarehouseView({
  viewScope,
  activeWarehouseId,
  loadingLabel,
  requestedWarehouseId,
}: {
  readonly viewScope: string;
  readonly activeWarehouseId: string;
  readonly loadingLabel: string;
  readonly requestedWarehouseId?: string;
}) {
  const { warehouseId } = useEffectiveWarehouse(
    activeWarehouseId,
    requestedWarehouseId,
  );
  return (
    <Records
      key={`${viewScope}:${warehouseId}`}
      warehouseId={warehouseId}
      viewKey={`${viewScope}:${warehouseId}`}
      loadingLabel={loadingLabel}
    />
  );
}

type RecordPage = RefValue<typeof fgRefs.listJobScans>;

function Records({
  warehouseId,
  viewKey,
  loadingLabel,
}: {
  warehouseId: string;
  viewKey: string;
  loadingLabel: string;
}) {
  const t = useTranslations("JobScan");
  const appT = useTranslations("App");
  const canManage = useCanManage();
  const convex = useConvex();
  const operation = useOperation();
  const assign = useMutation(fgRefs.assignJobScanLocation);
  const deleteScans = useMutation(fgRefs.deleteJobScans);
  const { state: criteria, update: updateCriteria } =
    useJobScanRecordState(viewKey);
  const { filter, search, searchField, exactCode, locationId, facets } =
    criteria;
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
  const locationCompletion = useRef<DialogCompletionHandle>(null);
  const locationOpener = useRef<HTMLElement | null>(null);
  const lastLocationSelection = useRef<{
    scope: string;
    ids: string[];
  } | null>(null);
  const [locationEpoch, setLocationEpoch] = useState(0);
  const [assigning, setAssigning] = useState(false);
  const remapCompletion = useRef<DialogCompletionHandle>(null);
  const deletionCompletion = useRef<DialogCompletionHandle>(null);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState<RecordPage["items"][number] | null>(
    null,
  );
  const finishManualEdit = useRef<
    { settle: () => void; close: () => void } | undefined
  >(undefined);
  const [assisting, setAssisting] = useState<
    RecordPage["items"][number] | null
  >(null);
  const [remapReview, setRemapReview] = useState<{
    location: PickedLocation;
    records: RecordPage["items"];
    command?: Parameters<typeof assign>[0];
  } | null>(null);
  const retainedRemap = useRef<{
    picker: NonNullable<typeof locationSelection>;
    review: NonNullable<typeof remapReview>;
  } | null>(null);
  const [remapEpoch, setRemapEpoch] = useState(0);
  const [deletion, setDeletion] = useState<{
    ids: string[];
    requestId: string;
  } | null>(null);
  const locale = useLocale();
  const typedSearch = search.trim();
  const searching = Boolean(typedSearch || facets);
  const settledSearch = useDebouncedSearch(typedSearch);
  const settled = typedSearch === settledSearch;
  const paging = useCursorPagination({
    scope: `job-scans:${viewKey}`,
    criteria: {
      filter,
      search: typedSearch,
      searchField,
      exactCode,
      locationId,
      facets,
    },
  });
  const requestKey = JSON.stringify([
    filter,
    settledSearch,
    searchField,
    exactCode,
    locationId,
    facets,
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
          ...(searchField && settledSearch ? { searchField } : {}),
          ...(exactCode && settledSearch ? { exactCode } : {}),
          ...(locationId ? { locationId } : {}),
          ...(facets ? { facets } : {}),
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
  const selectionScope = requestKey;
  if (selection.scope !== selectionScope) {
    setSelection({ scope: selectionScope, ids: [] });
    if (locationSelection) setLocationEpoch((epoch) => epoch + 1);
    setLocationSelection(null);
  }
  // Only records visible on this page can be acted on, including live removals.
  const selected =
    selection.scope === selectionScope
      ? selection.ids.filter((id) => visibleIdSet.has(id))
      : [];
  const locationVisible =
    locationSelection !== null &&
    locationSelection.scope === selectionScope &&
    locationSelection.ids.every((id) => visibleIdSet.has(id));
  if (
    locationSelection &&
    fresh &&
    !operation.busy &&
    !assigning &&
    !remapReview &&
    !locationVisible
  ) {
    setLocationEpoch((epoch) => epoch + 1);
    setLocationSelection(null);
  }
  const picking =
    locationSelection?.scope === selectionScope ? locationSelection : null;
  const isPicking = picking !== null;
  const pickingRecords = picking
    ? (records?.filter((record) => picking.ids.includes(record.id)) ?? [])
    : [];
  const singlePickingRecord =
    picking?.ids.length === 1 && pickingRecords.length === 1
      ? pickingRecords[0]
      : undefined;
  const pickerTitle = singlePickingRecord
    ? singlePickingRecord.mapped
      ? t("changeLocation")
      : t("setLocation")
    : t("setSelectedLocation");
  const destination = remapReview?.location;
  const destinationDetails = [
    destination?.buildingName,
    destination?.floorNumber !== undefined
      ? t("floorNumber", { number: destination.floorNumber })
      : undefined,
    destination?.name !== destination?.code ? destination?.name : undefined,
    destination?.layoutPending ? t("layoutPending") : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
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
    if (lastLocationSelection.current) retireLocationPicker();
    operation.setError("");
  }

  function openLocationPicker(ids: string[], opener?: HTMLElement | null) {
    if (!actionable || !ids.length) return;
    if (retainedRemap.current) discardRemapReview();
    locationOpener.current =
      opener ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    const next = { scope: selectionScope, ids: [...ids] };
    updateSelection(() => ids);
    lastLocationSelection.current = next;
    setLocationSelection(next);
    operation.setError("");
  }

  function retireLocationPicker() {
    lastLocationSelection.current = null;
    if (retainedRemap.current) discardRemapReview();
    setLocationSelection(null);
    setLocationEpoch((epoch) => epoch + 1);
  }

  function dismissLocationPicker() {
    if (operation.busy || !picking) return;
    guardedNavigate(() => {
      if (!locationCompletion.current?.completeOwned?.(retireLocationPicker))
        retireLocationPicker();
    });
  }

  function discardRemapReview() {
    retainedRemap.current = null;
    setRemapReview(null);
    setRemapEpoch((epoch) => epoch + 1);
  }

  function dismissRemapReview() {
    if (operation.busy || !remapReview) return;
    if (!remapCompletion.current?.completeOwned?.(discardRemapReview))
      discardRemapReview();
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
      async () =>
        requireWritten(await deleteScans({ warehouseId, ...deletion })),
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
    <>
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
        <JobScanRecordSearch
          warehouseId={warehouseId}
          criteria={criteria}
          canManage={canManage}
          disabled={operation.busy || editing !== null || assisting !== null}
          onChange={(next) => {
            updateCriteria(next);
            clearSelection();
          }}
          interpret={async (prompt) => {
            const outcome = await convex.action(fgRefs.interpretJobScanSearch, {
              warehouseId,
              prompt,
            });
            return outcome.ok && outcome.value.ok ? outcome.value.value : null;
          }}
          readTicketPhoto={async (imageDataUrl) => {
            const outcome = await convex.action(fgRefs.readJobTicketForSearch, {
              warehouseId,
              imageDataUrl,
            });
            return outcome.ok
              ? outcome.value
              : { ok: false, error: { code: "AI_DENIED" } };
          }}
        />
      </div>

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
          searching ? (
            <p
              role="status"
              className="flex min-h-12 items-center gap-2 text-sm text-muted"
            >
              <Spinner aria-hidden="true" className="size-4" />
              {t("recordList.searching")}
            </p>
          ) : (
            <Loading label={loadingLabel} />
          )
        ) : !records.length && !scanning ? (
          searching ? (
            <EmptyState
              title={
                typedSearch
                  ? t("recordList.noMatches", { search: typedSearch })
                  : t("recordTools.noFacetMatches")
              }
              body={t("recordList.noMatchesHint")}
              action={
                !searchField && !exactCode && !locationId && !facets ? (
                  <Button
                    variant="outline"
                    disabled={operation.busy || editing !== null}
                    onClick={() => {
                      updateCriteria({
                        search: "",
                        searchField: undefined,
                        exactCode: undefined,
                        locationId: undefined,
                        facets: undefined,
                      });
                      clearSelection();
                    }}
                  >
                    {t("recordList.clearSearch")}
                  </Button>
                ) : undefined
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
                    onChangeLocation={(opener) =>
                      openLocationPicker([record.id], opener)
                    }
                    onDelete={() => confirmDelete([record.id])}
                    onEdit={() => {
                      if (actionable) setEditing(record);
                    }}
                    onAssist={() => {
                      if (actionable) setAssisting(record);
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
                  <Spinner aria-hidden="true" className="size-4" />
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

      {assisting && (
        <JobScanRecordAssist
          key={assisting.id}
          record={assisting}
          warehouseId={warehouseId}
          enabled={
            actionable &&
            Boolean(
              records?.some(
                (record) =>
                  record.id === assisting.id &&
                  record.version === assisting.version,
              ),
            )
          }
          interpret={async (prompt) => {
            const outcome = await convex.action(fgRefs.proposeJobScanEdit, {
              warehouseId,
              prompt,
            });
            return outcome.ok && outcome.value.ok ? outcome.value.value : null;
          }}
          onClose={() => setAssisting(null)}
          onManualEdit={(completion) => {
            const record = records?.find(
              (record) => record.id === assisting.id,
            );
            if (record && actionable) {
              finishManualEdit.current = completion;
              setEditing(record);
            }
          }}
        />
      )}
      {editing && (
        <JobScanRecordEditor
          key={`manual:${editing.id}`}
          warehouseId={warehouseId}
          record={
            records?.find((record) => record.id === editing.id) ?? editing
          }
          onClose={() => {
            finishManualEdit.current = undefined;
            setEditing(null);
          }}
          onSaveSuccess={() => finishManualEdit.current?.settle()}
          onSaved={() => {
            const finish = finishManualEdit.current;
            finishManualEdit.current = undefined;
            setEditing(null);
            finish?.close();
          }}
        />
      )}
      <Dialog
        open={picking !== null}
        completionRef={locationCompletion}
        backPending={operation.busy}
        backRevocationEpoch={locationEpoch}
        onOpenChange={(open) => {
          if (operation.busy) return;
          if (!open) {
            setLocationSelection(null);
          } else {
            const previous = lastLocationSelection.current;
            if (
              canManage &&
              previous &&
              previous.scope === selectionScope &&
              previous.ids.every((id) => visibleIdSet.has(id))
            ) {
              setLocationSelection(previous);
            } else {
              retireLocationPicker();
            }
          }
        }}
      >
        {picking && (
          <DialogContent
            size="sm"
            closeLabel={appT("close")}
            showCloseButton={false}
            className="gap-4"
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              dismissLocationPicker();
            }}
            onPointerDownOutside={(event) => {
              event.preventDefault();
              dismissLocationPicker();
            }}
            onCloseAutoFocus={(event) => {
              const target = locationOpener.current;
              if (target?.isConnected) {
                event.preventDefault();
                target.focus();
              }
            }}
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MapPin
                  aria-hidden="true"
                  className="size-5 shrink-0 text-link"
                />
                <span>{pickerTitle}</span>
              </DialogTitle>
              <DialogDescription asChild>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                  {singlePickingRecord ? (
                    <>
                      <span className="font-mono font-semibold break-all text-text">
                        {singlePickingRecord.factoryOrder}
                      </span>
                      <span>
                        {t("currentLocation", {
                          location:
                            singlePickingRecord.locationCode ??
                            (singlePickingRecord.locationText ||
                              t("statusUnmapped")),
                        })}
                      </span>
                    </>
                  ) : (
                    <span className="font-medium text-text">
                      {t("selectedCount", { count: picking.ids.length })}
                    </span>
                  )}
                </div>
              </DialogDescription>
            </DialogHeader>
            <fieldset
              disabled={operation.busy || editing !== null}
              className="space-y-3"
            >
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
                  presentation="compact"
                  onPick={(location) => {
                    if (!actionable || !pickedLocationPayload(location)) return;
                    const chosen =
                      records?.filter((record) =>
                        picking.ids.includes(record.id),
                      ) ?? [];
                    if (chosen.length !== picking.ids.length) return;
                    const review = { location, records: chosen };
                    retainedRemap.current = { picker: picking, review };
                    setRemapReview(review);
                  }}
                />
              </fieldset>
            </fieldset>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={operation.busy || editing !== null}
                onClick={dismissLocationPicker}
              >
                {t("cancel")}
              </Button>
            </DialogFooter>
            {!operation.busy && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-3 right-3"
                disabled={editing !== null}
                onClick={dismissLocationPicker}
              >
                <XIcon aria-hidden="true" className="size-4" />
                <span className="sr-only">{appT("close")}</span>
              </Button>
            )}
          </DialogContent>
        )}
      </Dialog>

      <Dialog
        open={remapReview !== null}
        completionRef={remapCompletion}
        backPending={operation.busy}
        backRevocationEpoch={remapEpoch}
        onOpenChange={(open) => {
          if (operation.busy) return;
          const retained = retainedRemap.current;
          if (!open) {
            if (retained && remapReview) retained.review = remapReview;
            setRemapReview(null);
          } else if (
            retained &&
            canManage &&
            picking === retained.picker &&
            retained.review.records.every((record) =>
              visibleIdSet.has(record.id),
            )
          ) {
            setRemapReview(retained.review);
          } else {
            discardRemapReview();
          }
        }}
      >
        {remapReview && (
          <DialogContent
            size="sm"
            closeLabel={appT("close")}
            showCloseButton={false}
            className="gap-4"
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              dismissRemapReview();
            }}
            onPointerDownOutside={(event) => {
              event.preventDefault();
              dismissRemapReview();
            }}
          >
            {!operation.busy && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-3 right-3"
                onClick={dismissRemapReview}
              >
                <XIcon aria-hidden="true" className="size-4" />
                <span className="sr-only">{appT("close")}</span>
              </Button>
            )}
            <DialogHeader>
              <DialogTitle>
                {t("remapReviewTitle", { count: remapReview.records.length })}
              </DialogTitle>
              <DialogDescription className="break-words">
                {destinationDetails && (
                  <span className="mb-1 block">{destinationDetails}</span>
                )}
                <span className="block">{t("locationNotStock")}</span>
              </DialogDescription>
            </DialogHeader>
            <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
              {remapReview.records.map((record) => (
                <li key={record.id} className="space-y-1 px-3 py-2">
                  <p className="font-mono font-semibold break-all text-text">
                    {record.factoryOrder}
                  </p>
                  <p className="break-all text-muted">
                    <span>{record.locationCode ?? record.locationText}</span>
                    {" → "}
                    <span className="font-mono font-semibold text-link">
                      {remapReview.location.code}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
            <ErrorNotice message={operation.error} />
            {!remapReview.command &&
              remapReview.records.some(
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
            {remapReview.command && !operation.busy && (
              <p role="status" className="text-sm text-muted">
                {t("locationChangeRecovery")}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={operation.busy || editing !== null}
                onClick={dismissRemapReview}
              >
                {t("cancel")}
              </Button>
              <Button
                disabled={
                  !canManage ||
                  operation.busy ||
                  (!remapReview.command &&
                    (!actionable ||
                      remapReview.records.some(
                        (snapshot) =>
                          !records?.some(
                            (record) =>
                              record.id === snapshot.id &&
                              record.version === snapshot.version,
                          ),
                      )))
                }
                onClick={() => {
                  if (!canManage || operation.busy) return;
                  let command = remapReview.command;
                  if (!command) {
                    const location = pickedLocationPayload(
                      remapReview.location,
                    );
                    if (!location || !actionable) return;
                    const target = {
                      ids: remapReview.records.map((record) => record.id),
                      location,
                      expectedVersions: remapReview.records.map((record) => ({
                        id: record.id,
                        version: record.version,
                      })),
                    };
                    command = {
                      warehouseId,
                      requestId: operation.request(
                        JSON.stringify(target),
                        "ephemeral",
                      ),
                      ...target,
                    };
                  }
                  const payload = command;
                  // Only this immutable attempted command may bypass live-row
                  // preflight to recover an accepted write after response loss.
                  setRemapReview((current) =>
                    current ? { ...current, command: payload } : null,
                  );
                  setAssigning(true);
                  void operation
                    .run(
                      async () => assign(payload),
                      (outcome) => {
                        setRemapReview((current) =>
                          current
                            ? {
                                location: current.location,
                                records: current.records,
                              }
                            : null,
                        );
                        let completed = false;
                        try {
                          requireWritten(outcome);
                          completed = true;
                        } finally {
                          if (!completed) setAssigning(false);
                        }
                        operation.complete(() =>
                          remapCompletion.current?.complete(
                            () =>
                              locationCompletion.current?.complete(
                                () => {
                                  clearSelection();
                                  setAssigning(false);
                                  operation.clearRequests();
                                },
                                () => setAssigning(false),
                              ),
                            () => setAssigning(false),
                          ),
                        );
                      },
                    )
                    .then((saved) => {
                      if (saved === null) setAssigning(false);
                    });
                }}
              >
                {remapReview.command && !operation.busy
                  ? t("retryLocationChange")
                  : t("remapConfirm", { count: remapReview.records.length })}
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

      {canManage && selected.length > 0 && (
        <StickyActionBar placement="responsive">
          <div className="mx-auto max-w-3xl">
            <Button
              className="w-full whitespace-normal"
              disabled={!actionable || isPicking}
              onClick={(event) =>
                openLocationPicker(selected, event.currentTarget)
              }
            >
              {t("mapSelected", { count: selected.length })}
            </Button>
          </div>
        </StickyActionBar>
      )}
    </>
  );
}
