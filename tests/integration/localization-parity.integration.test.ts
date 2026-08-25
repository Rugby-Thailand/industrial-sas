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

const IDENTICAL_BY_DESIGN = new Set(["App.name", "App.documentTitle"]);

const placeholdersOf = (value: string): string[] =>
  [...value.matchAll(/\{\s*(\w+)\s*[,}]/g)]
    .map((match) => match[1] ?? "")
    .sort();

describe("message catalogues", () => {
  it("has a Thai message for every English one", () => {
    const missing = pathsOf(en).filter((path) => valueAt(th, path) === "");
    expect(missing).toEqual([]);
  });

  it("has an English message for every Thai one", () => {
    const missing = pathsOf(th).filter((path) => valueAt(en, path) === "");
    expect(missing).toEqual([]);
  });

  it("interpolates the same names in both languages", () => {
    const mismatched = pathsOf(en).filter((path) => {
      const english = placeholdersOf(valueAt(en, path));
      const thai = placeholdersOf(valueAt(th, path));
      return english.join(",") !== thai.join(",");
    });

    expect(mismatched).toEqual([]);
  });

  it("does not leave English text sitting in the Thai catalogue", () => {
    const untranslated = pathsOf(en).filter((path) => {
      if (IDENTICAL_BY_DESIGN.has(path)) return false;
      const english = valueAt(en, path);
      const thai = valueAt(th, path);
      if (english !== thai) return false;

      if (!/[A-Za-z]{4,}/.test(english)) return false;
      return !/[฀-๿]/.test(thai);
    });

    expect(untranslated).toEqual([]);
  });

  it("keeps every Thai message actually in Thai script", () => {
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
