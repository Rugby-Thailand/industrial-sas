import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  workspace: { denied: true } as Record<string, unknown>,
  hr: { status: "NONE", permissions: [] as string[] },
  usage: { status: "READY", permissions: ["aiUsage.read"] as string[] },
  pathname: "/master-data/storage-layouts",
  replace: vi.fn(),
}));

vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => state.workspace,
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => state.hr,
}));
vi.mock("@/components/providers/AiUsageAccessProvider", () => ({
  useAiUsageAccess: () => state.usage,
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: state.replace }),
}));

import { HrLandingRedirect } from "./HrLandingRedirect";

beforeEach(() => {
  state.workspace = { denied: true };
  state.hr = { status: "NONE", permissions: [] };
  state.usage = { status: "READY", permissions: ["aiUsage.read"] };
  state.pathname = "/master-data/storage-layouts";
  state.replace.mockReset();
});

describe("landing for members without storage access", () => {
  it("opens the AI usage report for a usage-only member", () => {
    render(<HrLandingRedirect />);
    expect(state.replace).toHaveBeenCalledWith("/ai-usage");
  });

  it("keeps HR first for a member with HR and usage access", () => {
    state.hr = { status: "READY", permissions: ["hr.self.access"] };
    render(<HrLandingRedirect />);
    expect(state.replace).toHaveBeenCalledWith("/hr/today");
  });

  it.each([
    [
      "HR access is still loading",
      { hr: { status: "LOADING", permissions: [] } },
    ],
    ["the member has storage access", { workspace: { denied: false } }],
    [
      "usage access is only configure",
      { usage: { status: "READY", permissions: ["aiUsage.configure"] } },
    ],
    ["the page is not a storage page", { pathname: "/ai-usage" }],
  ])("does not redirect while %s", (_label, overrides) => {
    Object.assign(state, overrides);
    render(<HrLandingRedirect />);
    expect(state.replace).not.toHaveBeenCalled();
  });
});
