import { treaty } from "@elysiajs/eden";

import type { AiApp, SearchRequest } from "./app";

/** Only the app type is imported: server code and credentials never enter this bundle. */
export async function interpretAiSearch(
  args: SearchRequest,
  tokens: { readonly session: string; readonly convex: string },
) {
  const api = treaty<AiApp>(window.location.origin, { parseDate: false });
  const { data, error } = await api.api.ai.search.post(args, {
    headers: {
      authorization: `Bearer ${tokens.session}`,
      "x-convex-token": tokens.convex,
    },
    fetch: { credentials: "same-origin", cache: "no-store" },
  });
  if (error) {
    if (error.status === 401 || error.status === 403)
      return { ok: false as const };
    if (error.status === 422)
      return {
        ok: true as const,
        value: { ok: false as const, code: "QUERY_INVALID" as const },
      };
    throw new Error("AI search request failed.");
  }
  if (!data) throw new Error("AI search response missing.");
  return data;
}
