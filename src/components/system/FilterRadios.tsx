"use client";

export function FilterRadios({
  id,
  label,
  value,
  options,
  onChange,
  wrap = false,
  disabled = false,
  invalid = false,
  describedBy,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly options: ReadonlyArray<{ value: string; label: string }>;
  readonly onChange: (value: string) => void;
  readonly wrap?: boolean;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly describedBy?: string | undefined;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={wrap ? "flex min-w-0 flex-wrap gap-1" : "grid min-w-0 gap-1"}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    >
      {options.map((option, index) => (
        <label
          key={option.value}
          className="inline-flex min-h-touch cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-text hover:bg-raised has-checked:bg-accent-surface has-focus-visible:ring-2 has-focus-visible:ring-ring"
        >
          <input
            className="size-4 shrink-0 accent-primary"
            id={index === 0 ? id : undefined}
            type="radio"
            name={id}
            value={option.value}
            disabled={disabled}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
