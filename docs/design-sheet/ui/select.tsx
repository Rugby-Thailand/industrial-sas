// Structure adapted from the application's shadcn Select
// (src/components/ui/select.tsx, 2026-10-15) with the same Radix parts and
// data-slot names. Sheet-owned: Tailwind class strings are removed because the
// standalone sheet does not compile Tailwind; controls.css owns appearance.
"use client";

import type * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectValue(
  props: React.ComponentProps<typeof SelectPrimitive.Value>,
) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger data-slot="select-trigger" {...props}>
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon aria-hidden="true" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  children,
  position = "popper",
  align = "start",
  sideOffset = 4,
  onKeyDown,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        align={align}
        sideOffset={sideOffset}
        {...props}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          // The item has already selected its value. Cancel Enter's native
          // click: the vanilla handler can remount and focus a new trigger
          // before that default action runs, which would reopen the menu.
          if (
            event.key === "Enter" &&
            event.target instanceof Element &&
            event.target.closest('[role="option"]')
          ) {
            event.preventDefault();
          }
        }}
      >
        <SelectPrimitive.ScrollUpButton data-slot="select-scroll-up-button">
          <ChevronUpIcon aria-hidden="true" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport data-position={position}>
          {children}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton data-slot="select-scroll-down-button">
          <ChevronDownIcon aria-hidden="true" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item data-slot="select-item" {...props}>
      <span data-slot="select-item-indicator">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon aria-hidden="true" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
