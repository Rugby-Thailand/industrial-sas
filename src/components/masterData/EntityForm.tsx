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
 * The controls are the shared shadcn primitives — `FieldSet`, `Field`, `Input`,
 * `Textarea`, `SelectControl`, `Button` — rather than local Tailwind markup, so
 * the touch target, the focus ring, and the invalid treatment are defined once.
 * The field-specification API above them did not change: twenty-odd call sites
 * describe their fields the same way they did before the primitives existed, and
 * every `kind: "select"` among them became a themed Radix menu without any of
 * them being edited.
 *
 * Controls are `min-h-touch` because this markup is shared with the handheld
 * shell, where a 44px target is a requirement rather than a preference
 * (`INV-0010-04`).
 */
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectControl } from "@/components/ui/SelectControl";
import { Textarea } from "@/components/ui/textarea";

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

/**
 * The starting value of every field.
 *
 * A field with no `initialValue` starts **empty**, including a select that has
 * options. Falling back to `options[0]` is the defect this shape exists to
 * prevent: it silently commits an operator to whatever happens to be first in
 * the list, and the control never shows the placeholder that would have told
 * them a choice was outstanding. On the item form that default was
 * `trackingMode: "NONE"` — an item created with no lot or serial capture, which
 * is not discovered until receiving asks for a lot the item cannot hold.
 *
 * The empty string is what `SelectControl` reads as "nothing selected", so it
 * renders its (required) placeholder; and it is what the blank check in
 * `submit` below reads as missing, so a `required` select refuses to submit
 * with a message naming the field. Both behaviours come free from starting
 * empty, and neither is reachable while a first option is pre-selected.
 */
const initialValues = (fields: readonly FormFieldSpec[]): FormValues =>
  Object.fromEntries(
    fields.map((field) => [field.name, field.initialValue ?? ""]),
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

  const change = (name: string, next: string) => {
    setValues((current) => ({ ...current, [name]: next }));
  };

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
      className="@container/form flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      <FieldSet disabled={busy} className="border-0 p-0">
        <FieldLegend variant="label" className="text-text">
          {legend}
        </FieldLegend>
        {description === undefined ? null : (
          <FieldDescription className="max-w-prose leading-relaxed">
            {description}
          </FieldDescription>
        )}

        {outcome}

        <FieldGroup className="grid gap-4 @xl/form:grid-cols-2">
          {fields.map((field) => {
            const controlId = `${formId}-${field.name}`;
            const hintId = `${controlId}-hint`;
            const errorId = `${controlId}-error`;
            const isMissing = missing.includes(field.name);
            const isBlamed = invalidField === field.name;
            const invalid = isMissing || isBlamed;
            const value = values[field.name] ?? "";

            const describedBy = [
              field.hint === undefined ? undefined : hintId,
              isMissing ? errorId : undefined,
            ]
              .filter((entry): entry is string => entry !== undefined)
              .join(" ");

            /*
             * The attributes every kind shares. `aria-invalid` is deliberately
             * absent rather than `false` when the field is fine: a control that
             * always carries the attribute reads as "validity is being tracked
             * here" to some assistive technology even when it is valid.
             */
            const shared = {
              id: controlId,
              name: field.name,
              "aria-invalid": invalid ? (true as const) : undefined,
              "aria-describedby": describedBy === "" ? undefined : describedBy,
              "aria-required":
                field.required === true ? (true as const) : undefined,
            };

            return (
              <Field
                key={field.name}
                data-invalid={invalid ? true : undefined}
                className={
                  field.kind === "textarea" ? "@xl/form:col-span-2" : ""
                }
              >
                <FieldLabel htmlFor={controlId} className="text-text">
                  {field.label}
                </FieldLabel>

                {field.kind === "select" ? (
                  <SelectControl
                    id={controlId}
                    name={field.name}
                    value={value}
                    options={field.options ?? []}
                    onValueChange={(next) => change(field.name, next)}
                    placeholder={field.placeholder ?? field.label}
                    emptyLabel={field.placeholder ?? field.label}
                    invalid={invalid}
                    describedBy={describedBy}
                    {...(field.required === true ? { required: true } : {})}
                  />
                ) : field.kind === "textarea" ? (
                  <Textarea
                    {...shared}
                    value={value}
                    rows={6}
                    className={field.monospace === true ? "font-mono" : ""}
                    {...(field.placeholder === undefined
                      ? {}
                      : { placeholder: field.placeholder })}
                    onChange={(event) => change(field.name, event.target.value)}
                  />
                ) : (
                  <Input
                    {...shared}
                    value={value}
                    type="text"
                    className={field.monospace === true ? "font-mono" : ""}
                    {...(field.kind === "number"
                      ? { inputMode: "numeric" as const }
                      : {})}
                    {...(field.placeholder === undefined
                      ? {}
                      : { placeholder: field.placeholder })}
                    onChange={(event) => change(field.name, event.target.value)}
                  />
                )}

                {field.hint === undefined ? null : (
                  <FieldDescription id={hintId} className="text-xs">
                    {field.hint}
                  </FieldDescription>
                )}
                {isMissing ? (
                  <FieldError id={errorId} className="text-xs font-medium">
                    {requiredMessage}
                  </FieldError>
                ) : null}
              </Field>
            );
          })}
        </FieldGroup>

        <div>
          <Button type="submit" variant="outline">
            {submitLabel}
          </Button>
        </div>
      </FieldSet>
    </form>
  );
}
