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

  it("renders no toggle when there is no description", () => {
    renderWithIntl(<PageHeader title="งานคลัง" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props} />
  ),
}));
