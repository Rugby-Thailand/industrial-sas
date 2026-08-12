/**
 * Integration tier — the native-select guard actually catches one.
 *
 * A guard that passes is indistinguishable from a guard that looks at nothing,
 * and this one is a regular expression away from being the second: `select`
 * appears in prose all over this repository, including in the comments
 * explaining why the native control was replaced. So the guard parses, and this
 * asserts both halves of what parsing buys — that a real `<select>` is found
 * wherever it hides, and that the words around it are not.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  collectNativeSelectViolations,
  NATIVE_SELECT_ALLOWLIST,
} from "../../scripts/verify-native-select.mjs";

const roots: string[] = [];

/** A throwaway repository root containing exactly the files given. */
const rootWith = (files: Readonly<Record<string, string>>): string => {
  const root = mkdtempSync(join(tmpdir(), "native-select-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return root;
};

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() ?? "", { recursive: true, force: true });
  }
});

describe("the native-select guard", () => {
  it("passes on source that uses the shared control", () => {
    const root = rootWith({
      "src/components/Thing.tsx": [
        "export function Thing() {",
        '  return <SelectControl value="" options={[]} />;',
        "}",
      ].join("\n"),
    });

    expect(collectNativeSelectViolations(root)).toEqual([]);
  });

  it("finds a native select however deeply it is nested", () => {
    const root = rootWith({
      "src/features/Thing.tsx": [
        "export function Thing() {",
        "  return (",
        "    <form>",
        "      <fieldset>",
        '        <select name="warehouse">',
        '          <option value="a">A</option>',
        "        </select>",
        "      </fieldset>",
        "    </form>",
        "  );",
        "}",
      ].join("\n"),
    });

    const violations = collectNativeSelectViolations(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe("src/features/Thing.tsx");
    expect(violations[0]?.line).toBe(5);
  });

  it("finds one created through createElement rather than JSX", () => {
    const root = rootWith({
      "src/features/Sneaky.tsx": [
        'import { createElement } from "react";',
        "",
        "export const Sneaky = () =>",
        '  createElement("select", { name: "warehouse" });',
      ].join("\n"),
    });

    expect(collectNativeSelectViolations(root)).toHaveLength(1);
  });

  it("does not flag the word in prose, or a capitalised component", () => {
    /*
     * The distinction the AST buys. `<Select>` is the shadcn primitive and is
     * exactly what this migration wants written; the paragraph above it is the
     * comment explaining why.
     */
    const root = rootWith({
      "src/components/Documented.tsx": [
        "/**",
        " * Not a native select. A `<select>` renders an operating-system menu,",
        ' * so `selectOption()` and "select the warehouse" appear only in prose.',
        " */",
        "export function Documented() {",
        "  return (",
        "    <Select>",
        "      <SelectTrigger />",
        "    </Select>",
        "  );",
        "}",
      ].join("\n"),
    });

    expect(collectNativeSelectViolations(root)).toEqual([]);
  });

  it("ignores test files, which may render one to prove something about it", () => {
    const root = rootWith({
      "src/components/Thing.test.tsx": "export const x = <select />;",
      "src/components/Thing.a11y.test.tsx": "export const y = <select />;",
    });

    expect(collectNativeSelectViolations(root)).toEqual([]);
  });

  it("grants no exceptions at all", () => {
    /*
     * The migration's definition of done allows a native select only with a
     * documented, tested, device-specific reason, and there is none. Asserting
     * the list is empty is what makes the next entry a decision somebody has to
     * defend in review rather than a line that slips in.
     */
    expect(NATIVE_SELECT_ALLOWLIST).toEqual([]);
  });

  it("finds nothing in this repository's own production source", () => {
    // The rule the migration's definition of done states: no native production
    // `<select>` remains.
    expect(collectNativeSelectViolations()).toEqual([]);
  });
});
