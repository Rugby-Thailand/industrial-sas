import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

import { CameraBarcodeScanner } from "./CameraBarcodeScanner";

const decode = vi.hoisted(() => vi.fn());

vi.mock("@zxing/browser", () => ({
  BrowserMultiFormatReader: class {
    decodeFromConstraints = decode;
  },
}));

it("keeps the open Thai camera scanner accessible", async () => {
  decode.mockResolvedValue({ stop: vi.fn() });
  const { baseElement } = renderWithIntl(
    <CameraBarcodeScanner
      triggerLabel="สแกน Area ปลายทาง"
      onDetected={vi.fn()}
    />,
    { locale: "th", workspace: false },
  );

  fireEvent.click(screen.getByRole("button", { name: "สแกน Area ปลายทาง" }));
  await waitFor(() => expect(decode).toHaveBeenCalledOnce());

  expect(await axe(baseElement)).toHaveNoViolations();
});
