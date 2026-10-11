# Add location HTML preview

Interactive, throwaway preview of registering an unknown location during job scanning. Open `index.html` directly, or run from the repository root:

```sh
python3 -m http.server 3201 --bind 127.0.0.1 --directory src/features/finishedGoods/jobScan/_prototype/add-location
```

Open http://localhost:3201/?variant=A&theme=dark&lang=en.

The preview begins after the sample label `F2-L28-18` was scanned. Choose **Add location**, select a building and optional floor, then continue. **Scan sample ticket** supplies illustrative details; manual entry, storage format selection, saved records, and the location catalogue also work.

Compare three registration layouts using the bottom arrows or URL: `A` inline form, `B` side drawer, `C` separate step. Arrow keys switch layouts when a field or dialog is not focused. English/Thai and light/dark are available in the header. **Show state** displays the in-memory data; **Reset demo** starts over.

Camera acquisition and all saves use sample data in memory. Reloading clears the preview. The preview makes no production requests and creates no real locations or stock records.
