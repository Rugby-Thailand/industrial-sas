import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ObservabilityProvider } from "@/components/providers/ObservabilityProvider";
import type { ObservabilityEvent } from "@/lib/observability/event";
import type { ObservabilityPort } from "@/lib/observability/port";
import { APPLICATION_RENDER_ERROR_CODE } from "@/lib/observability/applicationError";
import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import LocaleError from "./error";

const recordingPort = (): ObservabilityPort & {
  readonly events: ObservabilityEvent[];
} => {
  const events: ObservabilityEvent[] = [];
  return { events, record: (event) => void events.push(event) };
};

describe("locale error boundary", () => {
  it("renders Thai recovery copy, retries, and reports no error text", () => {
    const port = recordingPort();
    const reset = vi.fn();
    const error = new Error("SKU BOLT-M8 failed for tenant secret");

    renderWithIntl(
      <ObservabilityProvider port={port}>
        <LocaleError error={error} reset={reset} />
      </ObservabilityProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "เกิดข้อผิดพลาดที่ไม่คาดคิด",
    );
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(port.events).toHaveLength(1);
    expect(port.events[0]).toMatchObject({
      code: APPLICATION_RENDER_ERROR_CODE,
      severity: "error",
      dimensions: { boundary: "locale" },
    });
    expect(JSON.stringify(port.events)).not.toContain("BOLT-M8");
    expect(JSON.stringify(port.events)).not.toContain("tenant secret");
  });
});
