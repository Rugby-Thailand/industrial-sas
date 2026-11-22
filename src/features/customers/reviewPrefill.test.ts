// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
  clearReviewPrefillName,
  readReviewPrefillName,
  reviewPrefillScope,
  saveReviewPrefillName,
} from "./reviewPrefill";

it("keeps a captured review name private to its tab, organization and member until the form disposes it", () => {
  const scope = reviewPrefillScope("reviewer", "organization");
  const token = saveReviewPrefillName("  Example customer  ", scope);
  expect(token).toBeTruthy();
  expect(token).not.toContain("Example");
  expect(
    readReviewPrefillName(token!, reviewPrefillScope("reviewer", "another")),
  ).toBeUndefined();
  expect(
    readReviewPrefillName(
      token!,
      reviewPrefillScope("another", "organization"),
    ),
  ).toBeUndefined();
  expect(readReviewPrefillName(token!, scope)).toBe("Example customer");
  clearReviewPrefillName(token!, scope);
  expect(readReviewPrefillName(token!, scope)).toBeUndefined();
  expect(
    saveReviewPrefillName("Other", reviewPrefillScope(null, null)),
  ).toBeNull();
});
