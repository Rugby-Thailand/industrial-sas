# Top Gold demo seed receipt

Created in Production on 2026-09-22 for the `Top Gold` organization. This is
intentional test data and must be cleaned before importing confirmed warehouse
records.

## Scope

- Warehouse: `TG-DEMO` — Top Gold Demo Warehouse
- Building: `TG-A` — Top Gold Demo Building A (draft; 24 m × 18 m × 6 m)
- QR-addressable locations: 3
- Product: `TG-DEMO-BOX-01` — Demo Paper Carton
- Batch: `TG-DEMO-LOT-01`, 48 cartons, one pallet

The location QR labels and pallet QR label are actual application values. Print
or scan the values exactly as written. `BC-TG-0001` is retained as the product
reference; the current app's package scanner uses the pallet QR label rather
than a separate product barcode assignment.

Before real import, archive this demo building and remove its test product,
batch and pallet using their supported application workflows. Keep this folder
as the cleanup receipt.
