import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { Elysia } from "elysia";

import type { hrRefs } from "@/lib/convex/hrApi";

import {
  searchDenied,
  searchHttpError,
  searchRequest,
  searchResponse,
} from "./searchContract";

export type SearchRequest = FunctionArgs<typeof hrRefs.interpretSearch>;
export type SearchOutcome = FunctionReturnType<typeof hrRefs.interpretSearch>;

export interface AiDependencies {
  readonly authenticate: (request: Request) => Promise<string | null>;
  readonly interpret: (
    args: SearchRequest,
    token: string,
  ) => Promise<SearchOutcome>;
}

/** HTTP handling only. Convex owns authorization, quotas, grounding and provider calls. */
export function createAiApp(dependencies: AiDependencies) {
  return new Elysia({ prefix: "/api/ai" })
    .onRequest(({ set }) => {
      set.headers["cache-control"] = "no-store";
    })
    .onError(({ code, error, status }) => {
      // Elysia's default validation errors can include the submitted query.
      if (
        code === "PARSE" ||
        (code === "VALIDATION" && error.type !== "response")
      )
        return status(422, { code: "QUERY_INVALID" as const });
      return status(code === "NOT_FOUND" ? 404 : 500, {
        code: "FAILED" as const,
      });
    })
    .post(
      "/search",
      async ({ body, request, set, status }) => {
        const started = performance.now();
        const token = await dependencies.authenticate(request);
        const authenticated = performance.now();
        set.headers["server-timing"] =
          `auth;dur=${(authenticated - started).toFixed(2)}`;
        if (token === null) return status(401, { code: "DENIED" as const });
        try {
          const outcome = await dependencies.interpret(body, token);
          return outcome.ok ? outcome : status(403, outcome);
        } finally {
          // Durations only: never expose the token, query, tenant or provider text.
          set.headers["server-timing"] =
            `${set.headers["server-timing"]}, convex;dur=${(performance.now() - authenticated).toFixed(2)}`;
        }
      },
      {
        body: searchRequest,
        response: {
          200: searchResponse,
          401: searchHttpError,
          403: searchDenied,
          422: searchHttpError,
          500: searchHttpError,
        },
      },
    );
}

export type AiApp = ReturnType<typeof createAiApp>;
