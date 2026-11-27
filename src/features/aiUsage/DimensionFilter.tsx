"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import { PaginationFooter } from "@/components/system/PaginationFooter";
import { Button } from "@/components/ui/button";
import { CollectionToolbar } from "@/components/system/CollectionToolbar";
import { useCatalogueSync } from "@/hooks/useCatalogueSync";
import { useDebouncedSearch } from "@/hooks/useScanContinuation";
import { useScanRecovery } from "@/hooks/useScanRecovery";
import { clientRef } from "@/lib/convex/clientRef";

export const actorOptionsRef = clientRef(api.aiUsage.dimensions.actorOptions);
export const warehouseOptionsRef = clientRef(
  api.aiUsage.dimensions.warehouseOptions,
);
export const labelsRef = clientRef(api.aiUsage.dimensions.labels);
/** Matches the server's per-request label bound. */
const MAX_LABEL_IDS = 100;

type Labelled = {
  readonly id: string;
  readonly name: string;
  readonly code?: string;
};

/**
 * Names for IDs that one displayed page needs and the report did not label.
 * Requests stay within one page; `null` while loading.
 */
export function useDimensionLabels(
  actorIds: readonly string[],
  warehouseIds: readonly string[],
) {
  const actors = [...new Set(actorIds)].slice(0, MAX_LABEL_IDS).sort();
  const warehouses = [...new Set(warehouseIds)].slice(0, MAX_LABEL_IDS).sort();
  const outcome = useQuery(
    labelsRef,
    actors.length || warehouses.length
      ? { actorIds: actors, warehouseIds: warehouses }
      : "skip",
  );
  const value =
    outcome?.ok && !("error" in outcome.value) ? outcome.value : null;
  return {
    loading: (actors.length > 0 || warehouses.length > 0) && !value,
    user: (id: string) => value?.users.find((u) => u.id === id)?.name,
    warehouse: (id: string) => value?.warehouses.find((w) => w.id === id)?.name,
  };
}

const hasRows = (value: object) =>
  "items" in value && Array.isArray(value.items) && value.items.length > 0;

/**
 * One user or warehouse filter: searchable, server-paged inline radio choices
 * of every organization member or warehouse. The selected value keeps its name
 * when a later search or page excludes it.
 */
export function DimensionFilter({
  kind,
  title,
  value,
  knownLabel,
  hideHeading = false,
  onChange,
}: {
  readonly kind: "actor" | "warehouse";
  readonly title: string;
  readonly value: string;
  /** A name the report or earlier choice already supplied for the selected value. */
  readonly knownLabel?: string | undefined;
  readonly hideHeading?: boolean;
  readonly onChange: (value: string, label?: string) => void;
}) {
  const t = useTranslations("AiUsage");
  const [search, setSearch] = useState("");
  const [chosenLabels, setChosenLabels] = useState<
    Readonly<Record<string, string>>
  >({});
  const typed = search.trim();
  const settled = useDebouncedSearch(typed);
  const [stack, setStack] = useState<{
    key: string;
    cursors: (string | null)[];
  }>({ key: settled, cursors: [null] });
  // A new search starts again at the first page.
  const cursors = stack.key === settled ? stack.cursors : [null];
  if (stack.key !== settled) setStack({ key: settled, cursors: [null] });
  const cursor = cursors.at(-1) ?? null;
  const paging = {
    cursor,
    canPrevious: cursors.length > 1,
    reset: () => setStack({ key: settled, cursors: [null] }),
    previous: () => setStack({ key: settled, cursors: cursors.slice(0, -1) }),
  };
  const requestKey = JSON.stringify([kind, settled, cursor]);
  const recovery = useScanRecovery(requestKey);
  const args =
    typed === settled
      ? {
          ...(settled ? { search: settled } : {}),
          cursor,
          ...(recovery.cursor ? { scanCursor: recovery.cursor } : {}),
          ...(recovery.attempt ? { attempt: recovery.attempt } : {}),
        }
      : ("skip" as const);
  const actorOutcome = useQuery(
    actorOptionsRef,
    kind === "actor" ? args : "skip",
  );
  const warehouseOutcome = useQuery(
    warehouseOptionsRef,
    kind === "warehouse" ? args : "skip",
  );
  const outcome = kind === "actor" ? actorOutcome : warehouseOutcome;
  const tracked = recovery.track(
    outcome === undefined
      ? undefined
      : outcome.ok && outcome.value
        ? { ok: true, value: outcome.value }
        : { ok: false },
  );
  useCatalogueSync({
    outcome: tracked.outcome,
    continuation: tracked.continuation,
    paging,
    resetKey: recovery.key,
    hasRows,
  });
  const page = outcome?.ok ? outcome.value : null;
  const ready = page?.status === "ready" ? page : null;
  const items: readonly Labelled[] = ready?.items ?? [];
  const label = (option: Labelled) =>
    option.code ? `${option.name} · ${option.code}` : option.name;
  const selectedOnPage = items.some((option) => option.id === value);
  const cachedLabel = value ? (chosenLabels[value] ?? knownLabel) : undefined;
  const resolved = useDimensionLabels(
    kind === "actor" && value && !cachedLabel && !selectedOnPage ? [value] : [],
    kind === "warehouse" && value && !cachedLabel && !selectedOnPage
      ? [value]
      : [],
  );
  const selectedName =
    cachedLabel ??
    (kind === "actor" ? resolved.user(value) : resolved.warehouse(value)) ??
    (resolved.loading
      ? "…"
      : t(kind === "actor" ? "unknownUser" : "unknownWarehouse"));
  const failed =
    (outcome && (!outcome.ok || !outcome.value)) ||
    page?.status === "reset" ||
    tracked.stalled;
  // A same-page retry needs new arguments, hence a fresh subscription.
  const retry = () => {
    paging.reset();
    recovery.retry();
  };
  const searchLabel = t(kind === "actor" ? "searchUsers" : "searchWarehouses");
  const groupName = `usage-filter-${kind}`;
  const pending = !ready && !failed && !tracked.paused;
  const select = (nextId: string, nextLabel?: string) => {
    if (nextId && nextLabel)
      setChosenLabels((current) =>
        current[nextId] === nextLabel
          ? current
          : { ...current, [nextId]: nextLabel },
      );
    onChange(nextId, nextLabel);
  };
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend
        className={hideHeading ? "sr-only" : "text-sm font-semibold text-text"}
      >
        {title}
      </legend>
      <CollectionToolbar
        value={search}
        onValueChange={setSearch}
        searchLabel={searchLabel}
        clearLabel={t("clearSearch")}
      />
      <div
        role="radiogroup"
        aria-label={title}
        aria-busy={pending || undefined}
        className="max-h-52 divide-y divide-border overflow-y-auto rounded-md border border-border bg-surface"
      >
        <label className="flex min-h-touch cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-text hover:bg-raised has-checked:bg-accent-surface has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-inset">
          <input
            type="radio"
            name={groupName}
            value=""
            checked={value === ""}
            onChange={() => select("")}
            className="size-4 shrink-0 accent-primary"
          />
          <span className="min-w-0 break-words">{t("all")}</span>
        </label>
        {value && !selectedOnPage ? (
          <label className="flex min-h-touch cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-text hover:bg-raised has-checked:bg-accent-surface has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-inset">
            <input
              type="radio"
              name={groupName}
              value={value}
              checked
              onChange={() => select(value, selectedName)}
              className="size-4 shrink-0 accent-primary"
            />
            <span className="min-w-0 break-words">{selectedName}</span>
          </label>
        ) : null}
        {items.map((option) => {
          const text = label(option);
          return (
            <label
              key={option.id}
              className="flex min-h-touch cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-text hover:bg-raised has-checked:bg-accent-surface has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-inset"
            >
              <input
                type="radio"
                name={groupName}
                value={option.id}
                checked={value === option.id}
                onChange={() => select(option.id, text)}
                className="size-4 shrink-0 accent-primary"
              />
              <span className="min-w-0 break-words">{text}</span>
            </label>
          );
        })}
        {pending ? (
          <p role="status" className="px-3 py-2 text-sm text-muted">
            {t("optionsLoading")}
          </p>
        ) : ready && !items.length && typed ? (
          <p role="status" className="px-3 py-2 text-sm text-muted">
            {t("optionsNoMatch")}
          </p>
        ) : null}
      </div>
      {failed ? (
        <div role="alert" className="space-y-2 text-sm text-danger">
          <p>{t("optionsFailed")}</p>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            {t("optionsRetry")}
          </Button>
        </div>
      ) : tracked.paused ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={recovery.resume}
        >
          {t("optionsContinue")}
        </Button>
      ) : null}
      {(paging.canPrevious || (ready && !ready.isDone)) && (
        <PaginationFooter
          label={t(kind === "actor" ? "userPages" : "warehousePages")}
          pageSizeControl={null}
          status={t("optionsPage", { page: cursors.length })}
          previousLabel={t("breakdownPrevious")}
          nextLabel={t("breakdownNext")}
          canPrevious={paging.canPrevious}
          canNext={Boolean(ready && !ready.isDone)}
          loading={!ready}
          onPrevious={paging.previous}
          onNext={() => {
            if (ready && !ready.isDone)
              setStack({
                key: settled,
                cursors: [...cursors, ready.continueCursor],
              });
          }}
        />
      )}
    </fieldset>
  );
}
