"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

/** Shared presentation; callers retain cursor or numbered-page state. */
export function PaginationFooter({
  label,
  pageSizeControl,
  status,
  previousLabel,
  nextLabel,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  loading = false,
  firstAction,
  separated = false,
}: {
  readonly label: string;
  readonly pageSizeControl: ReactNode;
  readonly status: ReactNode;
  readonly previousLabel: string;
  readonly nextLabel: string;
  readonly canPrevious: boolean;
  readonly canNext: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly loading?: boolean;
  readonly firstAction?: ReactNode;
  readonly separated?: boolean;
}) {
  return (
    <Pagination
      aria-label={label}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        separated && "mt-6 border-t border-border pt-4",
      )}
    >
      {pageSizeControl}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {firstAction}
        <span aria-live="polite" className="text-sm text-muted tabular-nums">
          {status}
        </span>
        <IconButton
          type="button"
          variant="outline"
          label={previousLabel}
          disabled={!canPrevious || loading}
          onClick={onPrevious}
        >
          <ChevronLeft aria-hidden="true" />
        </IconButton>
        <IconButton
          type="button"
          variant="outline"
          label={nextLabel}
          disabled={!canNext || loading}
          onClick={onNext}
        >
          <ChevronRight aria-hidden="true" />
        </IconButton>
      </div>
    </Pagination>
  );
}
