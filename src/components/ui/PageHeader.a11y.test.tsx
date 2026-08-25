import { fireEvent, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import { PageHeader } from "./PageHeader";

const LOCALES = ["th", "en"] as const;

/** Both disclosure states, both catalogues (`INV-0010-09`). */
describe("PageHeader accessibility", () => {
  it.each(LOCALES)("is clean while collapsed in %s", async (locale) => {
    const { container } = renderWithIntl(
      <PageHeader title="Stock counts" description="What this page is for." />,
      { locale },
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each(LOCALES)("is clean while expanded in %s", async (locale) => {
    const { container } = renderWithIntl(
      <PageHeader title="Stock counts" description="What this page is for." />,
      { locale },
    );
    fireEvent.click(screen.getByRole("button"));
    expect(await axe(container)).toHaveNoViolations();
  });
});
