import { httpRouter } from "convex/server";
import { WEBHOOK_PATH_PREFIX } from "./customerLine/policy";
import { lineWebhook } from "./customerLine/transportWebhook";
import { clerkWebhook } from "./lib/clerkWebhook";

const http = httpRouter();
http.route({ path: "/webhooks/clerk", method: "POST", handler: clerkWebhook });
http.route({
  pathPrefix: WEBHOOK_PATH_PREFIX,
  method: "POST",
  handler: lineWebhook,
});
export default http;
