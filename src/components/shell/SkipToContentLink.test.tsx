import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { SkipToContentLink } from "./SkipToContentLink";

beforeEach(() => window.history.replaceState({ app: 1 }, "", "/en/scan"));

it("focuses main without adding a state-less fragment history entry", () => {
  render(
    <>
      <SkipToContentLink targetId="main-content">
        Skip to main content
      </SkipToContentLink>
      <main id="main-content" tabIndex={-1} />
    </>,
  );
  const link = screen.getByRole("link", { name: "Skip to main content" });
  expect(link).toHaveAttribute("href", "#main-content");
  const length = window.history.length;
  fireEvent.click(link);
  expect(screen.getByRole("main")).toHaveFocus();
  expect(window.location.hash).toBe("");
  expect(window.history.length).toBe(length);
  expect(window.history.state).toEqual({ app: 1 });
});

it("falls back to the native fragment when the target is missing", () => {
  render(
    <SkipToContentLink targetId="missing">
      Skip to main content
    </SkipToContentLink>,
  );
  const link = screen.getByRole("link", { name: "Skip to main content" });
  // fireEvent returns false only when the default action was prevented.
  expect(fireEvent.click(link)).toBe(true);
});
