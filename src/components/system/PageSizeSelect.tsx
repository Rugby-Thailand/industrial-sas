"use client";

import { SelectControl } from "@/components/ui/SelectControl";

/**
 * Local (client-side) pagination sizes. Never send these to
 * `paginatedScan` — the server only accepts CURSOR_PAGE_SIZES.
 */
export const LOCAL_PAGE_SIZES = [25, 50, 100] as const;
/** @deprecated Use LOCAL_PAGE_SIZES. Kept for existing imports. */
export const FLOOR_PAGE_SIZES = LOCAL_PAGE_SIZES;
/** Server cursor pagination sizes. Must match `paginatedScan` allowlist. */
export const CURSOR_PAGE_SIZES = [20, 50, 100] as const;

export function PageSizeSelect<T extends number>({
  value,
  sizes,
  onValueChange,
  label,
  disabled = false,
}: {
  readonly value: T;
  readonly sizes: readonly T[];
  readonly onValueChange: (value: T) => void;
  readonly label: string;
  readonly disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <span>{label}</span>
      <SelectControl
        label={label}
        value={String(value)}
        options={sizes.map((size) => ({
          value: String(size),
          label: String(size),
        }))}
        onValueChange={(next) => {
          const size = sizes.find((size) => String(size) === next);
          if (size !== undefined) onValueChange(size);
        }}
        placeholder={label}
        emptyLabel={label}
        disabled={disabled}
        className="w-20"
      />
    </div>
  );
}
