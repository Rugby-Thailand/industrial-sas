type SecretKind = "channel-secret" | "access-token";

const utf8 = new TextEncoder();
const ivLength = 12;

function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const decoded = atob(value);
    if (btoa(decoded) !== value) return null;
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function encodeBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

export function lineCredential(value: string, kind: SecretKind): string | null {
  const maxLength = kind === "channel-secret" ? 128 : 2_048;
  if (value.length > maxLength) return null;
  const trimmed = value.trim();
  return /^[!-~]+$/.test(trimmed) ? trimmed : null;
}

async function importSecretsKey(value: string | undefined): Promise<CryptoKey> {
  const bytes = value?.length === 44 ? decodeBase64(value) : null;
  if (!bytes || bytes.length !== 32) {
    throw new Error("LINE secret storage is unavailable.");
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function cipherParameters(iv: Uint8Array<ArrayBuffer>, kind: SecretKind) {
  return {
    name: "AES-GCM",
    iv,
    additionalData: utf8.encode(`customer-line:v1:${kind}`),
  };
}

export async function encryptLineCredential(
  credential: string,
  kind: SecretKind,
  envKey: string | undefined,
): Promise<string> {
  const key = await importSecretsKey(envKey);
  const iv = crypto.getRandomValues(new Uint8Array(ivLength));
  const encrypted = await crypto.subtle.encrypt(
    cipherParameters(iv, kind),
    key,
    utf8.encode(credential),
  );
  return `v1.${encodeBase64(iv)}.${encodeBase64(new Uint8Array(encrypted))}`;
}

export async function decryptLineCredential(
  ciphertext: string,
  kind: SecretKind,
  envKey: string | undefined,
): Promise<string> {
  if (ciphertext.length > 4_096) {
    throw new Error("Invalid encrypted LINE credential.");
  }
  const [version, encodedIv, encodedSecret, extra] = ciphertext.split(".");
  const iv = encodedIv && decodeBase64(encodedIv);
  const encrypted = encodedSecret && decodeBase64(encodedSecret);
  if (
    version !== "v1" ||
    extra !== undefined ||
    !iv ||
    iv.length !== ivLength ||
    !encrypted ||
    encrypted.length <= 16
  ) {
    throw new Error("Invalid encrypted LINE credential.");
  }
  const key = await importSecretsKey(envKey);
  const decrypted = await crypto.subtle.decrypt(
    cipherParameters(iv, kind),
    key,
    encrypted,
  );
  const value = new TextDecoder().decode(decrypted);
  if (lineCredential(value, kind) !== value) {
    throw new Error("Invalid LINE credential.");
  }
  return value;
}

export function lineSignature(
  header: string | null,
): Uint8Array<ArrayBuffer> | null {
  const bytes = header?.length === 44 ? decodeBase64(header) : null;
  return bytes?.length === 32 ? bytes : null;
}

export async function verifyLineSignature(
  body: Uint8Array<ArrayBuffer>,
  signature: Uint8Array<ArrayBuffer>,
  channelSecret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signature, body);
}
