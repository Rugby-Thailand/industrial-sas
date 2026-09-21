"use client";

import { PaginationFooter } from "./PaginationFooter";
import { Button } from "@/components/ui/button";
import { PageSizeSelect, CURSOR_PAGE_SIZES } from "./PageSizeSelect";
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
    <PaginationFooter
      label={th ? "การแบ่งหน้า" : "Pagination"}
      separated
      pageSizeControl={
        <PageSizeSelect
          label={th ? "รายการต่อหน้า" : "Records per page"}
          value={pageSize}
          sizes={CURSOR_PAGE_SIZES}
          onValueChange={onPageSizeChange}
          disabled={loading}
        />
      }
      status={
        <span role="status">
          {th ? "หน้า" : "Page"} {page}
          {loading ? " …" : ""}
        </span>
      }
      previousLabel={th ? "หน้าก่อนหน้า" : "Previous page"}
      nextLabel={th ? "หน้าถัดไป" : "Next page"}
      canPrevious={canPrevious}
      canNext={canNext}
      loading={loading}
      onPrevious={onPrevious}
      onNext={onNext}
      firstAction={
        historyTruncated && onFirst ? (
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={onFirst}
          >
            {th ? "หน้าแรก" : "First page"}
          </Button>
        ) : null
      }
    />
  );
}
