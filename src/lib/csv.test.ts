import { expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

it("exports Thai as UTF-8 with quoted multiline values and neutralized formulas", () => {
  const csv = toCsv(
    ["name", "source"],
    [
      ["ผู้ใช้งาน", ' =HYPERLINK("evil")'],
      ["a\nb", "@SUM(1)"],
    ],
  );
  expect(csv.startsWith("﻿")).toBe(true);
  expect(csv).toContain('"ผู้ใช้งาน"');
  expect(csv).toContain('"\' =HYPERLINK(""evil"")"');
  expect(csv).toContain('"a\nb"');
  expect(csv).toContain('"\'@SUM(1)"');
});

it.each([
  [" =1+1", `"' =1+1"`],
  ["=1+1", `"'=1+1"`],
  ["+1", `"'+1"`],
  ["-1", `"'-1"`],
  ["@SUM(A1)", `"'@SUM(A1)"`],
  ["\tvalue", `"'\tvalue"`],
  ["\rvalue", `"'\rvalue"`],
  ["\nvalue", `"'\nvalue"`],
  ["\t=1+1", `"'\t=1+1"`],
])("neutralizes the formula-like cell %j", (value, expected) => {
  expect(csvCell(value)).toBe(expected);
});

it("quotes ordinary values unchanged and renders missing values as empty", () => {
  expect(csvCell("a=b")).toBe('"a=b"');
  expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  expect(csvCell(42)).toBe('"42"');
  expect(csvCell(undefined)).toBe('""');
  expect(csvCell(null)).toBe('""');
});
