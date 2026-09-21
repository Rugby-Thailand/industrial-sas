"use client";

import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/utils";

export function CollectionToolbar({
  value,
  onValueChange,
  searchLabel,
  placeholder = searchLabel,
  clearLabel,
  actions,
  className,
  searchType = "search",
}: {
  value: string;
  onValueChange: (value: string) => void;
  searchLabel: string;
  placeholder?: string;
  clearLabel: string;
  actions?: ReactNode;
  className?: string;
  searchType?: "search" | "text";
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="relative min-w-40 flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
        />
        <Input
          type={searchType}
          aria-label={searchLabel}
          placeholder={placeholder}
          className="pr-11 pl-9"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
        />
        {value ? (
          <IconButton
            label={clearLabel}
            variant="ghost"
            className="absolute inset-y-0 right-0 z-10 my-auto"
            onClick={() => onValueChange("")}
          >
            <X aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
      {actions}
    </div>
  );
}
