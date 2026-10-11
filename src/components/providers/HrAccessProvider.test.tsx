import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { HrAccessProvider, useHrAccess } from "./HrAccessProvider";

const mock = vi.hoisted(() => ({ employeeId: "employee-one" }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: () => ({
    ok: true,
    value: {
      permissions: ["hr.self.access"],
      organizationId: "org-one",
      actorUserId: "actor-one",
      organizationName: "Test organization",
      timezone: "Asia/Bangkok",
      timezoneSupported: true,
      employee: mock.employeeId
        ? { id: mock.employeeId, code: "SAME-CODE", displayName: "Same name" }
        : undefined,
      sites: [],
      sitesComplete: true,
    },
  }),
}));
afterEach(() => {
  cleanup();
  mock.employeeId = "employee-one";
});

it("changes intent identity when the same account is linked to another employee with identical display data", () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <HrAccessProvider>{children}</HrAccessProvider>
  );
  const hook = renderHook(() => useHrAccess(), { wrapper });
  const first = hook.result.current.identityKey;
  mock.employeeId = "employee-two";
  hook.rerender();
  expect(hook.result.current.employee?.id).toBe("employee-two");
  expect(hook.result.current.identityKey).not.toBe(first);
  expect(hook.result.current.identityKey).toBe(
    "org-one:actor-one:employee-two",
  );
  mock.employeeId = "";
  hook.rerender();
  expect(hook.result.current.identityKey).toBe("org-one:actor-one:not-linked");
});
