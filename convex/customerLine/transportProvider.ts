import { LIMITS } from "./policy";
import {
  boundedProviderId,
  boundedText,
  isLineGroupId,
  isLineUserId,
  isRetryKey,
  jsonRecord,
  parseJson,
  readBoundedBody,
} from "./transportInput";

const lineOrigin = "https://api.line.me";
const requestTimeoutMs = 5_000;
const summaryTimeoutMs = 1_500;
const maxProviderJsonBytes = 16 * 1024;

type BotInfo = {
  botUserId: string;
  basicId: string;
  name: string;
};

export type LineSendResult =
  | { state: "accepted"; acceptedRequestId?: string }
  | { state: "failed" | "unknown" };

type GroupMessage = {
  to: string;
  text: string;
  retryKey: string;
};

async function providerRequest<T>(
  path: string,
  token: string,
  options: RequestInit,
  read: (response: Response) => Promise<T> | T,
  timeoutMs = requestTimeoutMs,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers(options.headers);
    headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(`${lineOrigin}${path}`, {
      ...options,
      headers,
      redirect: "error",
      signal: controller.signal,
    });
    try {
      return await read(response);
    } finally {
      if (response.body && !response.bodyUsed) {
        await response.body.cancel().catch(() => undefined);
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

async function readProviderJson(response: Response) {
  if (!response.ok) return null;
  const body = await readBoundedBody(response, maxProviderJsonBytes);
  return body === null ? null : jsonRecord(parseJson(body));
}

export async function getLineBotInfo(token: string): Promise<BotInfo | null> {
  return providerRequest("/v2/bot/info", token, {}, async (response) => {
    const info = await readProviderJson(response);
    if (!isLineUserId(info?.userId)) return null;
    const basicId = boundedText(info.basicId, 128);
    const name = boundedText(info.displayName, 200);
    return basicId && name ? { botUserId: info.userId, basicId, name } : null;
  });
}

export async function getLineGroupName(
  token: string,
  groupId: string,
): Promise<string | undefined> {
  if (!isLineGroupId(groupId)) return undefined;
  return providerRequest(
    `/v2/bot/group/${groupId}/summary`,
    token,
    {},
    async (response) => {
      const info = await readProviderJson(response);
      return info?.groupId === groupId
        ? boundedText(info.groupName, LIMITS.groupName)
        : undefined;
    },
    summaryTimeoutMs,
  );
}

export async function pushLineGroupMessage(
  token: string,
  { to, text, retryKey }: GroupMessage,
): Promise<LineSendResult> {
  if (
    !isLineGroupId(to) ||
    !isRetryKey(retryKey) ||
    !boundedText(text, LIMITS.replyText)
  ) {
    return { state: "failed" };
  }
  try {
    return await providerRequest<LineSendResult>(
      "/v2/bot/message/push",
      token,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-line-retry-key": retryKey,
        },
        body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
      },
      (response) => {
        if (response.ok || response.status === 409) {
          const acceptedRequestId = boundedProviderId(
            response.headers.get(
              response.ok ? "x-line-request-id" : "x-line-accepted-request-id",
            ),
          );
          if (acceptedRequestId)
            return { state: "accepted", acceptedRequestId };
          if (response.ok) return { state: "accepted" };
          return { state: "unknown" };
        }
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 408
        ) {
          return { state: "failed" };
        }
        return { state: "unknown" };
      },
    );
  } catch {
    // Network errors and timeouts can occur after LINE accepted the request.
    return { state: "unknown" };
  }
}

export async function deliverLineReply(
  token: string,
  message: GroupMessage,
  authorize: () => Promise<boolean>,
): Promise<LineSendResult | null> {
  if (!(await authorize())) return null;
  const result = await pushLineGroupMessage(token, message);
  if (result.state !== "unknown" || !(await authorize())) return result;
  // A short retry stays within LINE's retry window. A later definite rejection
  // cannot establish what happened to the first, ambiguous request.
  const retry = await pushLineGroupMessage(token, message);
  return retry.state === "accepted" ? retry : result;
}
