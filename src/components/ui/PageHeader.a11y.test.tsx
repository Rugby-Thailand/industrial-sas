import type { ComponentProps } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import { PageHeader } from "./PageHeader";

const LOCALES = ["th", "en"] as const;

describe("PageHeader accessibility", () => {
  it.each(LOCALES)("is clean while collapsed in %s", async (locale) => {
    const { baseElement } = renderWithIntl(
      <PageHeader title="Stock counts" description="What this page is for." />,
      { locale },
    );
    expect(await axe(baseElement)).toHaveNoViolations();
  });

  it.each(LOCALES)(
    "is clean with the help dialog open in %s",
    async (locale) => {
      const { baseElement } = renderWithIntl(
        <PageHeader
          title="Stock counts"
          description="What this page is for."
        />,
        { locale },
      );
      fireEvent.click(screen.getByRole("button"));
      expect(await axe(baseElement)).toHaveNoViolations();
    },
  );
});

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props} />
  ),
}));
