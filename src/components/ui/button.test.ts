import { describe, expect, it } from "vitest";

import { buttonVariants } from "./button";

describe("buttonVariants disabled colours", () => {
  it.each([
    "default",
    "success",
    "outline",
    "secondary",
    "destructive",
  ] as const)(
    "moves the %s variant off its active fill when disabled",
    (variant) => {
      const classes = buttonVariants({ variant });

      expect(classes).toContain("disabled:bg-disabled-surface");
      expect(classes).toContain("disabled:text-disabled");
    },
  );

  it("keeps disabled ghost actions transparent", () => {
    const classes = buttonVariants({ variant: "ghost" });

    expect(classes).toContain("disabled:bg-transparent");
    expect(classes).toContain("disabled:text-disabled");
  });
});
