"use client";

import { useRef, useState } from "react";
import { Popover } from "radix-ui";
import { useTranslations } from "next-intl";
import {
  ClearFilterButton,
  FilterTrigger,
} from "@/components/system/FilterActions";
import { CheckboxField } from "@/components/ui/CheckboxControl";
import { Button } from "@/components/ui/button";

const choices = ["empty", "stored", "reserved", "unmeasured"] as const;
export type LocationFilter = (typeof choices)[number];
type Props = {
  filters: readonly LocationFilter[];
  onFilters: (value: readonly LocationFilter[]) => void;
  className?: string | undefined;
};

export function LocationFilters({ filters, onFilters, className }: Props) {
  const t = useTranslations("StorageLayouts.locationTable");
  const trigger = useRef<HTMLButtonElement>(null);
  const names = filters
    .map((key) => t(key === "empty" ? "vacant" : key))
    .join(", ");
  const label = names ? `${t("filters")} · ${names}` : t("filters");
  return (
    <div className="inline-flex items-center">
      <Popover.Root>
        <Popover.Trigger asChild>
          <FilterTrigger
            ref={trigger}
            className={className}
            label={label}
            count={Number(filters.length > 0)}
          />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            aria-label={t("filters")}
            align="end"
            sideOffset={6}
            collisionPadding={8}
            className="z-50 w-64 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
          >
            <LocationFilterChoices filters={filters} onFilters={onFilters} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {filters.length > 0 && (
        <ClearFilterButton
          label={t("clear")}
          className={className}
          onClick={() => {
            onFilters([]);
            trigger.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function LocationFilterChoices({ filters, onFilters }: Props) {
  const t = useTranslations("StorageLayouts.locationTable");
  const actions = useTranslations("StorageLayouts.filterActions");
  const [draft, setDraft] = useState(filters);
  return (
    <fieldset>
      <legend className="mb-1 font-semibold">{t("filters")}</legend>
      {choices.map((key) => (
        <CheckboxField
          key={key}
          label={t(key === "empty" ? "vacant" : key)}
          checked={draft.includes(key)}
          onChange={(e) =>
            setDraft(
              e.target.checked
                ? [...draft, key]
                : draft.filter((item) => item !== key),
            )
          }
        />
      ))}
      <div className="mt-2 flex justify-end gap-2">
        <Popover.Close asChild>
          <Button type="button" variant="ghost">
            {actions("cancel")}
          </Button>
        </Popover.Close>
        <Popover.Close asChild>
          <Button type="button" onClick={() => onFilters(draft)}>
            {actions("apply")}
          </Button>
        </Popover.Close>
      </div>
    </fieldset>
  );
}
