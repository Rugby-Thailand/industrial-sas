"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Pagination } from "@/components/ui/pagination";
import { Button } from "@/components/ui/button";
import { SelectControl } from "@/components/ui/SelectControl";
import type { PageSize } from "@/hooks/useCursorPagination";

// Adapted from ReUI c-pagination-15: cursor navigation has no last-page total.
export function CursorPagination({
  page,
  pageSize,
  onPageSizeChange,
  onPrevious,
  onNext,
  canPrevious,
  canNext,
  loading = false,
  locale,
  onFirst,
  historyTruncated = false,
}: {
  page: number;
  pageSize: PageSize;
  onPageSizeChange: (size: PageSize) => void;
  onPrevious: () => void;
  onNext: () => void;
  canPrevious: boolean;
  canNext: boolean;
  loading?: boolean;
  locale: string;
  onFirst?: () => void;
  historyTruncated?: boolean;
}) {
  const th = locale === "th";
  return (
    <Pagination
      aria-label={th ? "การแบ่งหน้า" : "Pagination"}
      className="mt-5 flex flex-wrap items-center justify-between gap-3"
    >
      <div className="flex items-center gap-2 text-sm">
        <span className="hidden sm:inline">
          {th ? "รายการต่อหน้า" : "Records per page"}
        </span>
        <SelectControl
          label={th ? "รายการต่อหน้า" : "Records per page"}
          value={String(pageSize)}
          options={[20, 50, 100].map((size) => ({
            value: String(size),
            label: String(size),
          }))}
          onValueChange={(value) => onPageSizeChange(Number(value) as PageSize)}
          placeholder=""
          emptyLabel=""
          className="w-20"
        />
      </div>
      <div className="flex items-center gap-2">
        {historyTruncated && onFirst && (
          <Button type="button" size="sm" variant="outline" onClick={onFirst}>
            {th ? "หน้าแรก" : "First page"}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canPrevious || loading}
          onClick={onPrevious}
          aria-label={th ? "หน้าก่อนหน้า" : "Previous page"}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">
            {th ? "ก่อนหน้า" : "Previous"}
          </span>
        </Button>
        <span
          role="status"
          aria-live="polite"
          className="min-w-16 text-center text-sm"
        >
          {th ? "หน้า" : "Page"} {page}
          {loading ? " …" : ""}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canNext || loading}
          onClick={onNext}
          aria-label={th ? "หน้าถัดไป" : "Next page"}
        >
          <span className="hidden sm:inline">{th ? "ถัดไป" : "Next"}</span>
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </Pagination>
  );
}
