/**
 * Pickup identification shared by `startMove` and the move screen.
 *
 * The pallet QR payload identifies the pallet for either method. A plain
 * pallet code is accepted only when typed (`MANUAL`), ignoring case: a camera
 * read (`SCAN`) must come from the QR label.
 */
export function identifiesPallet(
  code: string,
  method: "SCAN" | "MANUAL",
  pallet: { readonly _id: string; readonly code: string },
): boolean {
  const value = code.trim();
  return (
    value === `ISAS:PALLET:1:${pallet._id}` ||
    (method === "MANUAL" && value.toUpperCase() === pallet.code.toUpperCase())
  );
}
