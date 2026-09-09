"use client";

import { MapPin, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const { tr } = useFGText();
  const [{ search }, setSearchState] = usePreviewState(stateKey, {
    search: "",
  });
  const setSearch = (search: string) => setSearchState({ search });
  const filtered = filterDestinations(candidates, search);
  const moving = context === "move";
  return (
    <section className="min-w-0 space-y-3">
      <h2 className="text-sm font-semibold">
        {moving
          ? tr("Available destinations", "ปลายทางที่ใช้ได้")
          : tr("Available locations", "จุดจัดเก็บที่ใช้ได้")}
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
              ? tr("Search move destinations", "ค้นหาปลายทางย้าย")
              : tr("Search storage locations", "ค้นหาจุดจัดเก็บ")
          }
          placeholder={tr(
            "Building, location or rack…",
            "อาคาร จุดจัดเก็บ หรือชั้นวาง…",
          )}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="pr-12 pl-9"
        />
        {search && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-1/2 right-0 -translate-y-1/2"
            aria-label={tr("Clear search", "ล้างคำค้น")}
            title={tr("Clear search", "ล้างคำค้น")}
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
              ? tr("No matching destinations", "ไม่พบปลายทางที่ตรงกัน")
              : tr("No matching locations", "ไม่พบจุดจัดเก็บที่ตรงกัน")}
          </p>
          <p className="text-xs text-muted">
            {tr(
              "Your current preview is kept. Clear the search to see all locations.",
              "ภาพตำแหน่งที่เลือกยังคงอยู่ ล้างคำค้นเพื่อดูจุดจัดเก็บทั้งหมด",
            )}
          </p>
        </div>
      ) : (
        <div
          role="region"
          aria-label={
            moving
              ? tr("Destination options", "ตัวเลือกปลายทาง")
              : tr("Location options", "ตัวเลือกจุดจัดเก็บ")
          }
          tabIndex={0}
          className="flex gap-2 overflow-x-auto rounded-xl pb-2 outline-none focus-visible:ring-2 focus-visible:ring-ring 2xl:max-h-[32rem] 2xl:flex-col 2xl:overflow-y-auto 2xl:pr-2"
        >
          {filtered.map((candidate) => {
            const key = destinationKey(candidate);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={key === selected}
                onClick={() => onSelect(key)}
                className={`min-w-52 shrink-0 rounded-xl border p-3 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset 2xl:min-w-0 ${key === selected ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-accent/60"}`}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <MapPin className="size-4 text-accent" aria-hidden="true" />
                  <span className="font-semibold">
                    {candidate.locationName}
                  </span>
                  {recommended && key === destinationKey(recommended) && (
                    <span className="rounded-full bg-success/10 px-2 py-1 text-[10px] text-success">
                      {tr("Recommended", "แนะนำ")}
                    </span>
                  )}
                </span>
                <span className="mt-2 block text-xs text-muted">
                  {candidate.buildingCode} · {tr("Floor", "ชั้น")}{" "}
                  {candidate.floorNumber}
                </span>
                <span className="mt-2 block text-xs text-muted">
                  {mmText(candidate.support.widthMm)} ×{" "}
                  {mmText(candidate.support.depthMm)}
                </span>
                <span className="mt-2 block text-xs text-muted">
                  {candidate.supportLabel ??
                    candidate.supportCode ??
                    tr("Location floor", "พื้นจุดจัดเก็บ")}
                  {" · Z "}
                  {mmText(candidate.support.zMm)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
