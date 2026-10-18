import { useState } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "../../../../../tests/fixtures/intl-render";
import { PhotoCapture } from "../../../../../src/features/finishedGoods/jobScan/PhotoCapture";

afterEach(() => vi.restoreAllMocks());

function previewResources() {
  const live = new Set<string>();
  let sequence = 0;
  const create = vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const url = `blob:inventory-photo-${++sequence}`;
    live.add(url);
    return url;
  });
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    live.delete(url);
  });
  return { live, create, revoke };
}

it("INV-10 closing and reopening the real photo panel must release its unsubmitted previews", () => {
  const resources = previewResources();
  const submit = vi.fn();
  function Host() {
    const [open, setOpen] = useState(true);
    return open ? (
      <PhotoCapture onSubmit={submit} onClose={() => setOpen(false)} />
    ) : (
      <button onClick={() => setOpen(true)}>Reopen photo panel</button>
    );
  }
  const view = renderWithIntl(<Host />, { locale: "en" });
  for (let i = 0; i < 3; i++) {
    if (i > 0)
      fireEvent.click(
        screen.getByRole("button", { name: "Reopen photo panel" }),
      );
    const input =
      view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: {
        files: [new File(["photo"], `ticket-${i}.jpg`, { type: "image/jpeg" })],
      },
    });
    expect(resources.create).toHaveBeenCalledTimes(i + 1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("button", { name: "Send 1 photo to AI" }),
    ).not.toBeInTheDocument();
  }
  expect(submit).not.toHaveBeenCalled();
  console.log(
    "INV-10 panel-owned preview lifetime",
    JSON.stringify({
      allocated: resources.create.mock.calls.length,
      revoked: resources.revoke.mock.calls.length,
      liveAfterThreeUnmounts: resources.live.size,
      submittedToParent: submit.mock.calls.length,
    }),
  );
  expect(resources.live.size).toBe(0);
});

it("INV-10 control: explicitly removing a photo releases the same kind of preview", () => {
  const resources = previewResources();
  const view = renderWithIntl(
    <PhotoCapture onSubmit={vi.fn()} onClose={vi.fn()} />,
    { locale: "en" },
  );
  fireEvent.change(
    view.container.querySelector<HTMLInputElement>('input[type="file"]')!,
    {
      target: {
        files: [
          new File(["photo"], "ticket-control.jpg", { type: "image/jpeg" }),
        ],
      },
    },
  );
  expect(resources.live.size).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Remove 1" }));
  expect(resources.revoke).toHaveBeenCalledOnce();
  expect(resources.live.size).toBe(0);
});
