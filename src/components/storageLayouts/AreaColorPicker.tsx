"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Popover } from "radix-ui";
import { Check, Palette, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AREA_COLOR_PRESETS,
  areaColorText,
  normalizeAreaColor,
  resolveAreaColor,
} from "@/lib/storageLayouts/areaColors";

export function AreaColorPicker({
  value,
  onChange,
}: {
  readonly value?: string;
  readonly onChange: (color: string) => void;
}) {
  const t = useTranslations("StorageLayouts.areaColor");
  const id = useId();
  const color = resolveAreaColor(value);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(color);
  const normalized = normalizeAreaColor(custom);
  const isCustom = !AREA_COLOR_PRESETS.some((preset) => preset.color === color);

  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-medium text-text">
        {t("label")}
      </legend>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {AREA_COLOR_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            aria-pressed={color === preset.color}
            onClick={() => onChange(preset.color)}
            className="rounded-lg border border-border p-1.5 text-xs text-text outline-none hover:bg-accent/10 focus-visible:ring-2 focus-visible:ring-accent aria-pressed:border-accent aria-pressed:ring-2 aria-pressed:ring-accent"
          >
            <span
              className="mb-1 flex h-10 items-center justify-center rounded border border-black/15"
              style={{
                backgroundColor: preset.color,
                color: areaColorText(preset.color),
              }}
            >
              {color === preset.color && (
                <Check aria-hidden="true" className="size-5" />
              )}
            </span>
            {t(`presets.${preset.key}`)}
          </button>
        ))}
        <Popover.Root
          open={open}
          onOpenChange={(next) => {
            if (next) setCustom(color);
            setOpen(next);
          }}
        >
          <Popover.Trigger asChild>
            <button
              type="button"
              className="rounded-lg border border-border p-1.5 text-xs text-text outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={t("more")}
            >
              <span
                className="mb-1 flex h-10 items-center justify-center rounded border border-border"
                style={
                  isCustom
                    ? { backgroundColor: color, color: areaColorText(color) }
                    : undefined
                }
              >
                {isCustom ? (
                  <Check aria-hidden="true" className="size-5" />
                ) : (
                  <Palette aria-hidden="true" className="size-5" />
                )}
              </span>
              {t("more")}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              sideOffset={8}
              collisionPadding={16}
              aria-label={t("customTitle")}
              className="z-[60] w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="font-semibold">{t("customTitle")}</h3>
                <Popover.Close asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("close")}
                  >
                    <X className="size-4" />
                  </Button>
                </Popover.Close>
              </div>
              <Label htmlFor={`${id}-picker`}>{t("picker")}</Label>
              <input
                id={`${id}-picker`}
                type="color"
                value={normalized ?? color}
                onChange={(event) =>
                  setCustom(event.target.value.toUpperCase())
                }
                className="my-2 h-12 w-full cursor-pointer rounded border border-border"
              />
              <Label htmlFor={`${id}-hex`}>{t("hex")}</Label>
              <Input
                id={`${id}-hex`}
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                aria-invalid={!normalized}
                aria-describedby={!normalized ? `${id}-error` : undefined}
                spellCheck={false}
                className="mt-2"
              />
              {!normalized && (
                <p
                  id={`${id}-error`}
                  role="alert"
                  className="mt-2 text-sm text-destructive"
                >
                  {t("invalid")}
                </p>
              )}
              <Button
                type="button"
                className="mt-3 w-full"
                disabled={!normalized}
                onClick={() => {
                  if (normalized) {
                    onChange(normalized);
                    setOpen(false);
                  }
                }}
              >
                {t("apply")}
              </Button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
      <p className="mt-2 text-xs text-muted">{t("selected", { color })}</p>
    </fieldset>
  );
}
