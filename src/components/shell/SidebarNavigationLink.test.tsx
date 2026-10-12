import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    prefetch,
    ...props
  }: ComponentProps<"a"> & { prefetch?: boolean | null }) => (
    <a {...props} data-prefetch={String(prefetch)} />
  ),
}));

import { SidebarNavigationLink } from "./SidebarNavigationLink";

it("prefetches the full destination before the user taps a sidebar menu", () => {
  render(
    <SidebarNavigationLink href="/master-data/storage-layouts">
      Buildings
    </SidebarNavigationLink>,
  );
  expect(screen.getByRole("link", { name: "Buildings" })).toHaveAttribute(
    "data-prefetch",
    "true",
  );
});

it("respects an explicit prefetch opt-out", () => {
  render(
    <SidebarNavigationLink href="/hr/profile" prefetch={false}>
      Profile
    </SidebarNavigationLink>,
  );
  expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute(
    "data-prefetch",
    "false",
  );
});
