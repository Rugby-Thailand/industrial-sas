"use client";
import { Button } from "@/components/ui/button";
import { Field, panel, useFGText } from "./shared";
import { validFill, type ScanEvent, type ScanSession } from "./scanSession";
export function ScanGroupDetails({
  state,
  dispatch,
}: {
  state: ScanSession;
  dispatch: (event: ScanEvent) => void;
}) {
  const { t } = useFGText();
  return (
    <section className={`${panel} space-y-5`}>
      <fieldset>
        <legend className="mb-2 font-medium">
          {t("copy.are-all-packages-pallets-a-similar-size-7e4d05")}
        </legend>
        <div className="flex gap-2">
          {[true, false].map((value) => (
            <Button
              key={String(value)}
              variant={state.sameSize === value ? "default" : "outline"}
              className="min-h-11"
              aria-pressed={state.sameSize === value}
              onClick={() => dispatch({ type: "size", value: value! })}
            >
              {value ? t("copy.yes") : t("copy.no")}
            </Button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 font-medium">
          {t("copy.are-they-all-full-100")}
        </legend>
        <div className="flex flex-wrap gap-2">
          {[
            ["100", t("copy.full-100")],
            ["75", "¾ (75%)"],
            ["50", t("copy.half-50")],
            ["25", "¼ (25%)"],
            ["", t("copy.custom")],
          ].map(([value, label]) => (
            <Button
              key={label}
              className="min-h-11"
              variant={state.fill === value ? "default" : "outline"}
              aria-pressed={state.fill === value}
              onClick={() => dispatch({ type: "fill", value: value! })}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="mt-3 max-w-56">
          <Field
            label={t("copy.common-fullness")}
            type="number"
            min={1}
            max={100}
            step="1"
            value={state.fill}
            onChange={(value) => dispatch({ type: "fill", value: value! })}
          />
        </div>
        <Button
          className="mt-3 min-h-11"
          variant="outline"
          disabled={!validFill(state.fill)}
          onClick={() => dispatch({ type: "applyFill" })}
        >
          {t("copy.apply-common-fullness-to-all-packages")}
        </Button>
        <p className="mt-2 text-sm text-muted">
          {t(
            "copy.visual-estimate-only-saved-preparation-values-remain-as-exceptions-fulln",
          )}
        </p>
      </fieldset>
    </section>
  );
}
