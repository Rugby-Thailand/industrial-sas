import type { ObservedResponse } from "./release-network-diagnostics";

interface ConsoleError {
  text(): string;
  location?(): { url: string };
}
type TokenEndpoint = "session" | "convex";

/** Match only a token request for the exact session this test revokes. */
export class SessionRevocation {
  private sessionId: string | undefined;
  private confirmed = false;
  private readonly unauthorized = new Map<TokenEndpoint, number>();
  private readonly consoleErrors = new Map<TokenEndpoint, number>();

  constructor(private readonly clerkOrigin: string | undefined) {}

  begin(sessionId: string) {
    if (
      this.sessionId ||
      !this.clerkOrigin ||
      !/^sess_[A-Za-z0-9_-]+$/.test(sessionId)
    )
      throw new Error("STAGING_SIGNOUT_ACTIVE_SESSION_UNCONFIRMED");
    this.sessionId = sessionId;
  }

  confirm() {
    if (!this.sessionId) throw new Error("STAGING_SIGNOUT_SESSION_UNCONFIRMED");
    this.confirmed = true;
  }

  private tokenEndpoint(value: string): TokenEndpoint | undefined {
    if (!this.sessionId) return undefined;
    try {
      const url = new URL(value);
      const prefix = `/v1/client/sessions/${this.sessionId}/tokens`;
      if (
        url.origin !== this.clerkOrigin ||
        url.username ||
        url.password ||
        !(url.pathname === prefix || url.pathname === `${prefix}/convex`)
      )
        return undefined;
      return url.pathname === prefix ? "session" : "convex";
    } catch {
      return undefined;
    }
  }

  response(response: ObservedResponse) {
    if (!this.sessionId) return;
    try {
      if (
        response.status() !== 401 ||
        !["fetch", "xhr"].includes(response.request().resourceType())
      )
        return;
      const endpoint = this.tokenEndpoint(response.url());
      if (endpoint)
        this.unauthorized.set(
          endpoint,
          (this.unauthorized.get(endpoint) ?? 0) + 1,
        );
    } catch {
      // Unreadable metadata never authorizes an exception.
    }
  }

  console(message: ConsoleError) {
    if (!this.sessionId) return;
    try {
      if (
        !/^Failed to load resource: the server responded with a status of 401(?:\s|$)/.test(
          message.text(),
        )
      )
        return;
      const endpoint = this.tokenEndpoint(message.location?.().url ?? "");
      if (endpoint)
        this.consoleErrors.set(
          endpoint,
          (this.consoleErrors.get(endpoint) ?? 0) + 1,
        );
    } catch {
      // Unreadable metadata never authorizes an exception.
    }
  }

  expectedConsoleErrors() {
    if (!this.confirmed) return 0;
    return [...this.consoleErrors].reduce(
      (count, [endpoint, errors]) =>
        count + Math.min(this.unauthorized.get(endpoint) ?? 0, errors),
      0,
    );
  }

  dispose() {
    // Only the active session ID is held temporarily. The maps retain fixed
    // endpoint categories, never URLs, paths, queries, tokens or responses.
    this.sessionId = undefined;
    this.confirmed = false;
    this.unauthorized.clear();
    this.consoleErrors.clear();
  }
}
