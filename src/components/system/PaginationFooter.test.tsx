import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PaginationFooter } from "./PaginationFooter";

describe("PaginationFooter", () => {
  it("keeps cursor boundaries and loading from dispatching navigation or submitting forms", () => {
    const previous = vi.fn();
    const next = vi.fn();
    const submit = vi.fn();
    const props = {
      label: "Pages",
      pageSizeControl: <span>Page size</span>,
      status: "Page 1",
      previousLabel: "Previous",
      nextLabel: "Next",
      canPrevious: false,
      canNext: true,
      onPrevious: previous,
      onNext: next,
    };
    const view = render(
      <form onSubmit={submit}>
        <PaginationFooter {...props} />
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(previous).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
    view.rerender(
      <form onSubmit={submit}>
        <PaginationFooter {...props} loading />
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(next).toHaveBeenCalledTimes(1);
  });
});
