"use client";

import { Check, Info, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
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
  readonly name: string;
  readonly label: string;
  readonly kind: FormFieldKind;
  readonly required?: boolean;

  readonly hint?: string;
  readonly options?: readonly FormFieldOption[];
  readonly initialValue?: string;

  readonly monospace?: boolean;
  readonly placeholder?: string;

  readonly importance?: "primary" | "secondary";
}

export type FormValues = Readonly<Record<string, string>>;

export interface EntityFormProps {
  readonly legend: string;
  readonly description?: string;
  readonly fields: readonly FormFieldSpec[];
  readonly submitLabel: string;
  readonly busy: boolean;

  readonly invalidField?: string;

  readonly requiredMessage: string;

  readonly outcome?: ReactNode;

  readonly resetSignal?: number;
  readonly onSubmit: (values: FormValues) => void;
  readonly testId?: string;
}

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
  const t = useTranslations("Write");
  const formId = useId();
  const [values, setValues] = useState<FormValues>(() => initialValues(fields));
  const [missing, setMissing] = useState<readonly string[]>([]);
  const [seenReset, setSeenReset] = useState(resetSignal);
  const [showHelp, setShowHelp] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const secondaryFields = fields.filter(
    (field) => field.importance === "secondary" && field.required !== true,
  );
  const secondaryNames = new Set(secondaryFields.map((field) => field.name));
  const primaryFields = fields.filter(
    (field) => !secondaryNames.has(field.name),
  );

  const forcedOpen =
    (invalidField !== undefined && secondaryNames.has(invalidField)) ||
    missing.some((name) => secondaryNames.has(name));
  const showMore = moreOpen || forcedOpen;

  useEffect(() => {
    if (invalidField === undefined) return;
    document.getElementById(`${formId}-${invalidField}`)?.focus();
  }, [invalidField, formId]);

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

  const renderField = (field: FormFieldSpec) => {
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

    const shared = {
      id: controlId,
      name: field.name,
      "aria-invalid": invalid ? (true as const) : undefined,
      "aria-describedby": describedBy === "" ? undefined : describedBy,
      "aria-required": field.required === true ? (true as const) : undefined,
    };

    return (
      <Field
        key={field.name}
        data-invalid={invalid ? true : undefined}
        className={field.kind === "textarea" ? "@xl/form:col-span-2" : ""}
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
  };

  const helpId = `${formId}-help`;

  return (
    <form
      noValidate
      onSubmit={submit}
      className="@container/form relative flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      <FieldSet disabled={busy} className="border-0 p-0">
        <FieldLegend
          variant="label"
          className={
            description === undefined ? "text-text" : "pr-10 text-text"
          }
        >
          {legend}
        </FieldLegend>
        {description === undefined ? null : (
          <>
            {/*
             * The explanation is help, not state: it collapses behind an
             * icon-led toggle at the card corner so the first field, not the
             * prose, is what the operator meets. Outcomes and errors stay
             * permanently visible below.
             */}
            <button
              type="button"
              aria-expanded={showHelp}
              aria-controls={helpId}
              title={t("aboutForm")}
              onClick={() => setShowHelp((open) => !open)}
              className="absolute top-1.5 right-1.5 flex min-h-touch min-w-touch items-center justify-center rounded-md text-muted outline-none hover:text-text focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Info aria-hidden="true" className="size-4" />
              <span className="sr-only">{t("aboutForm")}</span>
            </button>
            {showHelp ? (
              <FieldDescription
                id={helpId}
                className="max-w-prose leading-relaxed"
              >
                {description}
              </FieldDescription>
            ) : null}
          </>
        )}

        {outcome}

        <FieldGroup className="grid gap-4 @xl/form:grid-cols-2">
          {primaryFields.map(renderField)}
        </FieldGroup>

        {secondaryFields.length === 0 ? null : (
          <CollapsibleSection
            label={t("moreOptions")}
            icon={SlidersHorizontal}
            open={showMore}
            onToggle={setMoreOpen}
            contentClassName="grid gap-4 @xl/form:grid-cols-2"
          >
            {secondaryFields.map(renderField)}
          </CollapsibleSection>
        )}

        <div>
          <Button type="submit" variant="outline" className="gap-2">
            <Check aria-hidden="true" className="size-4" />
            {submitLabel}
          </Button>
        </div>
      </FieldSet>
    </form>
  );
}
