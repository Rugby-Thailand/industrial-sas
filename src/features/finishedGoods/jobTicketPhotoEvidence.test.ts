import { expect, it } from "vitest";
import { ticketPhotoEvidence } from "./jobTicketPhotoEvidence";

function barcode(
  text: string,
  y: number,
  format: "Code128" | "QRCode" = "Code128",
) {
  return {
    text,
    isValid: true,
    format,
    orientation: 0,
    position: {
      topLeft: { x: 20, y },
      topRight: { x: 120, y },
      bottomLeft: { x: 20, y: y + 12 },
      bottomRight: { x: 120, y: y + 12 },
    },
  };
}

it("prefers the unique linear job barcode and pairs it with a lower product code", () => {
  const result = ticketPhotoEvidence(
    [
      barcode("FO00123", 74, "QRCode"),
      barcode("FO00123", 100),
      barcode("BOX-O1", 370),
    ],
    600,
  );
  expect(result.codes).toEqual(["FO00123", "BOX-O1"]);
  expect(result.detailCrop).toEqual({
    x: 0,
    y: 104 / 600,
    width: 1,
    height: 300 / 600,
  });
});

it("does not use an unrelated storage QR or a barcode above the job as a product", () => {
  expect(
    ticketPhotoEvidence(
      [
        barcode("ISAS:warehouse", 80, "QRCode"),
        barcode("OTHER", 40),
        barcode("FO00123", 100),
      ],
      600,
    ).codes,
  ).toEqual(["FO00123"]);
});

it("ignores ambiguous multi-ticket identifiers", () => {
  expect(
    ticketPhotoEvidence(
      [barcode("FO00123", 100), barcode("FO00124", 110), barcode("BOX-A", 370)],
      600,
    ),
  ).toEqual({ codes: [] });
  expect(
    ticketPhotoEvidence(
      [barcode("FO00123", 100), barcode("BOX-A", 370), barcode("BOX-B", 390)],
      600,
    ),
  ).toEqual({ codes: [] });
});
