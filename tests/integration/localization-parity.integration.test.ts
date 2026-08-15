/**
 * Integration tier — Thai and English content completion (`ADR-0010`, `D-06`,
 * plan §10 Phase 4).
 *
 * "Thai-first" is a claim that decays silently. A key added to `en.json` and
 * forgotten in `th.json` does not crash: `next-intl` falls back, and a Thai
 * operator gets one English sentence in the middle of a Thai screen — which is
 * exactly where they stop trusting the screen. Nothing in a type checker or a
 * render test catches it, because both languages "work".
 *
 * So the parity is asserted structurally, in both directions, along with the two
 * rules that make the Thai side real rather than machine-shaped: interpolation
 * placeholders must match, and no Thai value may be a copy of the English one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

type Catalogue = Readonly<Record<string, unknown>>;

const load = (locale: string): Catalogue =>
  JSON.parse(
    readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8"),
  );

const en = load("en");
const th = load("th");

/** Every `namespace.key` in one catalogue. */
const pathsOf = (catalogue: Catalogue): string[] => {
  const visit = (value: unknown, prefix: string): string[] =>
    typeof value === "string"
      ? [prefix]
      : value !== null && typeof value === "object" && !Array.isArray(value)
        ? Object.entries(value).flatMap(([key, child]) =>
            visit(child, prefix.length === 0 ? key : `${prefix}.${key}`),
          )
        : [];
  return visit(catalogue, "");
};

const valueAt = (catalogue: Catalogue, path: string): string => {
  const value = path
    .split(".")
    .reduce<unknown>(
      (current, key) =>
        current !== null && typeof current === "object"
          ? (current as Readonly<Record<string, unknown>>)[key]
          : undefined,
      catalogue,
    );
  return typeof value === "string" ? value : "";
};

/**
 * Messages that are legitimately identical in both languages.
 *
 * A product name is not translated — "Industrial SAS" is the same string on a
 * Thai screen and an English one, and rendering it in Thai script would be
 * inventing a second brand. Each entry is listed individually so the exception
 * stays a decision rather than a pattern that quietly swallows real omissions.
 */
const IDENTICAL_BY_DESIGN = new Set(["App.name", "App.documentTitle"]);

/**
 * `{when}`, `{count}` — the names a message interpolates, plural forms included.
 *
 * An argument is named either by a bare `{name}` or by the head of an ICU
 * construct, `{name, plural, …}`. English needs the second form wherever a count
 * governs a noun — "1 lot", not "1 lots" — while Thai marks no plural and keeps
 * the bare form, so the two catalogues write the *same argument* differently.
 * Matching only `{name}` would read the English side as interpolating nothing
 * and report every pluralized message as a mismatch.
 *
 * The `#` inside a plural branch is not an argument: it is the count itself, and
 * `{# lot}` is not a placeholder — which is why the name must start with a word
 * character.
 */
const placeholdersOf = (value: string): string[] =>
  [...value.matchAll(/\{\s*(\w+)\s*[,}]/g)]
    .map((match) => match[1] ?? "")
    .sort();

describe("message catalogues", () => {
  it("has a Thai message for every English one", () => {
    // The direction that matters most: English is where a key is usually added.
    const missing = pathsOf(en).filter((path) => valueAt(th, path) === "");
    expect(missing).toEqual([]);
  });

  it("has an English message for every Thai one", () => {
    const missing = pathsOf(th).filter((path) => valueAt(en, path) === "");
    expect(missing).toEqual([]);
  });

  it("interpolates the same names in both languages", () => {
    /*
     * A Thai message that dropped `{when}` renders a sentence with a hole in it,
     * and one that invented `{date}` renders the placeholder literally. Both look
     * like data problems to whoever meets them.
     */
    const mismatched = pathsOf(en).filter((path) => {
      const english = placeholdersOf(valueAt(en, path));
      const thai = placeholdersOf(valueAt(th, path));
      return english.join(",") !== thai.join(",");
    });

    expect(mismatched).toEqual([]);
  });

  it("does not leave English text sitting in the Thai catalogue", () => {
    /*
     * An identical value means the key was copied rather than translated. Code
     * identifiers and short symbols are legitimately identical, so the check is
     * on values that contain Latin words and no Thai at all.
     */
    const untranslated = pathsOf(en).filter((path) => {
      if (IDENTICAL_BY_DESIGN.has(path)) return false;
      const english = valueAt(en, path);
      const thai = valueAt(th, path);
      if (english !== thai) return false;
      // A pure code, a number, or a symbol is the same string in both.
      if (!/[A-Za-z]{4,}/.test(english)) return false;
      return !/[฀-๿]/.test(thai);
    });

    expect(untranslated).toEqual([]);
  });

  it("keeps every Thai message actually in Thai script", () => {
    // A namespace that is entirely English would pass the copy check above by
    // being reworded rather than translated.
    const namespaces = Object.keys(en);
    const englishOnly = namespaces.filter((namespace) => {
      const prose = pathsOf(th)
        .filter((path) => path.startsWith(`${namespace}.`))
        .filter((path) => !IDENTICAL_BY_DESIGN.has(path))
        .map((path) => valueAt(th, path))
        .filter((value) => /[A-Za-z]{4,}/.test(value));
      return prose.length > 0 && prose.every((value) => !/[฀-๿]/.test(value));
    });

    expect(englishOnly).toEqual([]);
  });
});
