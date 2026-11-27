export const LINE_MAX_WEBHOOK_BYTES = 512 * 1024;

export const isLineGroupId = (value: unknown): value is string =>
  typeof value === "string" && /^C[A-Fa-f0-9]{32}$/.test(value);

export const isLineUserId = (value: unknown): value is string =>
  typeof value === "string" && /^U[A-Fa-f0-9]{32}$/.test(value);

export const isRetryKey = (value: string): boolean =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

export const isLocalId = (value: string): boolean =>
  /^[a-z0-9]{1,128}$/i.test(value);

export function jsonRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function boundedText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string" || value.length > limit) return undefined;
  return value.trim() || undefined;
}

export function boundedProviderId(
  value: unknown,
  maxLength = 128,
): string | undefined {
  return typeof value === "string" &&
    value.length <= maxLength &&
    /^[a-z0-9_-]+$/i.test(value)
    ? value
    : undefined;
}

export async function readBoundedBody(
  source: Request | Response,
  maximumBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const length = source.headers.get("content-length");
  if (length !== null && Number(length) > maximumBytes) return null;
  if (source.body === null) return new Uint8Array();
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  } finally {
    reader.releaseLock();
  }
}

export function parseJson(body: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}
