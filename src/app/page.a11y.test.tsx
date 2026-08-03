import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import ScaffoldStatusPage from "./page";

describe("scaffold status page accessibility", () => {
  it("has no detectable axe-core violations", async () => {
    const { container } = render(<ScaffoldStatusPage />);

    expect(await axe(container)).toHaveNoViolations();
  });
});
