import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
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
