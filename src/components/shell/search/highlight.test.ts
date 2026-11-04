import { describe, expect, it } from "vitest";

import { highlightParts } from "./highlight";

const marked = (title: string, query: string) =>
  highlightParts(title, query)
    .filter((part) => part.match)
    .map((part) => part.text);

describe("highlightParts", () => {
  it("marks a Thai name and keeps the rest of the title intact", () => {
    const parts = highlightParts("สมชาย ใจดี (Test account)", "สมชาย");
    expect(parts).toEqual([
      { text: "สมชาย", match: true },
      { text: " ใจดี (Test account)", match: false },
    ]);
    expect(parts.map((part) => part.text).join("")).toBe(
      "สมชาย ใจดี (Test account)",
    );
  });

  it("folds case, Thai digits, dashes and spacing as the matcher does", () => {
    expect(marked("Holidays", "holi")).toEqual(["Holi"]);
    expect(marked("EMP–๐๐๓ Somchai", "emp-003")).toEqual(["EMP–๐๐๓"]);
    expect(marked("Review  leave", "review leave")).toEqual(["Review  leave"]);
  });

  it("never splits a Thai vowel or tone mark from its consonant", () => {
    expect(marked("กี่วัน", "ก")).toEqual(["กี่"]);
    expect(marked("ผู้ใช้", "ผ")).toEqual(["ผู้"]);
    expect(marked("ทำงาน", "ท")).toEqual(["ทำ"]);
    // A query that starts on a mark widens back to its consonant.
    expect(marked("ลืมลงเวลา", "ื")).toEqual(["ลื"]);
  });

  it("falls back to the words of a longer query", () => {
    expect(marked("พนักงาน", "พนักงาน สมหญิง")).toEqual(["พนักงาน"]);
    expect(marked("Review leave", "leave review x")).toEqual([
      "Review",
      "leave",
    ]);
    expect(marked("Anan Wong", "ตรวจ EMP-DEMO-002 เมื่อวาน")).toEqual([]);
  });

  it("marks a name the query contains inside a longer phrase", () => {
    expect(marked("สินค้าสำเร็จรูป", "พาเลทของสินค้า DEMO-DRINK")).toEqual([
      "สินค้า",
    ]);
    expect(marked("สมชาย ใจดี", "แก้เวลาสมชาย เมื่อวาน")).toEqual(["สมชาย"]);
    expect(marked("Review leave", "reviewer")).toEqual(["Review"]);
    // Too short to mean anything.
    expect(marked("Today", "xto")).toEqual([]);
  });

  it("returns the plain title for an empty query", () => {
    expect(highlightParts("Today", "  ")).toEqual([
      { text: "Today", match: false },
    ]);
  });
});
