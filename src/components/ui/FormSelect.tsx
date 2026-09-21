import { useId, type ReactNode } from "react";
import { FormField } from "./FormField";
import { SelectControl, type SelectControlProps } from "./SelectControl";

export function FormSelect({
  label,
  hint,
  error,
  required = false,
  ...props
}: SelectControlProps & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
}) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  return (
    <FormField id={id} label={label} required={required} hint={hint} error={error}>
      {(field) => (
        <SelectControl
          {...props}
          id={id}
          required={required}
          invalid={Boolean(error)}
          {...(typeof label === "string" ? { label } : {})}
          {...(field["aria-describedby"]
            ? { describedBy: field["aria-describedby"] }
            : {})}
        />
      )}
    </FormField>
  );
}
