import { describe, expect, it } from "vitest";

import { ALL_CATALOGUES, messagesFor } from "./messages";
import { DEFAULT_LOCALE, LOCALES } from "./routing";

/**
 * The run-time half of `INV-0010-02`.
 *
 * The compile-time half is `MessageCatalogue = typeof th` plus the `satisfies`
 * on the English import, which catches a key present in English and missing in
 * Thai. This file catches the other direction and the failures a type cannot
 * see: an empty string, a key left in English inside the Thai file, and — the
 * one that actually breaks a screen — a message whose ICU placeholders differ
 * between locales, so `deniedHint` renders a request ID in one language and a
 * literal `{requestId}` in the other.
 */

type Json = Record<string, unknown>;

/** Every leaf, as `Namespace.key`, so a failure names the exact message. */
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

  /*
   * Not a translation-quality check — that is `OPS-0010-01`, and a reviewer with
   * warehouse Thai is the only thing that closes it. This catches the mechanical
   * failure of a Thai value that was never translated at all, which is what
   * happens when a key is added to both files by copy-paste.
   *
   * Codes, brand names, and identifiers are exempt by construction: the
   * exemptions below are the namespaces whose values are deliberately English
   * (`D-06` keeps code identifiers English) plus the product name.
   */
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
