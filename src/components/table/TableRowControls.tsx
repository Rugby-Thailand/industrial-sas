"use client";

import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export function TableRowActions({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <div className="flex items-center gap-1.5">{children}</div>;
}

export function TableAction({
  label,
  children,
  variant = "ghost",
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "size" | "aria-label" | "title"> & {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant={variant}
      aria-label={label}
      title={label}
      className={className}
      {...props}
    >
      {children}
    </Button>
  );
}

export function TableStatusSwitch({
  checked,
  disabled,
  label,
  actionLabel,
  onCheckedChange,
  testId,
}: {
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly label: string;
  readonly actionLabel: string;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly testId?: string;
}) {
  return (
    <Switch
      size="default"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      title={actionLabel}
      onCheckedChange={onCheckedChange}
      {...(testId === undefined ? {} : { "data-testid": testId })}
    />
  );
}
