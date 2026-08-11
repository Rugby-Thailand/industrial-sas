/**
 * Unit tier — CSV rendering, and the two ways an export hurts somebody.
 *
 * A shifted column is read as a wrong number rather than as corruption, and a
 * formula-prefixed field is code running on a supervisor's laptop. Both are
 * quiet failures, which is why they are tested here rather than noticed later.
 */
import { describe, expect, it } from "vitest";

import {
  CSV_BOM,
  CSV_LINE_ENDING,
  csvField,
  csvHeader,
  csvRow,
  csvRows,
  fitsWithin,
  utf8Bytes,
} from "./csv";

describe("csvField", () => {
  it("leaves an ordinary value alone", () => {
    expect(csvField("BOLT-M8-30")).toBe("BOLT-M8-30");
  });

  it("quotes a comma, so later columns do not shift", () => {
    expect(csvField("สยามสตีล, จำกัด")).toBe('"สยามสตีล, จำกัด"');
  });

  it("doubles an embedded quote", () => {
    expect(csvField('say "hello"')).toBe('"say ""hello"""');
  });

  it("quotes a newline rather than ending the record early", () => {
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("defuses a formula without losing the value", () => {
    /*
     * `=cmd|…` in an item code is code that runs when a supervisor opens the
     * file. The leading quote is what every spreadsheet reads as "text"; strip
     * it and the original is still there, so the export stays evidence.
     */
    for (const dangerous of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) {
      const rendered = csvField(dangerous);
      const unwrapped = rendered.startsWith('"')
        ? rendered.slice(1, -1).replaceAll('""', '"')
        : rendered;
      expect(unwrapped.startsWith("'")).toBe(true);
      expect(unwrapped.slice(1)).toBe(dangerous);
    }
  });
});

describe("rows and header", () => {
  it("joins a record with commas and terminates with CRLF", () => {
    expect(csvRow(["a", "b"])).toBe("a,b");
    expect(csvRows([["a", "b"]])).toBe(`a,b${CSV_LINE_ENDING}`);
  });

  it("emits the BOM exactly once, on the header", () => {
    // Without it Excel decodes Thai as Windows-874; with it on every chunk, the
    // marker appears mid-file as data.
    const header = csvHeader(["รหัส", "จำนวน"]);
    expect(header.startsWith(CSV_BOM)).toBe(true);
    expect(csvRows([["a"]]).includes(CSV_BOM)).toBe(false);
  });
});

describe("size accounting", () => {
  it("measures bytes, not characters, because Thai is three per character", () => {
    expect("ก".length).toBe(1);
    expect(utf8Bytes("ก")).toBe(3);
  });

  it("asks whether the next chunk fits before appending it", () => {
    expect(fitsWithin(90, 10, 100)).toBe(true);
    expect(fitsWithin(90, 11, 100)).toBe(false);
  });
});
