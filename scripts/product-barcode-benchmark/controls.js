/* global loadWasm, makeCanvas, decodeOptimized */
window.runNegativeControls = async () => {
  if (window.benchmarkState.running)
    throw new Error("Finish the photo benchmark first");
  const wasm = await loadWasm();
  const results = [];
  for (const name of ["blank", "printed-text-only", "job-only-photo"]) {
    let canvas;
    if (name === "job-only-photo") {
      const original = new Image();
      original.src = "/images/1.jpg";
      await original.decode();
      canvas = makeCanvas(original, [
        0,
        0,
        original.naturalWidth,
        Math.floor(original.naturalHeight * 0.45),
      ]);
    } else {
      canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (name === "printed-text-only") {
        ctx.fillStyle = "black";
        ctx.font = "24px sans-serif";
        ctx.fillText("FO69100125", 30, 120);
        ctx.fillText("TEST-PRODUCT-BOX-F", 30, 240);
      }
    }
    const image = new Image();
    image.src = canvas.toDataURL();
    await image.decode();
    canvas.width = canvas.height = 1;
    const row = { name, attempts: [] };
    const start = performance.now();
    const codes = await decodeOptimized(image, wasm, row, true);
    results.push({
      name,
      productCodes: codes.map((code) => code.text),
      attempts: row.attempts.length,
      budgetExhausted: Boolean(row.budgetExhausted),
      totalMs: performance.now() - start,
    });
    image.src = "";
  }
  const output = {
    stage: "negative-controls",
    decoder: `zxing-wasm ${wasm.ZXING_WASM_VERSION}`,
    results,
    passed: results.every((row) => row.productCodes.length === 0),
  };
  const saved = await fetch("/results/negative-controls", {
    method: "POST",
    body: JSON.stringify(output),
  });
  if (!saved.ok) throw new Error(await saved.text());
  return output;
};
