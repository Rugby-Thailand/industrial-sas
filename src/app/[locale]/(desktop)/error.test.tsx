import { fireEvent, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ObservabilityProvider } from "@/components/providers/ObservabilityProvider";
import type { ObservabilityEvent } from "@/lib/observability/event";
import type { ObservabilityPort } from "@/lib/observability/port";
import { APPLICATION_RENDER_ERROR_CODE } from "@/lib/observability/applicationError";
import { renderWithIntl } from "@tests/fixtures/intl-render";

const navigation = vi.hoisted(() => ({ pathname: "/finished-goods" }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  Link: ({ href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props} />
  ),
}));

import DesktopPageError from "./error";

const recordingPort = (): ObservabilityPort & {
  readonly events: ObservabilityEvent[];
} => {
  const events: ObservabilityEvent[] = [];
  return { events, record: (event) => void events.push(event) };
};

function renderError(locale: "th" | "en" = "th") {
  const port = recordingPort();
  const retry = vi.fn();
  renderWithIntl(
    <ObservabilityProvider port={port}>
      <DesktopPageError
        error={new Error("productId not-a-real-id for tenant secret")}
        retry={retry}
      />
    </ObservabilityProvider>,
    { locale },
  );
  return { port, retry };
}

beforeEach(() => {
  navigation.pathname = "/finished-goods";
});

describe("desktop page error boundary", () => {
  it("names the failed page, retries first and offers its module hub second", () => {
    navigation.pathname = "/finished-goods/products/not-a-real-id";
    const { port, retry } = renderError();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "เปิดหน้านี้ไม่ได้" }),
    ).toBeVisible();
    // An unclassified read failure: neutral words, the next step, no guesses.
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("ยังโหลดข้อมูลหน้านี้ไม่ได้");
    expect(alert).toHaveTextContent(
      "ลองใหม่อีกครั้ง หรือกลับไปที่หน้าสินค้าสำเร็จรูป",
    );
    expect(alert).not.toHaveTextContent(/ลิงก์|ถูกลบ/);
    const again = screen.getByRole("button", { name: "ลองใหม่" });
    expect(again).toHaveAttribute("data-variant", "default");
    const hub = screen.getByRole("link", { name: "ไปที่หน้าสินค้าสำเร็จรูป" });
    expect(hub).toHaveAttribute("href", "/finished-goods");
    expect(hub).toHaveAttribute("data-variant", "outline");
    // The retry comes before the hub in reading and tab order.
    expect(
      again.compareDocumentPosition(hub) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(again);
    expect(retry).toHaveBeenCalledOnce();
    expect(port.events).toHaveLength(1);
    expect(port.events[0]).toMatchObject({
      code: APPLICATION_RENDER_ERROR_CODE,
      severity: "error",
    });
    expect(JSON.stringify(port.events)).not.toContain("tenant secret");
  });

  it.each([
    ["/finished-goods/scan", "/finished-goods", "Finished goods"],
    ["/hr/leave/review/request-1", "/hr/leave/review", "Review leave"],
    ["/hr/today", "/master-data/storage-layouts", "Buildings & spots"],
  ])(
    "sends a failure at %s to %s, never to the failed page itself",
    (pathname, href, hub) => {
      navigation.pathname = pathname;
      renderError("en");

      expect(
        screen.getByRole("link", { name: `Go to ${hub}` }),
      ).toHaveAttribute("href", href);
      expect(screen.getByRole("alert")).toHaveTextContent(
        `Try again, or go back to ${hub}.`,
      );
    },
  );

  it("offers retry as the only action when the start page itself failed", () => {
    navigation.pathname = "/master-data/storage-layouts";
    renderError("en");

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toHaveAttribute(
      "data-variant",
      "default",
    );
    // No destination to name: the copy offers the retry alone.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Try loading this page again.",
    );
  });
});
