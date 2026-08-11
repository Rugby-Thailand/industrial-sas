/**
 * The independent, encrypted export envelope, and the restore that proves it
 * (`ADR-0021`, plan §10 Phase 4, `RG-006`).
 *
 * "We have backups" is a claim nobody can act on. Three things make it one that
 * can be:
 *
 * 1. **Independent of the vendor.** The archive is a self-describing file, not a
 *    console button. A tenant leaving, a provider outage, and a legal hold all
 *    need an artifact somebody else can read; a snapshot only the platform can
 *    restore is a bet on the platform still being there.
 * 2. **Encrypted at rest, with the key elsewhere.** AES-256-GCM, key supplied by
 *    the operator at run time and never written by this module. An unencrypted
 *    warehouse export is a PDPA incident waiting for a misplaced laptop.
 * 3. **Verified by restoring it.** The envelope carries a SHA-256 of the
 *    plaintext and the record count, and `openExport` recomputes both. GCM
 *    already authenticates the ciphertext; the digest is what catches a *correct
 *    decryption of the wrong data* — a truncated dump, a half-written file, an
 *    envelope rebuilt around stale contents.
 *
 * The failure mode this exists to prevent is the one every backup story has: an
 * archive that restores to *something*, and nobody noticing it was not
 * everything.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** AES-256-GCM: 32-byte key, 12-byte nonce, 16-byte tag. */
export const KEY_BYTES = 32;
const IV_BYTES = 12;

/** The envelope format, so a reader can refuse one it does not understand. */
export const ENVELOPE_VERSION = 1;

const digestOf = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Serialize records as newline-delimited JSON.
 *
 * NDJSON rather than one array, because a restore streams and a truncated array
 * is unparseable while a truncated NDJSON file is *obviously* short — which,
 * with the record count in the envelope, is the difference between a detectable
 * loss and a silent one.
 */
export function serializeRecords(records) {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

export function parseRecords(text) {
  return text === "" ? [] : text.split("\n").map((line) => JSON.parse(line));
}

/**
 * Seal an export.
 *
 * The envelope is plain JSON with base64 fields, so it survives a text channel
 * and can be inspected without this code. Nothing in it is secret except the
 * ciphertext: the digest is of the plaintext and is what makes tampering with
 * the *envelope* detectable too, since GCM covers only the ciphertext.
 */
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

/**
 * Open an export, refusing anything it cannot fully account for.
 *
 * Every refusal is a distinct code rather than one "restore failed", because the
 * operator's next action differs: a wrong key is a key-management problem, a
 * failed tag is a corrupt or tampered file, and a count mismatch means the
 * archive is genuinely short — the one case where the backup existed and was
 * still not a backup.
 */
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
    // GCM rejected it: a wrong key and a modified ciphertext are the same
    // answer here, and both mean "do not trust this file".
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
