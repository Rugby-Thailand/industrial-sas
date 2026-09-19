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
  const { tr } = useFGText();
  return (
    <section className={`${panel} space-y-5`}>
      <fieldset>
        <legend className="mb-2 font-medium">
          {tr(
            "Are all packages/pallets a similar size?",
            "พัสดุ/พาเลททั้งหมดมีขนาดใกล้เคียงกันหรือไม่?",
          )}
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
              {value ? tr("Yes", "ใช่") : tr("No", "ไม่ใช่")}
            </Button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 font-medium">
          {tr("Are they all full (100%)?", "ทั้งหมดเต็ม (100%) หรือไม่?")}
        </legend>
        <div className="flex flex-wrap gap-2">
          {[
            ["100", tr("Full (100%)", "เต็ม (100%)")],
            ["75", "¾ (75%)"],
            ["50", tr("Half (50%)", "ครึ่ง (50%)")],
            ["25", "¼ (25%)"],
            ["", tr("Custom", "กำหนดเอง")],
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
            label={tr("Common fullness (%)", "เปอร์เซ็นต์ความเต็มร่วม (%)")}
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
          {tr(
            "Apply common fullness to all packages",
            "ใช้เปอร์เซ็นต์ร่วมกับพัสดุทั้งหมด",
          )}
        </Button>
        <p className="mt-2 text-sm text-muted">
          {tr(
            "Visual estimate only. Saved preparation values remain as exceptions. Fullness does not change product quantity.",
            "ประเมินด้วยสายตาเท่านั้น ค่าจากการจัดเตรียมยังคงเป็นค่าเฉพาะชิ้น ความเต็มไม่เปลี่ยนจำนวนสินค้า",
          )}
        </p>
      </fieldset>
    </section>
  );
}
