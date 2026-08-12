import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { identifier, withUnit } from "./InboundCells";

import { UNRENDERABLE } from "@/lib/formatters";

/**
 * The two inbound value renderers.
 *
 * `identifier` is here because of what it used to do: it abbreviated a document
 * ID to its last ten characters behind an ellipsis, so `prv_item_resin_hd`
 * reached a receiving screen as `…m_resin_hd`. That is destructive — the prefix
 * is the part that says what kind of thing the ID names — and it did not even
 * make the column narrower, because what survived was one unbreakable token.
 *
 * No provider here: neither renderer reads a translation, and the test asserting
 * that stays true is `clientMessages.test.ts`.
 */
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
    // The abbreviation collapsed these two to the same string, which is the
    // failure that matters: two rows that are not the same row read as one.
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
    // `180.000` reads as a count of pieces when it is thousandths of a
    // kilogram (`ADR-0004`).
    expect(withUnit(180_000, "KG")).toBe("180.000 KG");
  });
});
