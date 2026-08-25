import { describe, expect, it } from "vitest";

import { ALL_CATALOGUES, messagesFor } from "./messages";
import { DEFAULT_LOCALE, LOCALES } from "./routing";

type Json = Record<string, unknown>;

function flatten(value: Json, prefix = ""): ReadonlyMap<string, string> {
  const entries = new Map<string, string>();
  for (const [key, member] of Object.entries(value)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof member === "string") {
      entries.set(path, member);
    } else if (member !== null && typeof member === "object") {
      for (const [nested, leaf] of flatten(member as Json, path)) {
        entries.set(nested, leaf);
      }
    } else {
      throw new Error(`Message at ${path} is neither a string nor an object`);
    }
  }
  return entries;
}

const PLACEHOLDER = /\{(\w+)[^}]*\}/g;

const placeholdersOf = (message: string): readonly string[] =>
  [...message.matchAll(PLACEHOLDER)]
    .map((match) => match[1] ?? "")
    .sort((left, right) => left.localeCompare(right));

const FLATTENED = new Map(
  LOCALES.map((locale) => [
    locale,
    flatten(ALL_CATALOGUES[locale] as unknown as Json),
  ]),
);

describe("message catalogues", () => {
  it("declares a catalogue for every routed locale", () => {
    for (const locale of LOCALES) {
      expect(FLATTENED.get(locale)?.size ?? 0).toBeGreaterThan(0);
    }
  });

  it("has the same key set in every locale", () => {
    const thai = [...(FLATTENED.get("th") ?? new Map()).keys()].sort();
    const english = [...(FLATTENED.get("en") ?? new Map()).keys()].sort();

    expect(english).toEqual(thai);
  });

  it("has no empty message in any locale", () => {
    for (const locale of LOCALES) {
      for (const [key, message] of FLATTENED.get(locale) ?? []) {
        expect(message.trim(), `${locale}:${key}`).not.toBe("");
      }
    }
  });

  it("uses the same ICU placeholders for a key in every locale", () => {
    const thai = FLATTENED.get("th") ?? new Map<string, string>();
    const english = FLATTENED.get("en") ?? new Map<string, string>();

    for (const [key, message] of thai) {
      expect(placeholdersOf(english.get(key) ?? ""), key).toEqual(
        placeholdersOf(message),
      );
    }
  });

  it("never interpolates a bare count into an English message", () => {
    const bare: string[] = [];
    for (const [key, message] of FLATTENED.get("en") ?? []) {
      if (/\{count\}/.test(message)) bare.push(`${key} = ${message}`);
    }

    expect(bare).toEqual([]);
  });

  it("never lets a select placeholder repeat its own field label", () => {
    const pairs: readonly (readonly [string, string])[] = [
      ["Purchasing.fieldSupplier", "Purchasing.selectSupplier"],
      ["Purchasing.fieldItem", "Purchasing.selectItem"],
      ["Purchasing.fieldOrder", "Purchasing.selectOrder"],
      ["Receiving.fieldLocation", "Receiving.selectLocation"],
      ["Receiving.fieldOrderLine", "Receiving.selectOrderLine"],
      ["Receiving.fieldItemChoice", "Receiving.selectItemChoice"],
      ["Receiving.exceptionKind", "Receiving.selectExceptionKind"],
      ["Quality.fieldDisposition", "Quality.selectDisposition"],
      ["Putaway.fieldChosenLocation", "Putaway.selectChosenLocation"],
      ["MasterData.columnTrackingMode", "MasterData.selectTrackingMode"],
      ["MasterData.columnLocationType", "MasterData.selectLocationType"],
      ["MasterData.columnFormat", "MasterData.selectFormat"],
      ["MasterData.columnBarcodeKind", "MasterData.selectBarcodeKind"],
      ["LabelEvidence.fieldTemplate", "LabelEvidence.selectTemplate"],
      ["Write.reasonCodeLabel", "Write.selectReasonCode"],
    ];

    for (const locale of LOCALES) {
      const catalogue = FLATTENED.get(locale) ?? new Map<string, string>();
      for (const [labelKey, placeholderKey] of pairs) {
        const label = catalogue.get(labelKey);
        const placeholder = catalogue.get(placeholderKey);
        expect(label, `${locale}:${labelKey}`).toBeDefined();
        expect(placeholder, `${locale}:${placeholderKey}`).toBeDefined();
        expect(placeholder, `${locale}:${placeholderKey}`).not.toBe(label);
      }
    }
  });

  it("gives an open order and an open order line distinct English labels", () => {
    for (const locale of LOCALES) {
      const catalogue = FLATTENED.get(locale) ?? new Map<string, string>();
      const order = catalogue.get("PurchaseOrderStatus.OPEN");
      const line = catalogue.get("PurchaseOrderLineStatus.OPEN");

      expect(order, `${locale}:PurchaseOrderStatus.OPEN`).toBeTruthy();
      expect(line, `${locale}:PurchaseOrderLineStatus.OPEN`).toBeTruthy();
      expect(line, locale).not.toBe(order);
    }
  });

  it("does not print one heading twice as its own callout", () => {
    for (const locale of LOCALES) {
      const catalogue = FLATTENED.get(locale) ?? new Map<string, string>();
      for (const key of [
        "Quality.sectionApproval",
        "Quality.approvalRule",
        "Quality.approveLegend",
      ]) {
        expect(catalogue.get(key), `${locale}:${key}`).not.toBe(
          catalogue.get("Quality.approve"),
        );
      }
    }
  });

  it("keeps the import check's heading, legend, and action distinct", () => {
    for (const locale of LOCALES) {
      const catalogue = FLATTENED.get(locale) ?? new Map<string, string>();
      const labels = [
        "Purchasing.importPreview",
        "Purchasing.importPreviewLegend",
        "Purchasing.importPreviewSubmit",
      ].map((key) => catalogue.get(key));

      expect(
        labels.every((label) => (label ?? "") !== ""),
        locale,
      ).toBe(true);
      expect(new Set(labels).size, locale).toBe(labels.length);
    }
  });

  it("has Thai characters in Thai prose messages", () => {
    const thaiCharacters = /[฀-๿]/;
    const exemptPrefixes = ["App.", "Locale.th", "Locale.en"];

    for (const [key, message] of FLATTENED.get("th") ?? []) {
      if (exemptPrefixes.some((prefix) => key.startsWith(prefix))) continue;
      expect(thaiCharacters.test(message), `${key} = ${message}`).toBe(true);
    }
  });
});

describe("messagesFor", () => {
  it("returns the requested locale's catalogue", () => {
    expect(messagesFor("en")).toBe(ALL_CATALOGUES.en);
    expect(messagesFor("th")).toBe(ALL_CATALOGUES.th);
  });

  it("falls back to the default locale, not to English, for an unknown segment", () => {
    expect(messagesFor("xx")).toBe(ALL_CATALOGUES[DEFAULT_LOCALE]);
    expect(DEFAULT_LOCALE).toBe("th");
  });
});
