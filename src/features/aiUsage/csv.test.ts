import { expect, it } from "vitest";
import { usageCsv } from "./csv";
it("exports Thai as UTF-8 with quoted multiline values and neutralized formulas", () => {
  const csv = usageCsv(
    ["name", "source"],
    [
      ["ผู้ใช้งาน", ' =HYPERLINK("evil")'],
      ["a\nb", "@SUM(1)"],
    ],
  );
  expect(csv.startsWith("\ufeff")).toBe(true);
  expect(csv).toContain('"ผู้ใช้งาน"');
  expect(csv).toContain('"\' =HYPERLINK(""evil"")"');
  expect(csv).toContain('"a\nb"');
  expect(csv).toContain('"\'@SUM(1)"');
});
