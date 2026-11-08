import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { HrAccessProvider, useHrAccess } from "./HrAccessProvider";

const mock = vi.hoisted(() => ({
  employeeId: "employee-one",
  error: undefined as unknown,
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery_experimental: () =>
    mock.error !== undefined
      ? { status: "error", error: mock.error }
      : {
          status: "success",
          data: {
            ok: true,
            value: {
              permissions: ["hr.self.access"],
              organizationId: "org-one",
              actorUserId: "actor-one",
              organizationName: "Test organization",
              timezone: "Asia/Bangkok",
              timezoneSupported: true,
              employee: mock.employeeId
                ? {
                    id: mock.employeeId,
                    code: "SAME-CODE",
                    displayName: "Same name",
                  }
                : undefined,
              sites: [],
              sitesComplete: true,
            },
          },
        },
}));
afterEach(() => {
  cleanup();
  mock.employeeId = "employee-one";
  mock.error = undefined;
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

const failure = (code: string) =>
  Object.assign(new Error(code), { data: { code } });

it("treats a signed-in user without an active organization as having no HR access", () => {
  mock.error = failure("ACTIVE_ORGANIZATION_MISSING");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <HrAccessProvider>{children}</HrAccessProvider>
  );
  const hook = renderHook(() => useHrAccess(), { wrapper });
  expect(hook.result.current.status).toBe("NONE");
});

it("lets any other access query failure reach the error boundary", () => {
  mock.error = failure("INTERNAL_ERROR");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <HrAccessProvider>{children}</HrAccessProvider>
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => renderHook(() => useHrAccess(), { wrapper })).toThrow(
    "INTERNAL_ERROR",
  );
});
