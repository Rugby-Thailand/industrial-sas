/**
 * Screenshot facts, read from the committed PNGs.
 *
 * The generator this replaced carried a `width` and `height` per screen *beside*
 * the coordinates, and seven of the thirteen disagreed with the file on disk. An
 * SVG whose declared frame is shorter than its image does not crop: the default
 * `preserveAspectRatio` scales the whole screenshot down and centres it, so every
 * red rectangle on those seven pointed at nothing in particular. Dimensions are
 * therefore not authored any more — they are measured here, from the only artefact
 * that cannot be wrong about them.
 *
 * Reading them needs no image library. A PNG opens with an 8-byte signature and
 * then IHDR, whose first two fields are the width and height as big-endian
 * 32-bit integers; that is 24 bytes of a format frozen since 1996.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** `\x89PNG\r\n\x1a\n` — the signature every PNG starts with. */
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * The pixel size of one PNG.
 *
 * @param {string} file Absolute path to a `.png`.
 * @returns {{ width: number, height: number }}
 * @throws {Error} When the file is not a PNG or is truncated before IHDR.
 */
export function readPngSize(file) {
  const bytes = readFileSync(file);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${file} is not a PNG file`);
  }
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error(`${file} has no IHDR header where the format requires one`);
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Every screenshot in a directory, keyed by the image id a task references.
 *
 * @param {string} directory
 * @returns {Record<string, { width: number, height: number }>}
 */
export function collectImageSizes(directory) {
  /** @type {Record<string, { width: number, height: number }>} */
  const sizes = {};
  for (const entry of readdirSync(directory).sort()) {
    if (!entry.endsWith(".png")) continue;
    sizes[entry.slice(0, -".png".length)] = readPngSize(join(directory, entry));
  }
  return sizes;
}
