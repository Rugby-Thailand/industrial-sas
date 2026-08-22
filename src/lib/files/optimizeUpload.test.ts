import { describe, expect, it, vi } from "vitest";

import {
  MAX_PHOTO_INPUT_BYTES,
  acceptedTypesFor,
  optimizeUpload,
  sha256File,
} from "./optimizeUpload";

const file = (contents: string, name: string, type: string) =>
  new File([contents], name, { type });

describe("private-file upload optimization", () => {
  it("hashes the exact final bytes with SHA-256", async () => {
    expect(await sha256File(file("abc", "proof.txt", "text/plain"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("does not transform engineering documents", async () => {
    const source = file("private dieline", "dieline.pdf", "application/pdf");
    const optimizer = vi.fn();
    const result = await optimizeUpload(source, "DIELINE", optimizer);

    expect(result.file).toBe(source);
    expect(result.optimized).toBe(false);
    expect(optimizer).not.toHaveBeenCalled();
  });

  it("uses a smaller photo and hashes the optimized bytes", async () => {
    const source = file(
      "a much larger original photo",
      "line-photo.png",
      "image/png",
    );
    const smaller = file("small", "line-photo.webp", "image/webp");
    const result = await optimizeUpload(source, "PHOTO", async () => smaller);

    expect(result.file).toBe(smaller);
    expect(result.optimized).toBe(true);
    expect(result.originalBytes).toBe(source.size);
    expect(result.contentDigest).toBe(await sha256File(smaller));
  });

  it("never replaces a source with a larger encoded candidate", async () => {
    const source = file("small", "photo.jpg", "image/jpeg");
    const larger = file(
      "a candidate that is larger",
      "photo.webp",
      "image/webp",
    );
    const result = await optimizeUpload(source, "PHOTO", async () => larger);

    expect(result.file).toBe(source);
    expect(result.optimized).toBe(false);
  });

  it("rejects an oversized photo before attempting to decode it", async () => {
    const source = file("x", "huge.jpg", "image/jpeg");
    Object.defineProperty(source, "size", { value: MAX_PHOTO_INPUT_BYTES + 1 });
    const optimizer = vi.fn();

    await expect(optimizeUpload(source, "PHOTO", optimizer)).rejects.toThrow(
      "FILE_TOO_LARGE",
    );
    expect(optimizer).not.toHaveBeenCalled();
  });

  it("limits photo selection to formats the browser optimizer supports", () => {
    expect(acceptedTypesFor("PHOTO")).toBe("image/jpeg,image/png,image/webp");
    expect(acceptedTypesFor("OTHER")).toBe("*");
  });
});
