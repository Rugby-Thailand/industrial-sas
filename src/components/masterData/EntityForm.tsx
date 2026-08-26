"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  SlidersHorizontal,
} from "lucide-react";
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
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperPanel,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/reui/stepper";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

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

export interface FormSectionSpec {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly fields: readonly string[];
  readonly content?: ReactNode;
}

export interface MobileStepperLabels {
  readonly step: (current: number, total: number) => string;
  readonly previous: string;
  readonly next: string;
}

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
  readonly legendPresentation?: "visible" | "sr-only";
  readonly sections?: readonly FormSectionSpec[];
  readonly mobileStepperLabels?: MobileStepperLabels;
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
  legendPresentation = "visible",
  sections,
  mobileStepperLabels,
}: EntityFormProps) {
  const t = useTranslations("Write");
  const isMobile = useIsMobile();
  const formId = useId();
  const [values, setValues] = useState<FormValues>(() => initialValues(fields));
  const [missing, setMissing] = useState<readonly string[]>([]);
  const [seenReset, setSeenReset] = useState(resetSignal);
  const [showHelp, setShowHelp] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);

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
    setCurrentStep(1);
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
    if (blank.length > 0) {
      if (isMobile && sections !== undefined) {
        const firstInvalidStep = sections.findIndex((section) =>
          section.fields.some((name) => blank.includes(name)),
        );
        if (firstInvalidStep >= 0) setCurrentStep(firstInvalidStep + 1);
      }
      return;
    }

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
    const selectPlaceholder = field.placeholder ?? t("selectOption");

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
            placeholder={selectPlaceholder}
            emptyLabel={selectPlaceholder}
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
  const fieldsByName = new Map(fields.map((field) => [field.name, field]));
  const sectionFields = (section: FormSectionSpec) =>
    section.fields.flatMap((name) => {
      const field = fieldsByName.get(name);
      return field === undefined ? [] : [field];
    });
  const renderSection = (section: FormSectionSpec) => (
    <section
      key={section.id}
      className="rounded-xl border border-border bg-raised/35 p-4 sm:p-5"
      aria-labelledby={`${formId}-section-${section.id}`}
    >
      <div className="mb-4">
        <h3
          id={`${formId}-section-${section.id}`}
          className="font-semibold text-text"
        >
          {section.title}
        </h3>
        {section.description === undefined ? null : (
          <p className="mt-1 text-sm text-muted">{section.description}</p>
        )}
      </div>
      {section.fields.length === 0 ? null : (
        <FieldGroup className="grid gap-4 @xl/form:grid-cols-2">
          {sectionFields(section).map(renderField)}
        </FieldGroup>
      )}
      {section.content === undefined ? null : (
        <div className={cn(section.fields.length > 0 && "mt-4")}>
          {section.content}
        </div>
      )}
    </section>
  );

  const validateCurrentStep = () => {
    if (sections === undefined) return;
    const section = sections[currentStep - 1];
    if (section === undefined) return;
    const blank = sectionFields(section)
      .filter(
        (field) =>
          field.required === true &&
          (values[field.name] ?? "").trim().length === 0,
      )
      .map((field) => field.name);
    setMissing(blank);
    if (blank.length === 0) {
      setCurrentStep((step) => Math.min(step + 1, sections.length));
    }
  };

  const submitButton = (
    <Button type="submit" className="gap-2">
      <Check aria-hidden="true" className="size-4" />
      {submitLabel}
    </Button>
  );

  return (
    <form
      noValidate
      onSubmit={submit}
      className={cn(
        "@container/form relative flex flex-col gap-4",
        sections === undefined
          ? "rounded-lg border border-border bg-surface p-4"
          : "py-4",
      )}
      {...(testId === undefined ? {} : { "data-testid": testId })}
    >
      <FieldSet disabled={busy} className="border-0 p-0">
        <FieldLegend
          variant="label"
          className={
            legendPresentation === "sr-only"
              ? "sr-only"
              : description === undefined
                ? "text-text"
                : "pr-10 text-text"
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

        {sections === undefined ? (
          <FieldGroup className="grid gap-4 @xl/form:grid-cols-2">
            {primaryFields.map(renderField)}
          </FieldGroup>
        ) : isMobile && mobileStepperLabels !== undefined ? (
          <Stepper
            value={currentStep}
            onValueChange={setCurrentStep}
            indicators={{
              completed: <Check aria-hidden="true" className="size-3.5" />,
            }}
            className="space-y-5"
          >
            <div className="overflow-x-auto pb-1">
              <StepperNav className="min-w-max gap-2 pr-2">
                {sections.map((section, index) => (
                  <StepperItem
                    key={section.id}
                    step={index + 1}
                    className="relative min-w-28 items-start"
                  >
                    <StepperTrigger
                      type="button"
                      className="flex w-full flex-col items-start gap-2 rounded-lg p-2 text-left"
                    >
                      <StepperIndicator className="size-8 border-2 data-[state=inactive]:bg-transparent">
                        {index + 1}
                      </StepperIndicator>
                      <div>
                        <span className="text-[10px] font-semibold tracking-wide text-muted uppercase">
                          {mobileStepperLabels.step(index + 1, sections.length)}
                        </span>
                        <StepperTitle className="mt-1 max-w-28 leading-snug">
                          {section.title}
                        </StepperTitle>
                      </div>
                    </StepperTrigger>
                    {index < sections.length - 1 ? (
                      <StepperSeparator className="absolute top-6 left-10 w-[calc(100%-1.5rem)]" />
                    ) : null}
                  </StepperItem>
                ))}
              </StepperNav>
            </div>
            <StepperPanel>
              {sections.map((section, index) => (
                <StepperContent key={section.id} value={index + 1}>
                  {renderSection(section)}
                </StepperContent>
              ))}
            </StepperPanel>
          </Stepper>
        ) : (
          <div className="space-y-4">{sections.map(renderSection)}</div>
        )}

        {sections !== undefined || secondaryFields.length === 0 ? null : (
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

        <div
          className={cn(
            "flex items-center gap-2",
            sections !== undefined &&
              "sticky bottom-0 z-10 -mx-4 -mb-4 border-t border-border bg-popover/95 p-4 backdrop-blur sm:-mx-6 sm:px-6",
            sections === undefined && "justify-start",
            sections !== undefined && !isMobile && "justify-end",
            sections !== undefined && isMobile && "justify-between",
          )}
        >
          {sections !== undefined &&
          isMobile &&
          mobileStepperLabels !== undefined ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={currentStep === 1}
                onClick={() => setCurrentStep((step) => Math.max(1, step - 1))}
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
                {mobileStepperLabels.previous}
              </Button>
              {currentStep === sections.length ? (
                submitButton
              ) : (
                <Button type="button" onClick={validateCurrentStep}>
                  {mobileStepperLabels.next}
                  <ChevronRight aria-hidden="true" className="size-4" />
                </Button>
              )}
            </>
          ) : (
            submitButton
          )}
        </div>
      </FieldSet>
    </form>
  );
}
