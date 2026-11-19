import { describe, expect, it } from "vitest";

import { mailtoHref, telHref } from "./contactLinks";

describe("telHref", () => {
  it.each([
    ["081-234-5678", "tel:0812345678"],
    ["02-123-4567 ต่อ 89", "tel:021234567"],
    ["02-123-4567 ext. 89", "tel:021234567"],
    ["PBX 02-123-4567 ext 89", "tel:021234567"],
    ["PBX +66 2 123 4567 ต่อ 89", "tel:+6621234567"],
    ["ติดต่อ 02-123-4567", "tel:021234567"],
    ["Call/text 081-234-5678", "tel:0812345678"],
    ["24h hotline: 02-123-4567", "tel:021234567"],
  ])("dials %s as %s", (phone, expected) => {
    expect(telHref(phone)).toBe(expected);
  });

  it.each(["PBX ext. 89", "ext. 1234567", "x1234567", "ask reception"])(
    "does not dial %s",
    (phone) => {
      expect(telHref(phone)).toBeUndefined();
    },
  );
});

describe("mailtoHref", () => {
  it("keeps a literal @ and encodes each side", () => {
    expect(mailtoHref("sales@example.org")).toBe("mailto:sales@example.org");
    expect(mailtoHref("sales+th@example.org")).toBe(
      "mailto:sales%2Bth@example.org",
    );
  });
});
