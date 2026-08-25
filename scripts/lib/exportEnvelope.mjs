import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const KEY_BYTES = 32;
const IV_BYTES = 12;

export const ENVELOPE_VERSION = 1;

const digestOf = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");

export function serializeRecords(records) {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

export function parseRecords(text) {
  return text === "" ? [] : text.split("\n").map((line) => JSON.parse(line));
}

export function sealExport({ records, key, createdAt, tenant }) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new Error(`The export key must be ${KEY_BYTES} bytes`);
  }

  const plaintext = serializeRecords(records);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    version: ENVELOPE_VERSION,
    tenant,
    createdAt,
    recordCount: records.length,
    checksum: digestOf(plaintext),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function openExport(envelope, key) {
  if (envelope?.version !== ENVELOPE_VERSION) {
    throw new Error("UNSUPPORTED_ENVELOPE_VERSION");
  }
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new Error("INVALID_KEY_LENGTH");
  }

  let plaintext;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("AUTHENTICATION_FAILED");
  }

  const actual = Buffer.from(digestOf(plaintext), "hex");
  const expected = Buffer.from(String(envelope.checksum), "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("CHECKSUM_MISMATCH");
  }

  const records = parseRecords(plaintext);
  if (records.length !== envelope.recordCount) {
    throw new Error("RECORD_COUNT_MISMATCH");
  }

  return records;
}
