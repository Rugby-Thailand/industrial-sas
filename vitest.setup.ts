import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { toHaveNoViolations } from "jest-axe";
import { afterEach, expect } from "vitest";

expect.extend(toHaveNoViolations);

/**
 * Testing Library only auto-registers its cleanup when `afterEach` is a global.
 * This project keeps `globals: false` and imports test APIs explicitly, so the
 * unmount has to be wired up by hand — otherwise renders accumulate in the same
 * document and queries fail with "found multiple elements".
 */
afterEach(() => {
  cleanup();
});
