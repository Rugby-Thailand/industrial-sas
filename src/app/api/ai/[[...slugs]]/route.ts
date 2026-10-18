import { fetchAction } from "convex/nextjs";

import { createAiApp } from "@/lib/ai/app";
import { authenticateAiRequest } from "@/lib/ai/authenticate";
import { hrRefs } from "@/lib/convex/hrApi";

export const runtime = "nodejs";

const app = createAiApp({
  authenticate: authenticateAiRequest,
  interpret: (args, token) =>
    fetchAction(hrRefs.interpretSearch, args, { token }),
});

export const POST = app.fetch;
