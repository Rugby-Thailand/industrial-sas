"use client";

/**
 * The shadcn/Radix Select, vendored and adapted for a warehouse floor.
 *
 * This is the official `Select / SelectTrigger > SelectValue / SelectContent >
 * SelectItem` composition from the shadcn Radix registry. Four things were
 * changed from the generated source, each for a reason this application already
 * had before the component existed:
 *
 * - **Colours are the repository's semantic tokens.** The registry paints with
 *   its own oklch palette; `globals.css` aliases the shadcn names onto
 *   `--token-*` instead, so a menu is `surface` on `border-strong` in both
 *   colour schemes. This is the whole point of the migration: a native
 *   `<select>` renders its popup with the *operating system's* colours, which is
 *   why the warehouse chooser showed as a white list on a dark screen no matter
 *   what the page did.
 * - **Every target clears 48 CSS pixels** (`INV-0010-06`, D-24). The registry
 *   ships a 32-pixel trigger and a 28-pixel row, which is a desktop density; a
 *   gloved hand on a rugged scanner needs `min-h-touch`, and this markup is
 *   shared with the handheld shell.
 * - **Labels wrap; they are never clipped.** The registry's `whitespace-nowrap`
 *   trigger and `line-clamp-1` value would truncate a Thai warehouse name at
 *   360 pixels, and a truncated identifier is the one an operator needs whole.
 *   Thai spaces separate phrases rather than words, so the wrap point is a
 *   phrase boundary and the string grows downward instead of disappearing.
 * - **`position="popper"` and `align="start"` are the defaults.** The registry
 *   default (`item-aligned`) positions the list over the trigger with the
 *   selected row under the cursor, which on a narrow screen puts the menu
 *   half off-viewport. Popper anchors it to the trigger's edge.
 *
 * Everything else is Radix's, deliberately: roving focus, typeahead, Home/End,
 * Escape, the focus return to the trigger on close, the `aria-activedescendant`
 * bookkeeping, and the hidden native control that keeps `name`/`value` working
 * inside a real form submission. None of that is worth reimplementing, and a
 * reimplementation is what a hand-rolled menu would have been.
 */

import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex min-h-touch w-full items-center justify-between gap-2 rounded-md border border-input bg-surface px-3 py-2 text-left text-sm text-text transition-colors outline-none select-none",
        "data-placeholder:text-muted",
        "disabled:cursor-not-allowed disabled:border-border disabled:text-disabled",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "*:data-[slot=select-value]:flex *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex-wrap *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 *:data-[slot=select-value]:text-left",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="pointer-events-none size-4 text-muted" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  align = "start",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          "relative z-50 max-h-(--radix-select-content-available-height) min-w-36 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border border-border-strong bg-surface text-text shadow-md duration-100",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        position={position}
        align={align}
        sideOffset={sideOffset}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          data-position={position}
          className={cn(
            "p-1",
            /*
             * The menu is at least as wide as the trigger it belongs to, never
             * exactly as wide: a Thai location description is routinely longer
             * than the control that shows it, and a list clamped to the trigger
             * width would hide the end of every row.
             */
            "data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex min-h-touch w-full cursor-default items-center gap-2 rounded-md py-2 pr-9 pl-3 text-sm outline-hidden select-none",
        /*
         * The highlight is the action colour with its own contrast text rather
         * than a grey wash, so the current row survives a sunlit dock and a
         * colour-vision deficiency alike — and the check mark on the right says
         * the same thing again without colour (`WCAG 2.2` 1.4.1).
         */
        "focus:bg-accent focus:text-accent-foreground",
        "data-disabled:pointer-events-none data-disabled:text-disabled",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-3 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="pointer-events-none" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-surface py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-surface py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownButton>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
