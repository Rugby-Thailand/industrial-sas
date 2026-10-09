import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Shared field presentation; callers retain input type, value, and validation. */
export function FormField({
  id,
  label,
  required = false,
  hint,
  error,
  srOnlyLabel = false,
  className,
  labelClassName,
  children,
}: {
  readonly id: string;
  readonly label: ReactNode;
  readonly required?: boolean;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  readonly srOnlyLabel?: boolean;
  readonly className?: string;
  readonly labelClassName?: string;
  readonly children: (props: {
    id: string;
    name?: string;
    "aria-required": true | undefined;
    "aria-describedby": string | undefined;
    "aria-invalid": true | undefined;
  }) => ReactNode;
}) {
  const describedBy =
    [hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className={cn("grid min-w-0 gap-2", className)}>
      <Label
        htmlFor={id}
        className={cn(srOnlyLabel && "sr-only", labelClassName)}
      >
        {label}
        {required ? (
          <span className="text-danger" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </Label>
      {children({
        id,
        "aria-required": required ? true : undefined,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={`${id}-error`}
          className="text-xs leading-relaxed text-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
