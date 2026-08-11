/**
 * The real-mode guard for the inbound screens.
 *
 * Preview mode is easy to make convincing and easy to make *only* convincing. A
 * screen that hard-codes `prv_loc_DOCK-IN-1` renders beautifully against the
 * fixture and sends a synthetic identifier to a real mutation the moment a
 * tenant configures a deployment — where the server refuses it with
 * `REFERENCE_NOT_FOUND` and the operator has no way to tell why.
 *
 * So this file reads the feature source and asserts the structural property that
 * makes that impossible: **a `prv_` literal may only appear inside a
 * preview-mode branch**, and every identifier a mutation receives must come from
 * a server read or from the environment-gated fixture.
 *
 * A source-reading test is unusual and is the right tool here. The failure it
 * catches is invisible to a type checker — `"prv_loc_DOCK-IN-1"` is a perfectly
 * good `string` — and invisible to the preview end-to-end suite, because in
 * preview the value is correct. It only shows up on a configured deployment,
 * which is exactly where nothing can be tested locally.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const FEATURE_ROOT = join(process.cwd(), "src", "features", "inbound");

/**
 * The production feature source, excluding tests.
 *
 * A test may legitimately name a fixture identifier — that is what a fixture is
 * for. The rule under test is about what ships to a browser.
 */
function featureFiles(): readonly string[] {
  return readdirSync(FEATURE_ROOT)
    .filter(
      (name) =>
        (name.endsWith(".tsx") || name.endsWith(".ts")) &&
        !name.includes(".test."),
    )
    .map((name) => join(FEATURE_ROOT, name));
}

/** The line's own text, with its file and 1-indexed number for the message. */
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
    /*
     * The rule, stated as a rule rather than as a list of known offenders: a
     * `prv_` literal is legal only where the same line — or the fixture helper
     * it is passed to — is already reading preview data. Anything else is an
     * identifier that would reach a real mutation.
     */
    const offenders = allLines().filter((entry) => {
      if (!entry.text.includes("prv_")) return false;
      // A line that names a preview helper is reading the fixture on purpose.
      if (/preview[A-Z]\w*\(/.test(entry.text)) return false;
      // A comment may cite an example identifier.
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
    // The three that reach a mutation as a document ID. A literal here is a
    // reference the tenant does not have.
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
    /*
     * The capture form needs a *chosen* location. A screen that supplies one
     * has decided for the operator which dock the pallet came to — and a tenant
     * with two docks has no way to say otherwise.
     */
    const text = featureFiles()
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(text).toContain("<ReceivingLocations");
  });

  it("has no form field that asks an operator to type a document ID", () => {
    /*
     * The rule item by item: a field whose name ends `Id` carries a Convex
     * document ID, and nobody standing at a dock has one. Every such field must
     * be a `select` fed by a catalogue read — or, for the item on a carton, a
     * scan the server resolves. A `kind: "text"` beside an `Id` name is the
     * regression this catches, and it is one an operator would meet as
     * `REFERENCE_NOT_FOUND` on a field they filled in as instructed.
     */
    const offenders: string[] = [];

    for (const file of featureFiles()) {
      const lines = linesOf(file);
      lines.forEach((line, index) => {
        const named = /name:\s*"(\w*Id)"/.exec(line.text);
        if (named === null) return;
        // The `kind` sits within the next few lines of the same field literal.
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
    /*
     * A handheld that made the operator retype an ID the server had just minted
     * would be asking them to copy a Convex document ID off a screen, wearing
     * gloves. The open-receipt form hands it to the next step by name, and the
     * screen has no field for typing one.
     */
    const handheld = readFileSync(
      join(FEATURE_ROOT, "HandheldReceive.tsx"),
      "utf8",
    );

    expect(handheld).toContain("onOpened=");
    expect(handheld).toContain("setReceiptId(opened)");
    expect(handheld).not.toContain("handheld-receipt-id");
  });
});
