import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { StatusReason } from "./StatusReason";

vi.mock("@/i18n/navigation", () => ({ Link: "a" }));

describe("compact explanations", () => {
  it("supports keyboard focus, Escape, and a persistent click explanation", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <StatusReason
        label="Why locked"
        message="Move stock first."
        tone="locked"
      />,
      { locale: "en" },
    );
    expect(screen.queryByText("Move stock first.")).not.toBeInTheDocument();
    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Move stock first.",
    );
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
    );
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("dialog", { name: "Why locked" }),
    ).toHaveTextContent("Move stock first.");
    await user.click(screen.getByRole("button", { name: "Close explanation" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Why locked" })).toHaveFocus();
  });

  it("shows a new error immediately with an announcement and a real recovery link", async () => {
    renderWithIntl(
      <StatusReason
        label="Review setup"
        message="Add a storage zone."
        tone="error"
        href="/review"
        announce
      />,
      { locale: "en" },
    );
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Add a storage zone.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Add a storage zone.");
    expect(screen.getByRole("link", { name: "Review setup" })).toHaveAttribute(
      "href",
      "/review",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
