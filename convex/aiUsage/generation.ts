import { decodeProviderUsage } from "../lib/providerUsage";
import type { ProviderUsage } from "../model/aiUsage/usage";

export const GENERATION_LOOKUP_TIMEOUT_MS = 10_000;

export type GenerationLookup =
  | { readonly kind: "REPORTED"; readonly usage: ProviderUsage }
  | { readonly kind: "UNCONFIGURED" }
  | { readonly kind: "UNAVAILABLE"; readonly httpStatus?: number };

/**
 * Read the provider's generation metadata for one known generation ID: a
 * bounded metadata GET that can never replay the billable inference. Only a
 * reported cost for the same ID is returned; nothing from the response is
 * logged and the call never throws.
 */
export async function lookupGeneration(
  providerGenerationId: string,
): Promise<GenerationLookup> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return { kind: "UNCONFIGURED" };
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), GENERATION_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(providerGenerationId)}`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      },
    );
    if (!response.ok)
      return { kind: "UNAVAILABLE", httpStatus: response.status };
    const decoded = decodeProviderUsage(
      await response.json(),
      "GENERATION_LOOKUP",
    );
    return decoded.ok &&
      decoded.value.billingStatus === "REPORTED" &&
      decoded.value.providerGenerationId === providerGenerationId
      ? { kind: "REPORTED", usage: decoded.value }
      : { kind: "UNAVAILABLE" };
  } catch {
    return { kind: "UNAVAILABLE" };
  } finally {
    clearTimeout(timer);
  }
}
