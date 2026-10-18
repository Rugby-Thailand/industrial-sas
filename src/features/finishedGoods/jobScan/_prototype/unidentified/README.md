# Unidentified pallet prototype

Interactive HTML for the agreed Top Gold storyboard: record a pallet with no paper Job and no known product, then identify its contents later while retaining its tracking code.

Open `index.html` directly in a browser. It includes its styles, behavior, and Lucide icons and needs no installation or external resources. To serve it from the repository root:

```sh
python3 -m http.server 8768 --bind 127.0.0.1 --directory src/features/finishedGoods/jobScan/_prototype/unidentified
```

Then open <http://127.0.0.1:8768>.

## Try the flow

1. Press **Identify** on the draft card, immediately before its trash action. The button has no explanatory helper copy.
2. Leave product, Job, barcode, and quantity empty. Optionally attach a local photo or add observations under additional details.
3. Save. The first unidentified pallet receives `U000123`; additional pallets receive different codes. Multiple normal and unidentified drafts can be saved together.
4. Open saved records. Search by tracking code, product, Job, barcode, or location and combine search with the product-status filter.
5. Choose **ระบุสินค้า**, enter the information that is actually known, and save. A Job number alone leaves the product Unidentified. A product name or barcode entered in this manual identification flow identifies the product; missing Job information remains a separate status.
6. The original tracking code remains immutable. Location status is independent of product status.

Cancel or Escape protects an unfinished editor. Photos of the pallet and its later paper Job have separate fields. Reset asks before clearing the prototype. Dark and light appearances are available in the header.

## Scope

This is a disposable prototype. Its local counter demonstrates allocation; it does not provide production uniqueness or concurrency guarantees. Standalone state lives in memory and resets on reload. The conversation preview may retain text state through its host, without retaining uploaded image bytes. Local photos are read in the browser and are never uploaded. Barcode acquisition is an explicitly labeled simulation. All save operations are local, and no application API or database is connected.

The visual authority is the supplied Top Gold mobile screen and the final Unidentified storyboard in this task. The prototype preserves their black/charcoal surfaces, cobalt actions, Thai copy, familiar form controls, and separate warning/success statuses. It adds no production route, changes no navigation inventory, and changes no shared design-system files.

Browser verification covers the main flow, mixed groups, code stability, partial identification, filters, dirty cancellation, image uploads and nested previews, optional number validation, repeated Save, reset, and 320px/390px/1440px layouts. The screenshot and verification outputs are local review artifacts under `.impeccable/review/unidentified-prototype/`.
