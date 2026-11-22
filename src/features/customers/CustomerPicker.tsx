"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import { NAVIGATION_PERMISSION } from "../../../convex/model/authorization/navigationPermissions";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectControl } from "@/components/ui/SelectControl";

export interface CustomerPickerProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (customerId: string) => void;
  readonly unlinkedLabel: string;
  readonly searchPlaceholder?: string;
  readonly loadMoreLabel?: string;
  readonly disabled?: boolean;
  readonly testId?: string;
}

/**
 * Optional searchable active-customer selector for products and job-scan
 * corrections. Only queries customer options when the signed-in member holds
 * `masterData.customer.read`, so warehouse-only staff never trigger denials.
 */
export function CustomerPicker({
  label,
  value,
  onChange,
  unlinkedLabel,
  searchPlaceholder,
  loadMoreLabel,
  disabled = false,
  testId,
}: CustomerPickerProps) {
  const { navigationPermissions } = useWorkspace();
  const canReadCustomers = navigationPermissions.includes(
    NAVIGATION_PERMISSION.customers,
  );
  const [search, setSearch] = useState("");
  const [scanCursor, setScanCursor] = useState<string | undefined>(undefined);
  const outcome = useQuery(
    api.customers.linking.searchCustomerOptions,
    canReadCustomers
      ? {
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(value ? { includeCustomerId: value } : {}),
          ...(scanCursor === undefined ? {} : { scanCursor }),
        }
      : "skip",
  );
  if (!canReadCustomers) return null;

  const loading = outcome === undefined;
  const rows = outcome?.ok ? outcome.value.items : [];
  const hasMore = Boolean(outcome?.ok && outcome.value.hasMore);
  const nextCursor = outcome?.ok ? outcome.value.scanCursor : undefined;
  const options = [
    { value: "", label: unlinkedLabel },
    ...rows.map((customer) => ({
      value: customer.customerId,
      label: `${customer.name} (${customer.code})`,
    })),
  ];

  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium text-text">{label}</span>
      {searchPlaceholder ? (
        <Input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setScanCursor(undefined);
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          disabled={disabled}
          data-testid={testId ? `${testId}-search` : undefined}
        />
      ) : null}
      <SelectControl
        label={label}
        value={value}
        onValueChange={onChange}
        options={options}
        placeholder={unlinkedLabel}
        emptyLabel={unlinkedLabel}
        disabled={disabled}
        pending={loading}
        {...(testId === undefined ? {} : { testId })}
      />
      {hasMore && nextCursor && loadMoreLabel ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => setScanCursor(nextCursor)}
        >
          {loadMoreLabel}
        </Button>
      ) : null}
    </div>
  );
}
