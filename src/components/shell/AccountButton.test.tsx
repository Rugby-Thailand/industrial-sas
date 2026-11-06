import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  configuredEnvironment,
  renderWithIntl,
} from "@tests/fixtures/intl-render";

type ClerkUser = {
  readonly fullName: string | null;
  readonly primaryEmailAddress: { readonly emailAddress: string } | null;
};

const clerk = vi.hoisted(() => ({
  isLoaded: true,
  user: null as ClerkUser | null,
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ isLoaded: clerk.isLoaded, user: clerk.user }),
  // Like Clerk's trigger: a localized button around an English-named avatar.
  UserButton: () => (
    <button type="button" aria-label="เปิดเมนูบัญชี">
      {/* eslint-disable-next-line @next/next/no-img-element -- Clerk's own markup */}
      <img src="data:," alt="Local Tester's logo" title="Local Tester" />
    </button>
  ),
}));

import { SidebarAccount } from "./AccountButton";

const KEY = "pk_test_Zm9vLWJhci0xMy5jbGVyay5hY2NvdW50cy5kZXYk";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", KEY);
  clerk.isLoaded = true;
  clerk.user = {
    fullName: "Local Tester",
    primaryEmailAddress: { emailAddress: "tester@example.com" },
  };
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const render = (collapsed = false) =>
  renderWithIntl(<SidebarAccount collapsed={collapsed} />, {
    environment: configuredEnvironment,
    workspace: false,
  });

describe("sidebar account footer", () => {
  it("names the signed-in person on the row that opens the account menu", async () => {
    render();

    const name = screen.getByTestId("sidebar-account-name");
    expect(name).toHaveTextContent("Local Tester");
    expect(name).toHaveClass("truncate", "text-sm", "font-medium");
    expect(name).toHaveAttribute("title", "Local Tester");
    // One control: the menu trigger, named by its own label and the name.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveAccessibleName(
        "เปิดเมนูบัญชี Local Tester",
      ),
    );
  });

  it("makes the whole full-width row the menu's touch target, with the row's focus ring", () => {
    render();

    const row = screen.getByTestId("sidebar-account");
    expect(row).toContainElement(screen.getByTestId("sidebar-account-name"));
    expect(row).toContainElement(screen.getByRole("button"));
    expect(row).toHaveClass("relative", "min-h-touch", "w-full");
    expect(row).toHaveClass("has-[button:focus-visible]:ring-2");
  });

  it("falls back to the primary email address when the account has no name", () => {
    clerk.user = {
      fullName: null,
      primaryEmailAddress: { emailAddress: "tester@example.com" },
    };
    render();

    expect(screen.getByTestId("sidebar-account-name")).toHaveTextContent(
      "tester@example.com",
    );
  });

  it("holds the name's place while the account loads", () => {
    clerk.isLoaded = false;
    clerk.user = null;
    render();

    expect(screen.getByTestId("sidebar-account-loading")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.queryByTestId("sidebar-account-name")).toBeNull();
  });

  it("keeps the name for screen readers on the icon rail", () => {
    render(true);

    expect(screen.getByTestId("sidebar-account-name")).toHaveClass("sr-only");
  });

  it("marks the English-named avatar decorative inside the localized button", async () => {
    render();

    const button = screen.getByRole("button");
    const image = button.querySelector("img");
    await waitFor(() => expect(image).toHaveAttribute("alt", ""));
    // Its title alone would still name it.
    expect(image).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).toBeNull();
    expect(button).toHaveAccessibleName("เปิดเมนูบัญชี Local Tester");
  });

  it("keeps the localized label alone until the name is known", async () => {
    clerk.isLoaded = false;
    clerk.user = null;
    render();

    const button = screen.getByRole("button");
    await waitFor(() => expect(button).toHaveAttribute("id"));
    expect(button).not.toHaveAttribute("aria-labelledby");
    expect(button).toHaveAccessibleName("เปิดเมนูบัญชี");
  });

  it("renders nothing without a configured identity provider", () => {
    const { container } = renderWithIntl(<SidebarAccount collapsed={false} />);

    expect(container).toBeEmptyDOMElement();
  });
});
