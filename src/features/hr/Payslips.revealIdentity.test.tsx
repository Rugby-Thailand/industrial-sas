import { getTestMutation } from "@tests/fixtures/convex-mutation";
import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  configuredEnvironment,
  renderWithIntl,
} from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  httpQuery: vi.fn(),
  httpMutation: vi.fn(),
  getToken: vi.fn(),
  auth: { sessionId: "session-a", isSignedIn: true },
  access: {
    status: "READY",
    permissions: ["hr.self.access"],
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    today: "2026-10-12",
    identityKey: "org:user",
    sites: [],
  },
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    state.query(getFunctionName(ref), args),
  useMutation: getTestMutation,
}));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    setAuth() {}
    clearAuth() {}
    query(ref: Parameters<typeof getFunctionName>[0], args: unknown) {
      return state.httpQuery(getFunctionName(ref), args);
    }
    mutation(ref: Parameters<typeof getFunctionName>[0], args: unknown) {
      return state.httpMutation(getFunctionName(ref), args);
    }
  },
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ ...state.auth, getToken: state.getToken }),
  useReverification:
    (fetcher: (...args: unknown[]) => Promise<unknown>) =>
    (...args: unknown[]) =>
      fetcher(...args),
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => state.access,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/hr/payslips",
}));
import { HrPayslipsScreen } from "./EmployeePayslipsScreen";

const envelope = (value: unknown) => ({ ok: true, value });
const row = {
  id: "statement",
  from: "2026-09-01",
  to: "2026-09-30",
  paymentDate: "2026-10-01",
  version: 1,
  publishedAt: 1,
  superseded: false,
};
const metadata = {
  ok: true,
  item: row,
  verificationMinutes: 5,
  policyVersionId: "policy-1",
  capabilityAvailable: true,
};
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  state.getToken.mockReset().mockResolvedValue("token");
  state.query
    .mockReset()
    .mockReturnValue(
      envelope({ ...metadata, items: [row], isDone: true, continueCursor: "" }),
    );
  state.httpQuery.mockReset().mockResolvedValue(envelope(metadata));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("reveal after a lost download response does not reuse the download request ID", async () => {
  state.httpMutation.mockReset().mockImplementation((name: string) => {
    // ConvexHttpClient is plain fetch: a dropped connection rejects.
    if (name === "hr/payslips:ticket")
      return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve(
      envelope({
        written: true,
        documentId: "statement",
        gross: 3000000,
        deductions: 150000,
        net: 2850000,
        expiresAt: Date.now() + 60_000,
        policyVersionId: "policy-1",
      }),
    );
  });
  renderWithIntl(<HrPayslipsScreen />, {
    locale: "en",
    environment: configuredEnvironment,
    workspace: false,
    preserveProviders: true,
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Verify and download PDF" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Verify and show amounts" }),
    ).toBeEnabled(),
  );
  const reveal = async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Verify and show amounts" }),
    );
    await screen.findByText(/30,000/);
    fireEvent.click(screen.getByRole("button", { name: "Hide amounts" }));
  };
  await reveal();
  await reveal();
  const ids = state.httpMutation.mock.calls.map(
    ([name, args]) => `${name}:${(args as { requestId: string }).requestId}`,
  );
  const ticketId = ids[0]!.split(":").at(-1);
  const revealIds = ids
    .filter((id) => id.startsWith("hr/payslips:detail:"))
    .map((id) => id.split(":").at(-1));
  // Each reveal is a separate audited command; none may borrow the ticket ID.
  expect(revealIds.filter((id) => id === ticketId).length).toBe(0);
  expect(new Set(revealIds).size).toBe(2);
  // Independent reveals must not consume the retained download retry identity.
  fireEvent.click(
    screen.getByRole("button", { name: "Verify and download PDF" }),
  );
  await waitFor(() => expect(state.httpMutation).toHaveBeenCalledTimes(4));
  const retry = state.httpMutation.mock.calls[3]!;
  expect(retry[0]).toBe("hr/payslips:ticket");
  expect(retry[1]).toEqual(state.httpMutation.mock.calls[0]![1]);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Verify and show amounts" }),
    ).toBeEnabled(),
  );
});
