"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
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
  readonly previousPageLabel?: string;
  readonly nextPageLabel?: string;
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
  previousPageLabel,
  nextPageLabel,
  disabled = false,
  testId,
}: CustomerPickerProps) {
  const t = useTranslations("Customers");
  const { navigationPermissions } = useWorkspace();
  const canReadCustomers = navigationPermissions.includes(
    NAVIGATION_PERMISSION.customers,
  );
  const [search, setSearch] = useState("");
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const activeCursor = cursorStack.at(-1);
  const outcome = useQuery(
    api.customers.linking.searchCustomerOptions,
    canReadCustomers
      ? {
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(value ? { includeCustomerId: value } : {}),
          ...(activeCursor === undefined ? {} : { scanCursor: activeCursor }),
        }
      : "skip",
  );
  if (!canReadCustomers) return null;

  const loading = outcome === undefined;
  const rows = outcome?.ok ? outcome.value.items : [];
  const hasMore = Boolean(outcome?.ok && outcome.value.hasMore);
  const nextCursor = outcome?.ok ? outcome.value.scanCursor : undefined;
  const hasPrevious = cursorStack.length > 0;
  const canNext = Boolean(hasMore && nextCursor);
  const emptyIntermediatePage = !loading && rows.length === 0 && (hasPrevious || canNext);
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
            setCursorStack([]);
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
      {emptyIntermediatePage ? (
        <p
          className="text-xs text-muted"
          data-testid={testId ? `${testId}-empty-page` : undefined}
        >
          {t("pickerEmptyPage")}
        </p>
      ) : null}
      {hasPrevious || canNext ? (
        <div className="flex flex-wrap items-center gap-2">
          {hasPrevious ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || loading}
              onClick={() => setCursorStack((current) => current.slice(0, -1))}
              data-testid={testId ? `${testId}-previous` : undefined}
            >
              {previousPageLabel ?? t("previousPage")}
            </Button>
          ) : null}
          {canNext && nextCursor ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled || loading}
              onClick={() =>
                setCursorStack((current) => [...current, nextCursor])
              }
              data-testid={testId ? `${testId}-next` : undefined}
            >
              {nextPageLabel ?? loadMoreLabel ?? t("nextPage")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
