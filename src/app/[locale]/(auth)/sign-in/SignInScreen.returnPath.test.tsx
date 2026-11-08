import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ returnHeader: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  // proxy.ts sets x-planner-return-path to pathname + search of the request.
  headers: async () =>
    new Headers({ "x-planner-return-path": request.returnHeader }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("next-intl/server", () => ({ setRequestLocale: () => undefined }));
vi.mock("@/lib/auth/appAccess", () => ({
  readAppAccess: async () => "SIGN_IN",
}));
vi.mock("@/components/auth/OrganizationRequired", () => ({
  OrganizationRequired: () => null,
}));
vi.mock("@/components/providers/WorkspaceAccessBoundary", () => ({
  WorkspaceAccessBoundary: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/shell/DesktopShell", () => ({
  DesktopShell: ({ children }: { children: ReactNode }) => children,
}));

import DesktopLayout from "../../(desktop)/layout";

async function signInRedirect(path: string): Promise<string> {
  request.returnHeader = path;
  try {
    await DesktopLayout({
      children: <p>Page</p>,
      params: Promise.resolve({ locale: "th" }),
    });
  } catch (error) {
    return (error as { url: string }).url;
  }
  throw new Error("layout did not redirect");
}

beforeEach(() => {
  request.returnHeader = "";
});

describe("sign-in return path for every signed-in desktop route", () => {
  it("control: storage layout deep link survives sign-in", async () => {
    const path = "/th/master-data/storage-layouts/b1?floor=2";
    expect(await signInRedirect(path)).toBe(
      `/th/sign-in?returnTo=${encodeURIComponent(path)}`,
    );
  });

  it.each([
    "/th/hr/leave/review?request=r1",
    "/th/hr/payslips",
    "/th/hr/today",
    "/th/ai-usage",
  ])("%s keeps its destination through sign-in", async (path) => {
    const target = await signInRedirect(path);
    const kept = new URL(target, "https://x.invalid").searchParams.has(
      "returnTo",
    )
      ? 1
      : 0;
    expect({ target, kept }).toEqual({
      target: `/th/sign-in?returnTo=${encodeURIComponent(path)}`,
      kept: 1,
    });
  });
});
