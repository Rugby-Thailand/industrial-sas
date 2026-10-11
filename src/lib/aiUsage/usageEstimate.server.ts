import { unstable_cache } from "next/cache";

import { createEstimateLoader, type PersistentCache } from "./estimateLoader";

/**
 * Server-only: the AI usage estimate snapshot backed by the Next.js data
 * cache (`unstable_cache`, persisted across requests and deployments on the
 * hosting platform). Import it from Server Components only; it fetches public
 * upstream data and carries no credentials or tenant data.
 */
export const loadUsageEstimate = createEstimateLoader({
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  cache: unstable_cache as unknown as PersistentCache,
});
