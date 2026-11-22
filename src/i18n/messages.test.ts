import {
  parse,
  TYPE,
  type MessageFormatElement,
} from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";

import { ALL_CATALOGUES, messagesFor } from "./messages";
import { DEFAULT_LOCALE, LOCALES } from "./routing";
import { pickMessages, ROUTE_NAMESPACES } from "./clientMessages";

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

/** Plural branches can repeat arguments and contain ordinary words in braces. */
function placeholdersOf(message: string): readonly string[] {
  const argumentsUsed = new Set<string>();
  function visit(elements: readonly MessageFormatElement[]) {
    for (const element of elements) {
      if (element.type === TYPE.literal || element.type === TYPE.pound)
        continue;
      argumentsUsed.add(element.value);
      if ("options" in element)
        for (const option of Object.values(element.options))
          visit(option.value);
      if (element.type === TYPE.tag) visit(element.children);
    }
  }
  visit(parse(message));
  return [...argumentsUsed].sort();
}

const FLATTENED = new Map(
  LOCALES.map((locale) => [
    locale,
    flatten(ALL_CATALOGUES[locale] as unknown as Json),
  ]),
);

describe("message catalogues", () => {
  it("supplies registration copy to the master-data route provider in each locale", () => {
    for (const locale of LOCALES) {
      const scoped = pickMessages(
        ALL_CATALOGUES[locale],
        ROUTE_NAMESPACES["(desktop)/master-data"],
      );
      expect(scoped.JobScan.registeredLocations).toBe(
        ALL_CATALOGUES[locale].JobScan.registeredLocations,
      );
    }
  });
  it("delivers the Home editor and its setup fallback in both languages", () => {
    for (const locale of LOCALES) {
      const scoped = pickMessages(
        ALL_CATALOGUES[locale],
        ROUTE_NAMESPACES["(desktop)/dashboard"],
      );
      expect(scoped.Home).toEqual(ALL_CATALOGUES[locale].Home);
      expect(scoped.Setup).toEqual(ALL_CATALOGUES[locale].Setup);
    }
  });

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
