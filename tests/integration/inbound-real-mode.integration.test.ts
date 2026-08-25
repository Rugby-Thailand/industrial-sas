import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const FEATURE_ROOT = join(process.cwd(), "src", "features", "inbound");

function featureFiles(): readonly string[] {
  return readdirSync(FEATURE_ROOT)
    .filter(
      (name) =>
        (name.endsWith(".tsx") || name.endsWith(".ts")) &&
        !name.includes(".test."),
    )
    .map((name) => join(FEATURE_ROOT, name));
}

interface SourceLine {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function linesOf(path: string): readonly SourceLine[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((text, index) => ({
      file: path.slice(process.cwd().length + 1),
      line: index + 1,
      text,
    }));
}

const allLines = (): readonly SourceLine[] =>
  featureFiles().flatMap((path) => linesOf(path));

describe("inbound screens in real mode", () => {
  it("has no preview identifier outside a preview-mode branch", () => {
    const offenders = allLines().filter((entry) => {
      if (!entry.text.includes("prv_")) return false;

      if (/preview[A-Z]\w*\(/.test(entry.text)) return false;

      if (/^\s*(\*|\/\/|\/\*)/.test(entry.text)) return false;
      return true;
    });

    expect(
      offenders.map(
        (entry) => `${entry.file}:${entry.line} ${entry.text.trim()}`,
      ),
    ).toEqual([]);
  });

  it("never hard-codes a location, order, or receipt identifier", () => {
    const offenders = allLines().filter((entry) =>
      /(locationId|purchaseOrderId|receiptId|handlingUnitId|putawayTaskId)\s*[:=]\s*"/.test(
        entry.text,
      ),
    );

    expect(
      offenders.map(
        (entry) => `${entry.file}:${entry.line} ${entry.text.trim()}`,
      ),
    ).toEqual([]);
  });

  it("never falls back to an empty option list outside preview", () => {
    /*
     * `previewMode ? previewLines() : []` is the shape that makes a screen look
     * finished and behave as a dead end. The select renders with nothing in it,
     * the form submits, the server refuses, and the operator is shown a refusal
     * about a field they were never able to fill.
     *
     * Matched across a two-line span because Prettier wraps these ternaries.
     */
    const text = featureFiles()
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    const offenders = [
      ...text.matchAll(/previewMode[\s\S]{0,120}?:\s*\[\]/g),
    ].map((match) => match[0].replace(/\s+/g, " "));

    expect(offenders).toEqual([]);
  });

  it("offers real receiving locations rather than assuming one dock", () => {
    const text = featureFiles()
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(text).toContain("<ReceivingLocations");
  });

  it("has no form field that asks an operator to type a document ID", () => {
    const offenders: string[] = [];

    for (const file of featureFiles()) {
      const lines = linesOf(file);
      lines.forEach((line, index) => {
        const named = /name:\s*"(\w*Id)"/.exec(line.text);
        if (named === null) return;

        const kind = lines
          .slice(index + 1, index + 4)
          .map((following) => following.text)
          .join(" ");
        if (!/kind:\s*"select"/.test(kind)) {
          offenders.push(`${line.file}:${line.line} ${named[1] ?? ""}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it("carries the receipt identifier out of the write that created it", () => {
    const handheld = readFileSync(
      join(FEATURE_ROOT, "HandheldReceive.tsx"),
      "utf8",
    );

    expect(handheld).toContain("onOpened=");
    expect(handheld).toContain("setReceiptId(opened)");
    expect(handheld).not.toContain("handheld-receipt-id");
  });
});
