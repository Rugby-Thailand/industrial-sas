import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ScaffoldStatusPage from "./page";

describe("scaffold status page", () => {
  it("renders a single top-level heading naming the project", () => {
    render(<ScaffoldStatusPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Industrial SSA" }),
    ).toBeInTheDocument();
  });

  it("states plainly that this is a scaffold, not a working application", () => {
    render(<ScaffoldStatusPage />);

    expect(
      screen.getByText(/scaffold — not a working application/i),
    ).toBeInTheDocument();
  });
});
