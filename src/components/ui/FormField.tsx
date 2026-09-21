import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/** Shared field presentation; callers retain input type, value, and validation. */
export function FormField({
  id,
  label,
  required = false,
  hint,
  error,
  srOnlyLabel = false,
  children,
}: {
  readonly id: string;
  readonly label: ReactNode;
  readonly required?: boolean;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  readonly srOnlyLabel?: boolean;
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
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id} className={srOnlyLabel ? "sr-only" : undefined}>
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
