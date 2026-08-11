"use client";

/**
 * One form for every master-data write.
 *
 * Presentational and Convex-free on purpose: it knows about labels, focus,
 * validity, and the touch target, and nothing about mutations, tenancy, or
 * preview mode. That split is what lets a component test render the refusal
 * states — a field the server blamed, a duplicate key, a denial — without a
 * deployment.
 *
 * Three decisions worth stating, because each has a wrong version that looks
 * identical until an operator hits it:
 *
 * - **Every value is a string.** The caller converts. A form that parsed numbers
 *   would decide what `12.5` means for an integer field, and the server already
 *   decides that; two answers to one question is how a screen starts disagreeing
 *   with its backend.
 * - **Client validation stops at "required".** The domain rules live in
 *   `convex/model/**` and run on the server, which is the only place they can be
 *   enforced. Re-implementing a check digit here would eventually drift, and the
 *   drifted copy would be the one the operator sees.
 * - **The submit button is disabled only while a request is in flight.** Not on
 *   invalid input: a disabled button with no explanation is the least
 *   actionable state on a warehouse screen (`UX §2.4`), and submitting an
 *   incomplete form produces a message that names the field.
 *
 * Inputs are `min-h-touch` because this markup is shared with the handheld
 * shell, where a 44px target is a requirement rather than a preference
 * (`INV-0010-04`).
 */
import { useId, useState, type FormEvent, type ReactNode } from "react";

export type FormFieldKind = "text" | "number" | "select" | "textarea";

export interface FormFieldOption {
  readonly value: string;
  readonly label: string;
}

export interface FormFieldSpec {
  /** The mutation argument this field supplies. */
  readonly name: string;
  readonly label: string;
  readonly kind: FormFieldKind;
  readonly required?: boolean;
  /** Rendered under the control and referenced by `aria-describedby`. */
  readonly hint?: string;
  readonly options?: readonly FormFieldOption[];
  readonly initialValue?: string;
  /** Codes are monospaced; names, which may be Thai, are not. */
  readonly monospace?: boolean;
  readonly placeholder?: string;
}

export type FormValues = Readonly<Record<string, string>>;

export interface EntityFormProps {
  /** The accessible name of the form's group. */
  readonly legend: string;
  readonly description?: string;
  readonly fields: readonly FormFieldSpec[];
  readonly submitLabel: string;
  readonly busy: boolean;
  /** The name of a field the server blamed, if any. */
  readonly invalidField?: string;
  /** The message shown when a required field is left blank. */
  readonly requiredMessage: string;
  /** The outcome notice, rendered above the controls. */
  readonly outcome?: ReactNode;
  /** Whether the form should clear itself after a submission. */
  readonly resetSignal?: number;
  readonly onSubmit: (values: FormValues) => void;
  readonly testId?: string;
}

const initialValues = (fields: readonly FormFieldSpec[]): FormValues =>
  Object.fromEntries(
    fields.map((field) => [
      field.name,
      field.initialValue ?? field.options?.[0]?.value ?? "",
    ]),
  );

export function EntityForm({
  legend,
  description,
  fields,
  submitLabel,
  busy,
  invalidField,
  requiredMessage,
  outcome,
  resetSignal = 0,
  onSubmit,
  testId,
}: EntityFormProps) {
  const formId = useId();
  const [values, setValues] = useState<FormValues>(() => initialValues(fields));
  const [missing, setMissing] = useState<readonly string[]>([]);
  const [seenReset, setSeenReset] = useState(resetSignal);

  /*
   * Reset during render rather than in an effect. The parent raises the signal
   * when a write succeeded, and clearing in an effect would paint the saved
   * values for one frame — long enough for an operator mid-keystroke to type
   * into a field that is about to be emptied.
   */
  if (resetSignal !== seenReset) {
    setSeenReset(resetSignal);
    setValues(initialValues(fields));
    setMissing([]);
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    const blank = fields
      .filter(
        (field) =>
          field.required === true && (values[field.name] ?? "").trim() === "",
      )
      .map((field) => field.name);

    setMissing(blank);
    if (blank.length > 0) return;

    onSubmit(
      Object.fromEntries(
        fields.map((field) => [field.name, (values[field.name] ?? "").trim()]),
      ),
    );
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      <fieldset className="flex flex-col gap-4 border-0 p-0" disabled={busy}>
        <legend className="text-sm font-semibold text-text">{legend}</legend>
        {description === undefined ? null : (
          <p className="max-w-prose text-sm leading-relaxed text-muted">
            {description}
          </p>
        )}

        {outcome}

        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => {
            const controlId = `${formId}-${field.name}`;
            const hintId = `${controlId}-hint`;
            const errorId = `${controlId}-error`;
            const isMissing = missing.includes(field.name);
            const isBlamed = invalidField === field.name;
            const invalid = isMissing || isBlamed;

            const describedBy = [
              field.hint === undefined ? undefined : hintId,
              isMissing ? errorId : undefined,
            ]
              .filter((value): value is string => value !== undefined)
              .join(" ");

            const shared = {
              id: controlId,
              name: field.name,
              value: values[field.name] ?? "",
              "aria-invalid": invalid ? (true as const) : undefined,
              "aria-describedby": describedBy === "" ? undefined : describedBy,
              "aria-required":
                field.required === true ? (true as const) : undefined,
              className: [
                "min-h-touch w-full rounded-md border bg-surface px-3 py-2 text-sm",
                invalid ? "border-danger" : "border-border-strong",
                field.monospace === true ? "font-mono" : "",
              ].join(" "),
            };

            return (
              <div
                key={field.name}
                className={`flex flex-col gap-1 ${
                  field.kind === "textarea" ? "sm:col-span-2" : ""
                }`}
              >
                <label
                  htmlFor={controlId}
                  className="text-sm font-medium text-text"
                >
                  {field.label}
                </label>

                {field.kind === "select" ? (
                  <select
                    {...shared}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.name]: event.target.value,
                      }))
                    }
                  >
                    {(field.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.kind === "textarea" ? (
                  <textarea
                    {...shared}
                    rows={6}
                    {...(field.placeholder === undefined
                      ? {}
                      : { placeholder: field.placeholder })}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.name]: event.target.value,
                      }))
                    }
                  />
                ) : (
                  <input
                    {...shared}
                    type="text"
                    {...(field.kind === "number"
                      ? { inputMode: "numeric" as const }
                      : {})}
                    {...(field.placeholder === undefined
                      ? {}
                      : { placeholder: field.placeholder })}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.name]: event.target.value,
                      }))
                    }
                  />
                )}

                {field.hint === undefined ? null : (
                  <p id={hintId} className="text-xs leading-relaxed text-muted">
                    {field.hint}
                  </p>
                )}
                {isMissing ? (
                  <p id={errorId} className="text-xs font-medium text-danger">
                    {requiredMessage}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <div>
          <button
            type="submit"
            className="min-h-touch rounded-md border border-border-strong bg-surface px-4 font-semibold disabled:text-disabled"
          >
            {submitLabel}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
