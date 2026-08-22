import { describe, expect, it } from "vitest";

import {
  LOCALLY_REACHABLE_STATUSES,
  MAX_PAYLOAD_LENGTH,
  canonicalTextFor,
  renderLabel,
  requiresReprintPermission,
  type LabelTemplateSource,
} from "./labelPayload";

const template = (
  overrides: Partial<LabelTemplateSource> = {},
): LabelTemplateSource => ({
  code: "LPN-4X6",
  version: 2,
  format: "ZPL",
  status: "ACTIVE",
  body: "^XA\n^FO50,50^FD{{SKU}}^FS\n^FO50,100^FD{{LOT}}^FS\n^XZ",
  ...overrides,
});

describe("renderLabel", () => {
  it("substitutes every placeholder and reports which it used", () => {
    const rendered = renderLabel({
      template: template(),
      fields: { SKU: "BOLT-M8-30", LOT: "L2601-A" },
    });

    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value.payload).toContain("^FDBOLT-M8-30^FS");
    expect(rendered.value.payload).toContain("^FDL2601-A^FS");
    expect(rendered.value.fieldsUsed).toEqual(["LOT", "SKU"]);
  });

  it("refuses a placeholder nobody filled", () => {
    /*
     * The rule the module exists for. A blank lot code looks exactly like a
     * correct one from two metres away on a forklift, so an unfilled placeholder
     * is an error rather than a gap.
     */
    const rendered = renderLabel({
      template: template(),
      fields: { SKU: "BOLT-M8-30" },
    });

    expect(!rendered.ok && rendered.error.code).toBe("MISSING_FIELD");
    expect(
      !rendered.ok && "field" in rendered.error && rendered.error.field,
    ).toBe("LOT");
  });

  it("renders only a published template", () => {
    // A draft has not been through the second person `INV-0006-05` requires, and
    // a retired version is kept so an old label can be traced — not so new ones
    // can be made from it.
    for (const status of ["DRAFT", "RETIRED"]) {
      const rendered = renderLabel({
        template: template({ status }),
        fields: { SKU: "A", LOT: "B" },
      });
      expect(!rendered.ok && rendered.error.code, status).toBe(
        "TEMPLATE_NOT_PUBLISHED",
      );
    }
  });

  it("refuses a value that could introduce another placeholder", () => {
    /*
     * A lot code of `{{PRICE}}` must not cause a second substitution pass to
     * interpolate something the template never asked for.
     */
    const rendered = renderLabel({
      template: template(),
      fields: { SKU: "A", LOT: "{{PRICE}}" },
    });

    expect(!rendered.ok && rendered.error.code).toBe("FIELD_VALUE_INVALID");
  });

  it("refuses a value carrying a control character", () => {
    // A control byte inside a value changes how a printer parses the stream.
    const rendered = renderLabel({
      template: template(),
      fields: { SKU: "A", LOT: "L1\u0007" },
    });
    expect(!rendered.ok && rendered.error.code).toBe("FIELD_VALUE_INVALID");
  });

  it("allows a tab, which a ZPL payload legitimately contains", () => {
    const rendered = renderLabel({
      template: template(),
      fields: { SKU: "A\tB", LOT: "L1" },
    });
    expect(rendered.ok).toBe(true);
  });

  it("refuses a field name that is not a code identifier", () => {
    // `D-06`: placeholder names are code identifiers and stay English.
    const rendered = renderLabel({
      template: template(),
      fields: { "lot code": "L1" },
    });
    expect(!rendered.ok && rendered.error.code).toBe("FIELD_NAME_INVALID");
  });

  it("refuses a template with a malformed placeholder", () => {
    // `{{LOT` is a mistyped template far more often than a printer command, and
    // printing it is a wasted label at best.
    const rendered = renderLabel({
      template: template({ body: "^XA {{LOT ^XZ" }),
      fields: { LOT: "L1" },
    });
    expect(!rendered.ok && rendered.error.code).toBe("PLACEHOLDER_MALFORMED");
  });

  it("refuses an empty template body", () => {
    const rendered = renderLabel({
      template: template({ body: "   " }),
      fields: {},
    });
    expect(!rendered.ok && rendered.error.code).toBe("TEMPLATE_EMPTY");
  });

  it("bounds the stored payload", () => {
    const rendered = renderLabel({
      template: template({ body: "{{SKU}}" }),
      fields: { SKU: "x".repeat(MAX_PAYLOAD_LENGTH + 1) },
    });
    expect(!rendered.ok && rendered.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("renders a template with no placeholders at all", () => {
    const rendered = renderLabel({
      template: template({ body: "^XA^FDSTATIC^FS^XZ" }),
      fields: {},
    });
    expect(rendered.ok && rendered.value.fieldsUsed).toEqual([]);
  });

  it("is deterministic for identical inputs", () => {
    const once = renderLabel({
      template: template(),
      fields: { SKU: "A", LOT: "B" },
    });
    const twice = renderLabel({
      template: template(),
      fields: { SKU: "A", LOT: "B" },
    });
    expect(once).toEqual(twice);
  });
});

describe("canonicalTextFor", () => {
  it("distinguishes two versions that rendered identical bytes", () => {
    /*
     * The reason the hash is not taken over the payload alone. Two template
     * versions can render byte-identical payloads when every substituted field
     * happens to match, and an evidence hash that could not tell them apart
     * would defeat the versioning it exists to prove (`INV-0007-07`).
     */
    const first = renderLabel({
      template: template({ version: 1 }),
      fields: { SKU: "A", LOT: "B" },
    });
    const second = renderLabel({
      template: template({ version: 2 }),
      fields: { SKU: "A", LOT: "B" },
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.payload).toBe(second.value.payload);
    expect(first.value.canonicalText).not.toBe(second.value.canonicalText);
  });

  it("names the template, version, and format ahead of the payload", () => {
    const text = canonicalTextFor({
      code: "LPN-4X6",
      version: 3,
      format: "ZPL",
      payload: "^XA^XZ",
    });

    expect(text.startsWith("template:LPN-4X6\nversion:3\nformat:ZPL\n")).toBe(
      true,
    );
  });
});

describe("print-job honesty", () => {
  it("has no status that claims a label was printed", () => {
    /*
     * Nothing in this repository can observe a printer (`INT-04` absent,
     * `RG-004` open), so a `PRINTED` status would be a claim no code here is in
     * a position to make.
     */
    expect(LOCALLY_REACHABLE_STATUSES).toEqual(["GENERATED"]);
    expect(LOCALLY_REACHABLE_STATUSES).not.toContain("PRINTED");
  });

  it("separates a reprint from a first print", () => {
    // Three labels for one pallet is either a jammed printer or a label being
    // applied to stock that moved, and the two must be tellable apart.
    expect(requiresReprintPermission("REPRINT")).toBe(true);
    expect(requiresReprintPermission("INITIAL")).toBe(false);
    expect(requiresReprintPermission("PREVIEW")).toBe(false);
  });
});
