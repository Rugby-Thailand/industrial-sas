/** Server-only receipt shared by the verified UploadThing callback and Convex.
 * Domain separation prevents a signed upload receipt being reused as anything else.
 * UPLOADTHING_TOKEN must name the SAME provider app on both runtimes.
 */
export interface UploadReceipt {
  assetId: string;
  fileKey: string;
  url: string;
  size: number;
  mimeType: string;
}
async function signingKey() {
  const token = process.env.UPLOADTHING_TOKEN;
  if (!token) throw new Error("Attachment integration unavailable");
  const parsed: unknown = JSON.parse(atob(token));
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("apiKey" in parsed) ||
    typeof parsed.apiKey !== "string"
  )
    throw new Error("Attachment integration unavailable");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(parsed.apiKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
function message(value: UploadReceipt) {
  return new TextEncoder().encode(
    JSON.stringify([
      "job-ticket-upload-v1",
      value.assetId,
      value.fileKey,
      value.url,
      value.size,
      value.mimeType,
    ]),
  );
}
export async function signUploadReceipt(value: UploadReceipt): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", await signingKey(), message(value)),
  );
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function verifyUploadReceipt(
  value: UploadReceipt,
  signature: string,
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  const bytes = Uint8Array.from(signature.match(/../g)!, (b) =>
    parseInt(b, 16),
  );
  return crypto.subtle.verify(
    "HMAC",
    await signingKey(),
    bytes,
    message(value),
  );
}
