import { readBarcodeImage } from "@/features/finishedGoods/barcodeImage";
type Row = {
  name: string;
  pass: boolean;
  codes: string[];
  elapsedMs: number;
  reviewRequired: boolean;
  attempts: number;
};
declare global {
  interface Window {
    runPrivateBarcodeCorpus: (rounds?: number) => Promise<Row[]>;
    privateBarcodeCorpus: { running: boolean; rows: Row[]; error?: string };
  }
}
window.runPrivateBarcodeCorpus = async (rounds = 1) => {
  const state: Window["privateBarcodeCorpus"] = (window.privateBarcodeCorpus = {
    running: true,
    rows: [] as Row[],
  });
  try {
    const expected: {
      name: string;
      expectedProduct: string;
      expectedJob: string;
    }[] = await (await fetch("/private-corpus.json")).json();
    if (!expected.length) throw new Error("Private manifest unavailable");
    for (let round = 0; round < rounds; round++)
      for (const { name, expectedProduct, expectedJob } of expected) {
        const response = await fetch(`/private-photos/${name}`);
        if (!response.ok) throw new Error("Private manifest unavailable");
        const file = new File([await response.blob()], name!, {
          type: "image/jpeg",
        });
        const result = await readBarcodeImage(
          file,
          "TICKET",
          new AbortController().signal,
        );
        const pass =
          result.codes.includes(expectedProduct) &&
          result.codes.includes(expectedJob) &&
          (!["2.jpg", "9.jpg"].includes(name!) || result.reviewRequired);
        state.rows.push({ name: `${round + 1}/${name}`, pass, ...result });
      }
    return state.rows;
  } finally {
    state.running = false;
  }
};
