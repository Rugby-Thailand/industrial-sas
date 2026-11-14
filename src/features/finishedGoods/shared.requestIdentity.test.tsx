import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { messagesFor } from "@/i18n/messages";
import { useOperation } from "./shared";

const auth = vi.hoisted(() => ({
  isLoaded: false,
  userId: null as string | null,
}));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => auth }));
vi.mock("@/i18n/navigation", () => ({ Link: "a", useRouter: () => ({}) }));
afterEach(() => localStorage.clear());

const intl = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider
    locale="en"
    messages={messagesFor("en")}
    timeZone="Asia/Bangkok"
  >
    {children}
  </NextIntlClientProvider>
);

it("keeps an unscoped operation's identities in memory only", () => {
  auth.isLoaded = true;
  auth.userId = "user-a";
  const hook = renderHook(() => useOperation(), { wrapper: intl });
  const id = hook.result.current.request("remap", "ephemeral");
  expect(hook.result.current.request("remap", "ephemeral")).toBe(id);
  expect(localStorage.length).toBe(0);
  auth.isLoaded = false;
  auth.userId = null;
});

it("isolates operation identities by actor and never persists a null actor scope", () => {
  localStorage.clear();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider
      locale="en"
      messages={messagesFor("en")}
      timeZone="Asia/Bangkok"
    >
      {children}
    </NextIntlClientProvider>
  );
  const hook = renderHook(() => useOperation("add-location:warehouse-a"), {
    wrapper,
  });
  const loading = hook.result.current.request("create", "durable");
  expect(localStorage.length).toBe(0);
  auth.isLoaded = true;
  auth.userId = "user-a";
  hook.rerender();
  const first = hook.result.current.request("create", "durable");
  expect(first).not.toBe(loading);
  auth.userId = "user-b";
  hook.rerender();
  expect(hook.result.current.request("create", "durable")).not.toBe(first);
  auth.userId = "user-a";
  hook.rerender();
  expect(hook.result.current.request("create", "durable")).toBe(first);
  expect(Object.keys(localStorage)).toEqual([
    "fg-requests:add-location:warehouse-a:user-a",
    "fg-requests:add-location:warehouse-a:user-b",
  ]);
});
