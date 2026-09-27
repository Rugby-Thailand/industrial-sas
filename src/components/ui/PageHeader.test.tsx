import type { ComponentProps } from "react";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("keeps the title as the single h1 and hides the description by default", () => {
    renderWithIntl(<PageHeader title="งานคลัง" description="คำอธิบายหน้า" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "งานคลัง" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("คำอธิบายหน้า")).not.toBeInTheDocument();
  });

  it("opens help in a labelled dialog and closes it without expanding the header", () => {
    const { container } = renderWithIntl(
      <PageHeader title="งานคลัง" description="คำอธิบายหน้า" />,
    );
    const trigger = screen.getByRole("button", { name: "เกี่ยวกับหน้านี้" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "งานคลัง" });
    expect(within(dialog).getByText("คำอธิบายหน้า")).toBeVisible();
    expect(container.querySelector("header")).not.toHaveTextContent(
      "คำอธิบายหน้า",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "ปิด" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the breadcrumb trail with the title as the current page", () => {
    renderWithIntl(
      <PageHeader
        title="พาเลท P-000001"
        breadcrumbs={[
          { label: "สินค้าสำเร็จรูป", href: "/finished-goods" },
          { label: "กล่อง A", href: "/finished-goods/products/p1" },
        ]}
      />,
    );
    const trail = screen.getByRole("navigation");
    expect(
      within(trail).getByRole("link", { name: "สินค้าสำเร็จรูป" }),
    ).toHaveAttribute("href", "/finished-goods");
    expect(
      within(trail).getByRole("link", { name: "กล่อง A" }),
    ).toHaveAttribute("href", "/finished-goods/products/p1");
    expect(within(trail).getByText("พาเลท P-000001")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("renders no breadcrumb on top-level pages", () => {
    renderWithIntl(<PageHeader title="งานคลัง" />);

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("renders no toggle when there is no description", () => {
    renderWithIntl(<PageHeader title="งานคลัง" />);

    expect(
      screen.queryByRole("button", { name: "เกี่ยวกับหน้านี้" }),
    ).not.toBeInTheDocument();
  });

  it("puts a back button before the title unless the page opts out", () => {
    const { rerender } = renderWithIntl(<PageHeader title="งานคลัง" />);
    expect(screen.getByRole("button", { name: "ย้อนกลับ" })).toBeVisible();
    rerender(<PageHeader title="งานคลัง" showBack={false} />);
    expect(
      screen.queryByRole("button", { name: "ย้อนกลับ" }),
    ).not.toBeInTheDocument();
  });
});

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props} />
  ),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));
