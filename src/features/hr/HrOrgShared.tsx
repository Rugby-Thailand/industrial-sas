"use client";

import { useTranslations } from "next-intl";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import type { DialogCompletionHandle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/StatusBadge";

import { useHrError } from "./HrShared";
import type { HrWriteState } from "./useHrWrite";

export type OrgStatus = "ACTIVE" | "INACTIVE";

export const ADDRESS_KEYS = [
  "address",
  "addressEn",
  "province",
  "district",
  "subDistrict",
  "postcode",
] as const;
export type AddressKey = (typeof ADDRESS_KEYS)[number];
export type AddressDraft = Record<AddressKey, string>;
/** `addressEn` is the only optional address line. */
export const REQUIRED_ADDRESS: readonly AddressKey[] = [
  "address",
  "province",
  "district",
  "subDistrict",
  "postcode",
];

export interface AddressRow {
  readonly address: string;
  readonly addressEn?: string | undefined;
  readonly province: string;
  readonly district: string;
  readonly subDistrict: string;
  readonly postcode: string;
}

export interface BranchRow extends AddressRow {
  readonly id: string;
  readonly name: string;
  readonly nameEn?: string | undefined;
  readonly revenueBranchNo: string;
  readonly ssoEmployerAccount: string;
  readonly type: "HEAD_OFFICE" | "BRANCH";
  readonly status: OrgStatus;
  readonly version: number;
}

export interface MasterRow {
  readonly id: string;
  readonly name: string;
  readonly nameEn?: string | undefined;
  readonly status: OrgStatus;
  readonly version: number;
  readonly managerEmployeeId?: string | undefined;
  readonly sortOrder?: number | undefined;
}

export type FieldErrors = Readonly<Record<string, string>>;

export const addressDraft = (row: AddressRow | null | undefined) =>
  Object.fromEntries(
    ADDRESS_KEYS.map((key) => [key, row?.[key] ?? ""]),
  ) as AddressDraft;

/** Trimmed values; an empty optional line is omitted rather than sent blank. */
export function addressPayload(draft: AddressDraft) {
  const addressEn = draft.addressEn.trim();
  return {
    address: draft.address.trim(),
    ...(addressEn === "" ? {} : { addressEn }),
    province: draft.province.trim(),
    district: draft.district.trim(),
    subDistrict: draft.subDistrict.trim(),
    postcode: draft.postcode.trim(),
  };
}

export const optionalText = (value: string) => {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

/** Required-field checks shared by the company and branch forms. */
export function missingFields(
  values: Readonly<Record<string, string>>,
  required: readonly string[],
  message: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const key of required)
    if ((values[key] ?? "").trim() === "") errors[key] = message;
  return errors;
}

/** A refused save's field code as a message beside that field. */
export function useRefusalFields() {
  const message = useHrError();
  return (result: HrWriteState<unknown>): FieldErrors =>
    result.kind === "REFUSED" && result.field !== undefined
      ? { [result.field]: message(result.code) }
      : {};
}

/**
 * Close a shared Dialog after a successful save, once its write has settled:
 * the Dialog consumes its own history entry first, so the next Back reaches
 * the page's real origin instead of a dead editor entry.
 */
export function useDialogCompletion(
  pending: boolean,
  dialog: RefObject<DialogCompletionHandle | null>,
  close: () => void,
) {
  const [completion, setCompletion] = useState<object>();
  const consumed = useRef<object>(undefined);
  const latestClose = useRef(close);
  useEffect(() => {
    latestClose.current = close;
  });
  useEffect(() => {
    if (pending || completion === undefined || consumed.current === completion)
      return;
    consumed.current = completion;
    dialog.current?.complete(() => latestClose.current());
  }, [completion, dialog, pending]);
  return () => setCompletion({});
}

/** The rows of an org list or options query; undefined until it answers. */
export function orgItems<Row>(outcome: unknown): readonly Row[] | undefined {
  const result = outcome as
    | { readonly ok?: boolean; readonly value?: { readonly items?: unknown } }
    | undefined;
  if (result?.ok !== true) return undefined;
  return Array.isArray(result.value?.items)
    ? (result.value.items as Row[])
    : [];
}

export function OrgStatusBadge({ status }: { readonly status: OrgStatus }) {
  const t = useTranslations("Hr.org");
  return (
    <StatusBadge
      tone={status === "ACTIVE" ? "success" : "muted"}
      label={t(status === "ACTIVE" ? "active" : "inactive")}
    />
  );
}

/** A labelled group of radio choices with an optional inline error. */
export function RadioFieldset<Value extends string>({
  id,
  legend,
  value,
  options,
  onChange,
  error,
}: {
  readonly id: string;
  readonly legend: string;
  readonly value: string;
  readonly options: readonly {
    readonly value: Value;
    readonly label: string;
  }[];
  readonly onChange: (value: Value) => void;
  readonly error?: string | undefined;
}) {
  return (
    <fieldset aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="mb-2 text-xs font-medium text-text">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-touch items-center gap-2 rounded-md border border-border px-3 text-sm text-text"
          >
            <input
              type="radio"
              name={id}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="size-4 accent-primary"
            />
            {option.label}
          </label>
        ))}
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Thai address block; province and district stay free text for now. */
export function AddressFields({
  id,
  value,
  errors,
  onChange,
}: {
  readonly id: string;
  readonly value: AddressDraft;
  readonly errors: FieldErrors;
  readonly onChange: (key: AddressKey, value: string) => void;
}) {
  const t = useTranslations("Hr.org");
  const field = (
    key: AddressKey,
    options: { wide?: boolean; inputMode?: "numeric"; max?: number } = {},
  ): ReactNode => (
    <FormField
      key={key}
      id={`${id}-${key}`}
      label={t(key)}
      required={key !== "addressEn"}
      error={errors[key]}
      {...(options.wide ? { className: "sm:col-span-2" } : {})}
    >
      {(props) => (
        <Input
          {...props}
          value={value[key]}
          maxLength={options.max ?? 120}
          autoComplete="off"
          {...(options.inputMode ? { inputMode: options.inputMode } : {})}
          onChange={(event) => onChange(key, event.target.value)}
        />
      )}
    </FormField>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {field("address", { wide: true, max: 500 })}
      {field("addressEn", { wide: true, max: 500 })}
      {field("province")}
      {field("district")}
      {field("subDistrict")}
      {field("postcode", { inputMode: "numeric", max: 10 })}
    </div>
  );
}
