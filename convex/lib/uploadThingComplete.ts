import {
  httpActionGeneric,
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";

type CompleteArgs = {
  readonly scope: "MASTER_CARD" | "OPERATOR_TASK" | "TRANSPORT";
  readonly grantId: string;
  readonly providerKey: string;
  readonly uploaderClerkUserId: string;
  readonly contentDigest: string;
  readonly contentType: string;
  readonly byteSize: number;
};

const completeMasterCardGrant = makeFunctionReference<
  "mutation",
  Omit<CompleteArgs, "scope">,
  boolean
>(
  "engineering/files:completeUploadThingMasterCardUploadGrant",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  Omit<CompleteArgs, "scope">,
  boolean
>;

const completeOperatorTaskGrant = makeFunctionReference<
  "mutation",
  Omit<CompleteArgs, "scope">,
  boolean
>(
  "lib/taskFileComplete:completeUploadThingTaskUploadGrant",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  Omit<CompleteArgs, "scope">,
  boolean
>;

const completeTransportGrant = makeFunctionReference<
  "mutation",
  Omit<CompleteArgs, "scope">,
  boolean
>(
  "lib/transportFileComplete:completeUploadThingTransportFileGrant",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  Omit<CompleteArgs, "scope">,
  boolean
>;

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const verifiedSignature = async (
  body: string,
  supplied: string | null,
): Promise<boolean> => {
  const secret = process.env.UPLOADTHING_TOKEN;
  if (secret === undefined || secret.length === 0 || supplied === null) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  if (expected.length !== supplied.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
};

const isCompleteArgs = (value: unknown): value is CompleteArgs => {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<CompleteArgs>;
  return (
    (candidate.scope === "MASTER_CARD" ||
      candidate.scope === "OPERATOR_TASK" ||
      candidate.scope === "TRANSPORT") &&
    typeof candidate.grantId === "string" &&
    typeof candidate.providerKey === "string" &&
    typeof candidate.uploaderClerkUserId === "string" &&
    typeof candidate.contentDigest === "string" &&
    typeof candidate.contentType === "string" &&
    typeof candidate.byteSize === "number"
  );
};

export const completeUploadThingFile = httpActionGeneric(
  async (ctx, request) => {
    const body = await request.text();
    if (
      !(await verifiedSignature(
        body,
        request.headers.get("x-industrial-file-signature"),
      ))
    ) {
      return new Response("Unauthorized", { status: 401 });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return new Response("Invalid payload", { status: 400 });
    }
    if (!isCompleteArgs(parsed)) {
      return new Response("Invalid payload", { status: 400 });
    }
    const { scope, ...completion } = parsed;
    const completed = await ctx.runMutation(
      scope === "OPERATOR_TASK"
        ? completeOperatorTaskGrant
        : scope === "TRANSPORT"
          ? completeTransportGrant
          : completeMasterCardGrant,
      completion,
    );
    return new Response(completed ? null : "Grant unavailable", {
      status: completed ? 204 : 409,
      headers: { "Cache-Control": "private, no-store" },
    });
  },
);
