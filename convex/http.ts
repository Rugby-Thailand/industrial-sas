import { httpRouter } from "convex/server";

import { clerkWebhook } from "./lib/clerkWebhook";
import { privateMasterCardFileDownload } from "./lib/privateFileDownload";
import {
  privateMasterCardFileUpload,
  privateMasterCardFileUploadOptions,
} from "./lib/privateFileUpload";
import { completeUploadThingFile } from "./lib/uploadThingComplete";

const http = httpRouter();

http.route({ path: "/webhooks/clerk", method: "POST", handler: clerkWebhook });
http.route({
  path: "/private-master-card-file",
  method: "GET",
  handler: privateMasterCardFileDownload,
});
http.route({
  path: "/private-master-card-file-upload",
  method: "OPTIONS",
  handler: privateMasterCardFileUploadOptions,
});
http.route({
  path: "/internal/uploadthing/complete",
  method: "POST",
  handler: completeUploadThingFile,
});
http.route({
  path: "/private-master-card-file-upload",
  method: "POST",
  handler: privateMasterCardFileUpload,
});

export default http;
