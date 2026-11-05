import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({
  sidebarCookie: undefined as string | undefined,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "sidebar_state" && request.sidebarCookie !== undefined
        ? { name, value: request.sidebarCookie }
        : undefined,
  }),
  headers: async () => new Headers(),
}));
vi.mock("next-intl/server", () => ({ setRequestLocale: () => undefined }));
vi.mock("@/lib/auth/appAccess", () => ({ readAppAccess: async () => "APP" }));
vi.mock("@/components/auth/OrganizationRequired", () => ({
  OrganizationRequired: () => null,
}));
vi.mock("@/components/providers/WorkspaceAccessBoundary", () => ({
  WorkspaceAccessBoundary: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/shell/DesktopShell", () => ({
  DesktopShell: ({ children }: { children: ReactNode }) => children,
}));

import { DesktopShell } from "@/components/shell/DesktopShell";

import DesktopLayout from "./layout";

/** The shell element the layout renders, with the props it was given. */
async function renderedShell() {
  const tree = await DesktopLayout({
    children: <p>Page</p>,
    params: Promise.resolve({ locale: "th" }),
  });
  if (!isValidElement<{ children: ReactElement }>(tree))
    throw Error("no element");
  const shell = tree.props.children as ReactElement<{ defaultOpen?: boolean }>;
  expect(shell.type).toBe(DesktopShell);
  return shell;
}

beforeEach(() => {
  request.sidebarCookie = undefined;
});

describe("desktop layout sidebar state", () => {
  it.each([
    ["no saved choice", undefined, true],
    ["an expanded sidebar", "true", true],
    ["a collapsed icon rail", "false", false],
  ])(
    "starts the shell from %s, so a reload or language switch keeps it",
    async (_case, cookie, open) => {
      request.sidebarCookie = cookie;
      expect((await renderedShell()).props.defaultOpen).toBe(open);
    },
  );
});
