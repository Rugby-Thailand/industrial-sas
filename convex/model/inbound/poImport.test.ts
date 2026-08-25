import { describe, expect, it } from "vitest";

import {
  DEFAULT_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
  MAX_IMPORT_ROWS,
  parseDecimalCell,
  previewImport,
  takeChunk,
  tokenizeDelimited,
} from "./poImport";

const HEADER = "line_number,sku,quantity,uom";
const file = (...rows: string[]) => [HEADER, ...rows].join("\n");

const preview = (text: string, batchRef = "BATCH-1") => {
  const result = previewImport({ batchRef, text });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
};

describe("tokenizeDelimited", () => {
  it("reads quoted cells containing commas and escaped quotes", () => {
    const rows = tokenizeDelimited('a,"b,c","d""e"\n');
    expect(rows.ok && rows.value).toEqual([["a", "b,c", 'd"e']]);
  });

  it("accepts both line endings", () => {
    const rows = tokenizeDelimited("a,b\r\nc,d\n");
    expect(rows.ok && rows.value).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("refuses an unterminated quote rather than swallowing the file", () => {
    const rows = tokenizeDelimited('a,"b\nc,d\n');
    expect(!rows.ok && rows.error.code).toBe("UNTERMINATED_QUOTE");
  });

  it("treats a trailing newline as formatting, not an empty row", () => {
    const rows = tokenizeDelimited("a,b\n");
    expect(rows.ok && rows.value).toHaveLength(1);
  });

  it("refuses an empty file", () => {
    expect(tokenizeDelimited("").ok).toBe(false);
    expect(tokenizeDelimited("\n\n").ok).toBe(false);
  });

  it("refuses a file with more rows than the bound allows", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 2 }, (_, i) => `${i}`);
    const result = tokenizeDelimited(rows.join("\n"));
    expect(!result.ok && result.error.code).toBe("TOO_MANY_ROWS");
  });
});

describe("previewImport", () => {
  it("accepts a well-formed file and converts to minor units", () => {
    const result = preview(file("1,BOLT-M8-30,12.5,EA", "2,STEEL-COIL,3,KG"));

    expect(result.accepted).toHaveLength(2);
    expect(result.accepted[0]?.quantityMinorUnits).toBe(12_500);
    expect(result.accepted[1]?.quantityMinorUnits).toBe(3_000);
    expect(result.rejected).toEqual([]);
  });

  it("reports the bad rows and still accepts the good ones", () => {
    const result = preview(
      file("1,BOLT,10,EA", "2,,5,EA", "3,STEEL,notanumber,KG", "4,RESIN,7,L"),
    );

    expect(result.accepted.map((row) => row.sku)).toEqual(["BOLT", "RESIN"]);
    expect(result.rejected.map((row) => row.sourceLine)).toEqual([3, 4]);
    expect(result.rejected[0]?.problem.code).toBe("VALUE_MISSING");
  });

  it("numbers rejected rows the way the operator's spreadsheet does", () => {
    const result = preview(file("1,,5,EA"));
    expect(result.rejected[0]?.sourceLine).toBe(2);
  });

  it("reports a row with the wrong column count rather than guessing", () => {
    const result = preview(file("1,BOLT,10"));
    expect(result.rejected[0]?.problem.code).toBe("COLUMN_COUNT_MISMATCH");
  });

  it("says plainly when nothing at all can be written", () => {
    const result = preview(file("1,,,"));
    expect(result.empty).toBe(true);
  });

  it("refuses a file missing a required column", () => {
    const result = previewImport({
      batchRef: "BATCH-1",
      text: "line_number,sku,quantity\n1,BOLT,10",
    });
    expect(!result.ok && result.error.code).toBe("HEADER_MISSING_COLUMN");
  });

  it("refuses a duplicated column, which would silently pick one", () => {
    const result = previewImport({
      batchRef: "BATCH-1",
      text: "line_number,sku,quantity,uom,sku\n1,BOLT,10,EA,OTHER",
    });
    expect(!result.ok && result.error.code).toBe("HEADER_DUPLICATE_COLUMN");
  });

  it("matches header columns case-insensitively", () => {
    const result = previewImport({
      batchRef: "BATCH-1",
      text: "Line_Number,SKU,Quantity,UOM\n1,BOLT,10,ea",
    });
    expect(result.ok && result.value.accepted[0]?.uom).toBe("EA");
  });

  it("refuses a batch reference that is not an identifier", () => {
    expect(previewImport({ batchRef: "", text: file("1,A,1,EA") }).ok).toBe(
      false,
    );
    expect(
      previewImport({ batchRef: "has space", text: file("1,A,1,EA") }).ok,
    ).toBe(false);
  });
});

describe("sourceRowRef", () => {
  it("is stable across re-parses of the same file", () => {
    const text = file("1,BOLT,10,EA", "2,STEEL,4,KG");
    expect(preview(text).accepted.map((row) => row.sourceRowRef)).toEqual(
      preview(text).accepted.map((row) => row.sourceRowRef),
    );
  });

  it("distinguishes two files that contain identical rows", () => {
    const text = file("1,BOLT,10,EA");
    const first = preview(text, "BATCH-1").accepted[0]?.sourceRowRef;
    const second = preview(text, "BATCH-2").accepted[0]?.sourceRowRef;

    expect(first).toBe("BATCH-1:1");
    expect(second).toBe("BATCH-2:1");
    expect(first).not.toBe(second);
  });
});

describe("parseDecimalCell", () => {
  it("converts three decimal places exactly", () => {
    expect(parseDecimalCell("0.1")).toEqual({ ok: true, value: 100 });
    expect(parseDecimalCell("12.345")).toEqual({ ok: true, value: 12_345 });
    expect(parseDecimalCell("7")).toEqual({ ok: true, value: 7_000 });
  });

  it("refuses more precision than the ledger stores", () => {
    const result = parseDecimalCell("1.0005");
    expect(!result.ok && result.error.code).toBe("QUANTITY_TOO_PRECISE");
  });

  it("refuses a zero, negative, or non-numeric quantity", () => {
    expect(parseDecimalCell("0").ok).toBe(false);
    expect(parseDecimalCell("-3").ok).toBe(false);
    expect(parseDecimalCell("1e3").ok).toBe(false);
    expect(parseDecimalCell("ten").ok).toBe(false);
  });
});

describe("takeChunk", () => {
  const rows = preview(
    file(...Array.from({ length: 60 }, (_, i) => `${i + 1},SKU-${i},1,EA`)),
  ).accepted;

  it("takes a bounded chunk and says where to resume", () => {
    const chunk = takeChunk({ accepted: rows, chunkSize: 25 });

    expect(chunk.ok && chunk.value.rows).toHaveLength(25);
    expect(chunk.ok && chunk.value.nextCursor).toBe(25);
    expect(chunk.ok && chunk.value.complete).toBe(false);
  });

  it("walks the whole file in chunks and finishes exactly once", () => {
    let cursor: number | undefined = 0;
    let seen = 0;
    let chunks = 0;

    while (cursor !== undefined) {
      const chunk = takeChunk({ accepted: rows, cursor, chunkSize: 25 });
      expect(chunk.ok).toBe(true);
      if (!chunk.ok) return;

      seen += chunk.value.rows.length;
      chunks += 1;
      cursor = chunk.value.nextCursor ?? undefined;
    }

    expect(seen).toBe(rows.length);
    expect(chunks).toBe(3);
  });

  it("defaults to a chunk size the caller does not have to know", () => {
    const chunk = takeChunk({ accepted: rows });
    expect(chunk.ok && chunk.value.rows).toHaveLength(DEFAULT_CHUNK_SIZE);
  });

  it("refuses a chunk larger than one mutation should write", () => {
    expect(
      takeChunk({ accepted: rows, chunkSize: MAX_CHUNK_SIZE + 1 }).ok,
    ).toBe(false);
    expect(takeChunk({ accepted: rows, chunkSize: 0 }).ok).toBe(false);
  });

  it("refuses a cursor past the end rather than answering an empty page", () => {
    const result = takeChunk({ accepted: rows, cursor: rows.length + 1 });
    expect(!result.ok && result.error.code).toBe("CURSOR_INVALID");
  });

  it("completes on a cursor exactly at the end", () => {
    const chunk = takeChunk({ accepted: rows, cursor: rows.length });
    expect(chunk.ok && chunk.value.rows).toHaveLength(0);
    expect(chunk.ok && chunk.value.complete).toBe(true);
  });
});
