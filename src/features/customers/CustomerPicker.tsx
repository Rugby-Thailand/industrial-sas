"use client";

import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import { NAVIGATION_PERMISSION } from "../../../convex/model/authorization/navigationPermissions";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { SelectControl } from "@/components/ui/SelectControl";

export interface CustomerPickerProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (customerId: string) => void;
  readonly unlinkedLabel: string;
  readonly disabled?: boolean;
  readonly testId?: string;
}

/**
 * Optional active-customer selector for products and job-scan corrections.
 * Only queries customer options when the signed-in member holds
 * `masterData.customer.read`, so warehouse-only staff never trigger denials.
 */
export function CustomerPicker({
  label,
  value,
  onChange,
  unlinkedLabel,
  disabled = false,
  testId,
}: CustomerPickerProps) {
  const { navigationPermissions } = useWorkspace();
  const canReadCustomers = navigationPermissions.includes(
    NAVIGATION_PERMISSION.customers,
  );
  const outcome = useQuery(
    api.customers.linking.searchCustomerOptions,
    canReadCustomers
      ? { ...(value ? { includeCustomerId: value } : {}) }
      : "skip",
  );
  if (!canReadCustomers) return null;

  const loading = outcome === undefined;
  const rows = outcome?.ok ? outcome.value : [];
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
    </div>
  );
}
