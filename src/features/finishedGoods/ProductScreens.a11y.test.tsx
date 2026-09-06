import type * as ClerkModule from "@clerk/nextjs";
import type * as WorkspaceModule from "@/components/providers/WorkspaceProvider";
import { fireEvent, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs", async (importOriginal) => {
  const actual = await importOriginal<typeof ClerkModule>();
  return { ...actual, useAuth: () => ({ isLoaded: true, userId: "user-a" }) };
});
vi.mock("@/components/providers/WorkspaceProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspaceModule>();
  return { ...actual, useWorkspace: () => finishedGoodsWorkspace };
});
vi.mock("convex/react", () => ({
  useMutation: () => async () => savedProductOutcome,
  useQuery: () => querySuccess(finishedGoodsList),
}));
vi.mock("@/components/system/QueryGate", () => ({
  QueryGate: ({ children }: { children: (warehouseId: string) => ReactNode }) =>
    children("warehouse-a"),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));

import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  finishedGoodsWorkspace,
  finishedGoodsList,
  querySuccess,
  savedProductOutcome,
} from "@tests/fixtures/finished-goods-ui";
import { FinishedGoodsCatalogue, ProductScreen } from "./ProductScreens";

beforeEach(() => localStorage.clear());

it.each(["en", "th"] as const)(
  "keeps the complete %s product form and preview accessible",
  async (locale) => {
    const { container } = renderWithIntl(<ProductScreen />, {
      locale,
      workspace: false,
    });
    expect(await axe(container)).toHaveNoViolations();
  },
);

it("keeps catalogue search, status filters, and record navigation accessible", async () => {
  const { container } = renderWithIntl(<FinishedGoodsCatalogue />, {
    locale: "en",
    workspace: false,
  });
  expect(await axe(container)).toHaveNoViolations();
  fireEvent.click(screen.getByRole("button", { name: "Pallets" }));
  expect(await axe(container)).toHaveNoViolations();
});

it("names the discard dialog and its available actions", async () => {
  renderWithIntl(<ProductScreen />, { locale: "en", workspace: false });
  fireEvent.change(screen.getByRole("textbox", { name: "SKU" }), {
    target: { value: "DRAFT" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  const dialog = screen.getByRole("dialog", {
    name: "Discard unsaved changes?",
  });
  expect(dialog).toHaveAccessibleDescription(
    "Your last server-saved version will remain available.",
  );
  expect(await axe(dialog)).toHaveNoViolations();
});

it.each(["en", "th"] as const)(
  "keeps %s product and pallet table views accessible",
  async (locale) => {
    const { container } = renderWithIntl(<FinishedGoodsCatalogue />, {
      locale,
      workspace: false,
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: locale === "en" ? "Table view" : "มุมมองตาราง",
      }),
    );
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(
      screen.getByRole("button", {
        name: locale === "en" ? "Pallets" : "รายการพาเลท",
      }),
    );
    expect(await axe(container)).toHaveNoViolations();
  },
);
