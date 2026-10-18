/**
 * Kiro audit probes — locale catalogue mixing (Thai/English).
 * Reads the real messages through the app's loader. Each test asserts the
 * EXPECTED behaviour; a failure on current source is the evidence. The render
 * locations are source-traced and listed in report.md.
 *
 * Run: pnpm exec vitest run --config docs/reviews/system-audit-2026-10-14/kiro/vitest.config.mts locale
 */
import { describe, expect, it } from "vitest";

import { messagesFor } from "@/i18n/messages";

type Tree = { readonly [key: string]: string | Tree };
function flatten(tree: Tree, prefix = "", out: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else flatten(value, path, out);
  }
  return out;
}
const en = flatten(messagesFor("en") as unknown as Tree);
const th = flatten(messagesFor("th") as unknown as Tree);
const THAI = /[\u0E00-\u0E7F]/;

describe("English UI copy", () => {
  it("K-LOC-01 English AI Search examples and date hints are written in English", () => {
    const keys = [
      "Search.exampleSelf",
      "Search.exampleReview",
      "Search.exampleHoliday",
      "Search.exampleProfile",
      "Search.clarify.DATE",
      "Search.clarify.RANGE",
      "Search.clarify.DATE_UNSUPPORTED",
      "Search.clarify.DATE_AMBIGUOUS",
    ];
    const thai = keys
      .filter((key) => THAI.test(en[key] ?? ""))
      .map((key) => `${key} = ${JSON.stringify(en[key])}`);
    console.info("K-LOC-01 English strings containing Thai:", thai);
    expect(thai).toEqual([]);
  });
});

describe("Thai UI copy", () => {
  it("K-LOC-02 Thai storage labels do not repeat an English label beside the Thai one", () => {
    const keys = [
      "StorageLayouts.canvasFloor",
      "StorageLayouts.quickChange",
      "StorageLayouts.quickChangeActive",
    ];
    const mixed = keys
      .filter((key) => /[A-Z]{2,}|Quick Change/.test(th[key] ?? ""))
      .map((key) => `${key} = ${JSON.stringify(th[key])}`);
    console.info("K-LOC-02 Thai strings containing English labels:", mixed);
    expect(mixed).toEqual([]);
  });
});
