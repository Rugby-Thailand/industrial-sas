/** Authenticate aggregate continuation values: unlike retained row IDs, totals
 * cannot be safely rehydrated without repeating the entire scan. */
async function hmac(payload: string, key: string) {
  const encoder = new TextEncoder();
  const imported = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const result = await crypto.subtle.sign(
    "HMAC",
    imported,
    encoder.encode(payload),
  );
  return Array.from(new Uint8Array(result), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function signCatalogueCursor(value: unknown, key: string) {
  const payload = JSON.stringify(value);
  if (payload.length > 90_000)
    throw new Error("CATALOGUE_FACET_CAPACITY_EXCEEDED");
  return JSON.stringify({ payload, signature: await hmac(payload, key) });
}
export async function verifyCatalogueCursor<T>(
  cursor: string,
  key: string,
): Promise<T | null> {
  if (cursor.length > 100_000) return null;
  try {
    const value = JSON.parse(cursor);
    if (
      !value ||
      typeof value.payload !== "string" ||
      typeof value.signature !== "string"
    )
      return null;
    if ((await hmac(value.payload, key)) !== value.signature) return null;
    return JSON.parse(value.payload) as T;
  } catch {
    return null;
  }
}
