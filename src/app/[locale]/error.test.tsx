import { fireEvent, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { ObservabilityProvider } from "@/components/providers/ObservabilityProvider";
import type { ObservabilityEvent } from "@/lib/observability/event";
import type { ObservabilityPort } from "@/lib/observability/port";
import { APPLICATION_RENDER_ERROR_CODE } from "@/lib/observability/applicationError";
import { renderWithIntl } from "../../../tests/fixtures/intl-render";

const navigation = vi.hoisted(() => ({ pathname: "/finished-goods" }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  Link: ({ href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props} />
  ),
}));

import LocaleError from "./error";

const recordingPort = (): ObservabilityPort & {
  readonly events: ObservabilityEvent[];
} => {
  const events: ObservabilityEvent[] = [];
  return { events, record: (event) => void events.push(event) };
};

describe("locale error boundary", () => {
  it("renders Thai recovery copy, retries, and reports no error text", () => {
    navigation.pathname = "/finished-goods";
    const port = recordingPort();
    const retry = vi.fn();
    const error = new Error("SKU BOLT-M8 failed for tenant secret");

    renderWithIntl(
      <ObservabilityProvider port={port}>
        <LocaleError error={error} retry={retry} />
      </ObservabilityProvider>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "เกิดข้อผิดพลาดที่ไม่คาดคิด",
      }),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "หน้าจอนี้ทำงานต่อไม่ได้",
    );
    const start = screen.getByRole("link", {
      name: "ไปที่หน้าอาคารและจุดจัดเก็บ",
    });
    expect(start).toHaveAttribute("href", "/master-data/storage-layouts");
    // Retrying is the primary action; the start page is the way out.
    const again = screen.getByRole("button", { name: "ลองใหม่" });
    expect(again).toHaveAttribute("data-variant", "default");
    expect(start).toHaveAttribute("data-variant", "outline");
    expect(
      again.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(again);
    expect(retry).toHaveBeenCalledOnce();
    expect(port.events).toHaveLength(1);
    expect(port.events[0]).toMatchObject({
      code: APPLICATION_RENDER_ERROR_CODE,
      severity: "error",
      dimensions: { boundary: "locale" },
    });
    expect(JSON.stringify(port.events)).not.toContain("BOLT-M8");
    expect(JSON.stringify(port.events)).not.toContain("tenant secret");
  });

  it("offers retry alone when the start page itself failed", () => {
    navigation.pathname = "/master-data/storage-layouts";
    renderWithIntl(
      <ObservabilityProvider port={recordingPort()}>
        <LocaleError error={new Error("boom")} retry={vi.fn()} />
      </ObservabilityProvider>,
      { locale: "en" },
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toHaveAttribute(
      "data-variant",
      "default",
    );
  });
});
