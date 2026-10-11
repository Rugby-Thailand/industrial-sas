import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function CheckboxControl({
  className,
  ...props
}: ComponentProps<"input">) {
  return (
    <input
      {...props}
      type="checkbox"
      className={cn("size-4 shrink-0 accent-link focus-ring", className)}
    />
  );
}

/**
 * The clickable target around a small checkbox or radio glyph: the whole
 * label is a 48px touch / 36px dense row, so the glyph can stay 16px.
 */
export const choiceTargetClassName =
  "flex min-h-touch cursor-pointer items-center gap-2 text-sm text-text dense:min-h-control has-disabled:cursor-not-allowed has-disabled:text-disabled";

/**
 * A labelled checkbox. `description` adds a muted second line inside the
 * same target. Every other prop goes to the native checkbox, so checked,
 * onChange, disabled and ARIA wiring stay with the caller.
 */
export function CheckboxField({
  label,
  description,
  className,
  ...props
}: Omit<ComponentProps<"input">, "type"> & {
  readonly label: ReactNode;
  readonly description?: ReactNode;
}) {
  return (
    <label
      className={cn(
        choiceTargetClassName,
        description !== undefined && "items-start py-2",
        className,
      )}
    >
      <CheckboxControl
        {...props}
        {...(description === undefined ? {} : { className: "mt-0.5" })}
      />
      {description === undefined ? (
        label
      ) : (
        <span className="min-w-0">
          <span className="block font-medium">{label}</span>
          <span className="block text-xs leading-[1.125rem] text-muted">
            {description}
          </span>
        </span>
      )}
    </label>
  );
}
