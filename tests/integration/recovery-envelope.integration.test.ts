import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ENVELOPE_VERSION,
  KEY_BYTES,
  openExport,
  parseRecords,
  sealExport,
  serializeRecords,
} from "../../scripts/lib/exportEnvelope.mjs";

const key = () => randomBytes(KEY_BYTES);

const records = [
  { table: "items", sku: "BOLT-M8-30", name: "สลักเกลียว M8 x 30 มม." },
  { table: "items", sku: "STEEL-COIL", name: "เหล็กม้วนรีดร้อน" },
];

const seal = (secret: Buffer, rows = records) =>
  sealExport({
    records: rows,
    key: secret,
    createdAt: "1970-01-01T00:00:00.000Z",
    tenant: "org_test",
  });

describe("sealing and opening", () => {
  it("round-trips records unchanged, Thai included", () => {
    const secret = key();
    expect(openExport(seal(secret), secret)).toEqual(records);
  });

  it("carries no plaintext in the envelope", () => {
    const envelope = seal(key());
    const rendered = JSON.stringify(envelope);

    expect(rendered).not.toContain("BOLT-M8-30");
    expect(rendered).not.toContain("เหล็กม้วนรีดร้อน");
  });

  it("states its own format version", () => {
    expect(seal(key()).version).toBe(ENVELOPE_VERSION);
  });

  it("refuses a version it does not understand", () => {
    const secret = key();
    expect(() =>
      openExport({ ...seal(secret, records), version: 99 }, secret),
    ).toThrow("UNSUPPORTED_ENVELOPE_VERSION");
  });
});

describe("the refusals that make it a backup", () => {
  it("refuses the wrong key", () => {
    expect(() => openExport(seal(key()), key())).toThrow(
      "AUTHENTICATION_FAILED",
    );
  });

  it("refuses a tampered ciphertext", () => {
    const secret = key();
    const envelope = seal(secret);
    const bytes = Buffer.from(envelope.ciphertext, "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;

    expect(() =>
      openExport({ ...envelope, ciphertext: bytes.toString("base64") }, secret),
    ).toThrow("AUTHENTICATION_FAILED");
  });

  it("refuses an archive that restores short", () => {
    const secret = key();
    const envelope = seal(secret, records.slice(0, 1));

    expect(() => openExport({ ...envelope, recordCount: 2 }, secret)).toThrow(
      "RECORD_COUNT_MISMATCH",
    );
  });

  it("refuses a key of the wrong length rather than padding it", () => {
    expect(() => seal(randomBytes(16))).toThrow(/32 bytes/);
    expect(() => openExport(seal(key()), randomBytes(16))).toThrow(
      "INVALID_KEY_LENGTH",
    );
  });
});

describe("the serialization", () => {
  it("is newline-delimited, so a truncated file is obviously short", () => {
    expect(serializeRecords(records).split("\n")).toHaveLength(2);
  });

  it("round-trips an empty export without inventing a record", () => {
    expect(parseRecords(serializeRecords([]))).toEqual([]);
  });
});
