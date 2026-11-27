"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { CollectionToolbar } from "@/components/system/CollectionToolbar";
import { ClearFilterButton } from "@/components/system/FilterActions";
import { FilterRadios } from "@/components/system/FilterRadios";
import {
  SelectControl,
  type SelectControlOption,
} from "@/components/ui/SelectControl";
import type { LocationCatalogueState } from "./useLocationCatalogueState";

export function StorageCatalogueSearch({
  label,
  placeholder,
  value,
  onChange,
  action,
  clearLabel,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  action?: ReactNode;
  clearLabel?: string;
}) {
  const t = useTranslations("StorageLayouts");
  return (
    <CollectionToolbar
      value={value}
      onValueChange={onChange}
      searchLabel={label}
      placeholder={placeholder}
      clearLabel={clearLabel ?? t("clearSearch")}
      actions={action}
      searchType="text"
      className="min-w-0 flex-nowrap [&>div]:min-w-0"
    />
  );
}

const statuses = ["ALL", "ACTIVE", "DRAFT", "ARCHIVED"] as const;

export function StorageCatalogueStatuses({
  id: fieldId,
  value,
  onChange,
}: {
  id?: string;
  value: LocationCatalogueState["status"];
  onChange: (value: LocationCatalogueState["status"]) => void;
}) {
  const t = useTranslations("StorageLayouts");
  const generatedId = useId();
  const id = fieldId ?? generatedId;
  const labels = [t("allStatuses"), t("active"), t("draft"), t("archived")];
  return (
    <div className="flex flex-wrap items-center gap-1">
      <FilterRadios
        id={id}
        label={t("statusFilter")}
        value={value}
        options={statuses.map((status, index) => ({
          value: status,
          label: labels[index]!,
        }))}
        onChange={(next) => {
          const status = statuses.find((candidate) => candidate === next);
          if (status) onChange(status);
        }}
        wrap
      />
      {value !== "ALL" ? (
        <ClearFilterButton
          label={t("clearCondition", { field: t("locationStatus") })}
          onClick={() => {
            onChange("ALL");
            document.getElementById(id)?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

export function StorageCatalogueDimension({
  label,
  value,
  options,
  onChange,
  onClear,
}: {
  label: string;
  value: string;
  options: readonly SelectControlOption[];
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  const t = useTranslations("StorageLayouts");
  const id = useId();
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const matchesSearch = (option: SelectControlOption) =>
    option.label.toLocaleLowerCase().includes(query);
  const hasMatches = options.some(
    (option) => option.value !== "ALL" && matchesSearch(option),
  );
  const visible = options.filter(
    (option) =>
      option.value === "ALL" || option.value === value || matchesSearch(option),
  );
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center gap-1">
        <label className="text-sm font-medium text-text" htmlFor={id}>
          {label}
        </label>
        {value !== "ALL" ? (
          <ClearFilterButton
            label={t("clearCondition", { field: label })}
            onClick={() => {
              onClear();
              document.getElementById(id)?.focus();
            }}
          />
        ) : null}
      </div>
      {options.length > 11 ? (
        <>
          <StorageCatalogueSearch
            label={t("searchChoices", { field: label })}
            placeholder={t("searchChoices", { field: label })}
            value={search}
            onChange={setSearch}
            clearLabel={t("clearChoiceSearch", { field: label })}
          />
          <div className="max-h-44 overflow-y-auto rounded-md border border-border p-1">
            <FilterRadios
              id={id}
              label={label}
              value={value}
              options={visible}
              onChange={onChange}
            />
          </div>
          {!hasMatches ? (
            <p className="text-xs text-muted" role="status">
              {t("noMatchingChoices")}
            </p>
          ) : null}
        </>
      ) : (
        <SelectControl
          id={id}
          value={value}
          label={label}
          onValueChange={onChange}
          options={options}
          placeholder={label}
          emptyLabel={label}
        />
      )}
    </div>
  );
}
