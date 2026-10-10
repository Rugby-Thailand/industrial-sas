import { expect, it } from "vitest";
import {
  parseLocationLabel,
  validLocationImage,
  MAX_LOCATION_IMAGE_DATA_URL,
} from "./locationImage";

it("keeps visible identity segments unchanged and deduplicates exact candidates", () => {
  expect(
    parseLocationLabel({
      candidates: [
        { code: " F1-L3-11 ", labelText: "คลังสินค้าสำเร็จรูป โซน 3" },
        { code: "F1-L3-11", labelText: null },
        { code: "FO-L3-I1", labelText: null },
      ],
    }),
  ).toEqual([
    { code: "F1-L3-11", labelText: "คลังสินค้าสำเร็จรูป โซน 3" },
    { code: "FO-L3-I1", labelText: null },
  ]);
  expect(parseLocationLabel({ candidates: [] })).toEqual([]);
});

it.each([
  null,
  [],
  {},
  { candidates: [], confidence: 1 },
  { candidates: [{ code: "F1-L3", confidence: 1, labelText: null }] },
  { candidates: [{ code: 123, labelText: null }] },
  { candidates: [{ code: " ", labelText: null }] },
  { candidates: [{ code: "F1\n-L3", labelText: null }] },
  { candidates: [{ code: "a".repeat(201), labelText: null }] },
  { candidates: [{ code: "F1-L3", labelText: "a".repeat(501) }] },
  { candidates: [{ code: "F1-L3" }] },
  {
    candidates: Array.from({ length: 6 }, () => ({
      code: "F1-L3",
      labelText: null,
    })),
  },
])("rejects malformed or unbounded model output %#", (raw) => {
  expect(() => parseLocationLabel(raw)).toThrow("AI_UNREADABLE");
});

it("accepts bounded inline photos and rejects remote URLs, malformed base64 and excess bytes", () => {
  expect(validLocationImage("data:image/jpeg;base64,YQ==")).toBe(true);
  expect(validLocationImage("data:image/webp;base64,YWJj")).toBe(true);
  for (const image of [
    "https://example.com/photo.png",
    "data:image/gif;base64,YWJj",
    "data:image/png;base64,",
    "data:image/png;base64,%%%%",
    "data:image/png;base64,a",
    "data:image/png;base64,a==a",
    "a".repeat(MAX_LOCATION_IMAGE_DATA_URL + 1),
  ])
    expect(validLocationImage(image)).toBe(false);
});
