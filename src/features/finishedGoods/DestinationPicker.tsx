"use client";

import { MapPin, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaginationFooter } from "@/components/system/PaginationFooter";
import {
  LOCAL_PAGE_SIZES,
  PageSizeSelect,
} from "@/components/system/PageSizeSelect";
import type { Candidate } from "@/lib/convex/finishedGoodsApi";
import { mmText, useFGText } from "./shared";
import { usePreviewState } from "./usePreviewState";

export function destinationKey(candidate: Candidate) {
  const support = candidate.supportPalletId
    ? `pallet:${candidate.supportPalletId}`
    : candidate.supportPositionId
      ? `position:${candidate.supportPositionId}`
      : "floor";
  return `${candidate.zoneId}:${support}`;
}

export function filterDestinations(
  candidates: readonly Candidate[],
  search: string,
) {
  const needle = search.trim().toLocaleLowerCase();
  return candidates.filter((candidate) =>
    [
      candidate.locationName,
      candidate.locationCode,
      candidate.buildingName,
      candidate.buildingCode,
      `Floor ${candidate.floorNumber}`,
      `ชั้น ${candidate.floorNumber}`,
      candidate.supportLabel,
      candidate.supportCode,
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle),
  );
}

/** The caller owns eligibility, ordering and selection; search only narrows the list. */
export function DestinationPicker({
  candidates,
  selected,
  onSelect,
  recommended,
  context = "storage",
  stateKey,
}: {
  candidates: readonly Candidate[];
  selected: string;
  onSelect: (key: string) => void;
  recommended?: Candidate | undefined;
  context?: "storage" | "move";
  stateKey?: string | undefined;
}) {
  const { t } = useFGText();
  const [view, setView] = usePreviewState(stateKey, {
    search: "",
    page: 1,
    size: 25,
  });
  const { search } = view;
  // Searching or resizing returns to the first page of the complete list.
  const setSearch = (search: string) => setView({ ...view, search, page: 1 });
  const filtered = filterDestinations(candidates, search);
  const size = (LOCAL_PAGE_SIZES as readonly number[]).includes(view.size)
    ? (view.size as (typeof LOCAL_PAGE_SIZES)[number])
    : 25;
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const page = Math.min(Math.max(1, Math.floor(view.page)), pages);
  const first = (page - 1) * size;
  const shown = filtered.slice(first, first + size);
  // The server ranks every eligible destination. Paging only limits how many
  // are rendered, so the chosen and recommended ones stay reachable here.
  const pinned = filtered.filter(
    (candidate) =>
      !shown.includes(candidate) &&
      [selected, recommended && destinationKey(recommended)].includes(
        destinationKey(candidate),
      ),
  );
  const moving = context === "move";
  return (
    <section className="min-w-0 space-y-3">
      <h2 className="text-lg leading-7 font-semibold">
        {moving
          ? t("copy.available-destinations")
          : t("copy.available-locations")}
        <span className="ml-2 font-normal text-muted" aria-live="polite">
          {search.trim()
            ? `${filtered.length} / ${candidates.length}`
            : candidates.length}
        </span>
      </h2>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
        <Input
          aria-label={
            moving
              ? t("copy.search-move-destinations")
              : t("copy.search-storage-locations")
          }
          placeholder={t("copy.building-location-or-rack")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="pr-12 pl-9"
        />
        {search && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-1/2 right-0 -translate-y-1/2"
            aria-label={t("copy.clear-search")}
            title={t("copy.clear-search")}
            onClick={() => setSearch("")}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
      {filtered.length === 0 ? (
        <div className="space-y-2 rounded-xl border border-dashed border-border p-4 text-sm">
          <p role="status">
            {moving
              ? t("copy.no-matching-destinations")
              : t("copy.no-matching-locations")}
          </p>
          <p className="text-xs text-muted">
            {t(
              "copy.your-current-preview-is-kept-clear-the-search-to-see-all-locations",
            )}
          </p>
        </div>
      ) : (
        <div
          role="region"
          aria-label={
            moving ? t("copy.destination-options") : t("copy.location-options")
          }
          tabIndex={0}
          className="flex gap-2 overflow-x-auto rounded-xl pb-2 outline-none focus-visible:ring-2 focus-visible:ring-ring 2xl:max-h-[32rem] 2xl:flex-col 2xl:overflow-y-auto 2xl:pr-2"
        >
          {[...pinned, ...shown].map((candidate) => {
            const key = destinationKey(candidate);
            return (
              <Button
                variant="ghost"
                key={key}
                type="button"
                aria-pressed={key === selected}
                onClick={() => onSelect(key)}
                className={`min-w-52 shrink-0 rounded-xl border p-3 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset 2xl:min-w-0 ${key === selected ? "border-link bg-selected" : "border-border bg-surface hover:border-link"}`}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <MapPin className="size-4 text-link" aria-hidden="true" />
                  <span className="font-semibold">
                    {candidate.locationName}
                  </span>
                  {pinned.includes(candidate) && (
                    <span className="rounded-full bg-raised px-2 py-1 text-[10px] text-muted">
                      {t("paging.otherPage")}
                    </span>
                  )}
                  {recommended && key === destinationKey(recommended) && (
                    <span className="rounded-full bg-success/10 px-2 py-1 text-[10px] text-success">
                      {t("copy.recommended")}
                    </span>
                  )}
                </span>
                {candidate.measuredAreaPartial && (
                  <span className="mt-2 block text-xs text-warning">
                    {t(
                      "copy.contains-unmeasured-units-remaining-space-unknown",
                    )}
                  </span>
                )}
                <span className="mt-2 block text-xs text-muted">
                  {candidate.buildingCode} · {t("copy.floor")}{" "}
                  {candidate.floorNumber}
                </span>
                <span className="mt-2 block text-xs text-muted">
                  {mmText(candidate.support.widthMm)} ×{" "}
                  {mmText(candidate.support.depthMm)}
                </span>
                <span className="mt-2 block text-xs text-muted">
                  {candidate.supportLabel ??
                    candidate.supportCode ??
                    t("copy.location-floor")}
                  {" · Z "}
                  {mmText(candidate.support.zMm)}
                </span>
              </Button>
            );
          })}
        </div>
      )}
      {filtered.length > LOCAL_PAGE_SIZES[0] && (
        <PaginationFooter
          label={t("paging.destinationPages")}
          pageSizeControl={
            <PageSizeSelect
              label={t("paging.perPage")}
              value={size}
              sizes={LOCAL_PAGE_SIZES}
              onValueChange={(next) =>
                setView({ ...view, size: next, page: 1 })
              }
            />
          }
          status={t("paging.range", {
            from: first + 1,
            to: first + shown.length,
            total: filtered.length,
          })}
          previousLabel={t("paging.previous")}
          nextLabel={t("paging.next")}
          canPrevious={page > 1}
          canNext={page < pages}
          onPrevious={() => setView({ ...view, page: page - 1 })}
          onNext={() => setView({ ...view, page: page + 1 })}
        />
      )}
    </section>
  );
}
