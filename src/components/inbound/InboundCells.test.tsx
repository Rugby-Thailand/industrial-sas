import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { identifier, withUnit } from "./InboundCells";

import { UNRENDERABLE } from "@/lib/formatters";

describe("identifier", () => {
  it("renders the whole identifier, prefix included", () => {
    render(<>{identifier("prv_item_resin_hd")}</>);

    expect(screen.getByText("prv_item_resin_hd")).toBeInTheDocument();
    expect(screen.queryByText(/^…/)).toBeNull();
  });

  it("does not wrap, and offers the full value as a tooltip", () => {
    render(<>{identifier("prv_item_resin_hd")}</>);

    const cell = screen.getByText("prv_item_resin_hd");
    expect(cell).toHaveClass("whitespace-nowrap");
    expect(cell).toHaveAttribute("title", "prv_item_resin_hd");
  });

  it("distinguishes identifiers that share a tail", () => {
    render(
      <>
        {identifier("prv_item_resin_hd")}
        {identifier("prv_loc_resin_hd")}
      </>,
    );

    expect(screen.getByText("prv_item_resin_hd")).toBeInTheDocument();
    expect(screen.getByText("prv_loc_resin_hd")).toBeInTheDocument();
  });

  it("says nothing is renderable rather than showing an empty cell", () => {
    const { container, rerender } = render(<>{identifier(undefined)}</>);
    expect(container).toHaveTextContent(UNRENDERABLE);

    rerender(<>{identifier("")}</>);
    expect(container).toHaveTextContent(UNRENDERABLE);
  });
});

describe("withUnit", () => {
  it("never renders a bare quantity", () => {
    expect(withUnit(180_000, "KG")).toBe("180.000 KG");
  });
});
