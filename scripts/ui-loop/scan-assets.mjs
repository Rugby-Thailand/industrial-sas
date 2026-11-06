#!/usr/bin/env node
// Builds the local inputs for the Stage 2 (warehouse scanning) capture:
// job-ticket and location-label photos with real Code128 barcodes, fed through
// the app's own image picker, and a code-free scene for the Chromium fake
// camera. Rebuild with: node scripts/ui-loop/scan-assets.mjs
//
// Codes are capture-only: FO9999xxxx Job numbers and UILOOP-* product codes
// never occur in the seed; DEMO-ANNEX-F01-Z01 is a seeded storage zone code.
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "output/ui-loop/assets");
mkdirSync(out, { recursive: true });

const require = createRequire(join(root, "package.json"));
const writerEntry = require.resolve("zxing-wasm/writer");
const { prepareZXingModule, writeBarcode } = await import(writerEntry);
const wasm = readFileSync(
  writerEntry.replace(/dist\/.*$/, "dist/writer/zxing_writer.wasm"),
);
// Local wasm only: the package would otherwise fetch it from a CDN.
prepareZXingModule({
  overrides: { wasmBinary: new Uint8Array(wasm).buffer },
  fireImmediately: true,
});
async function code128(value) {
  const result = await writeBarcode(value, { format: "Code128" });
  if (result.error) throw Error(`${value}: ${result.error}`);
  // Scalable: drop the fixed size for a viewBox, keep the bars crisp.
  const [, w, h] = result.svg.match(/<svg width="(\d+)" height="(\d+)"/);
  return result.svg.replace(
    /^[\s\S]*?<svg width="\d+" height="\d+"/,
    `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" shape-rendering="crispEdges"`,
  );
}

export const ASSETS = {
  ticketPair: {
    file: "ticket-pair.jpg",
    job: "FO99990001",
    product: "UILOOP-PRODUCT-01",
  },
  // The ticket image reader needs a product barcode, so the partial ticket is
  // the one whose Job No. barcode label is missing.
  ticketProductOnly: {
    file: "ticket-product-only.jpg",
    job: "FO99990002",
    product: "UILOOP-PRODUCT-02",
    jobBarcode: false,
  },
  locationLabel: { file: "location-label.jpg", code: "DEMO-ANNEX-F01-Z01" },
  cameraScene: { file: "camera-scene.y4m" },
  // Probe only (not in screens.json): a Job No. barcode held in front of the
  // continuous ticket camera.
  cameraJobCode: { file: "camera-job-code.y4m", job: "FO99990003" },
};

const page = (
  body,
  w,
  h,
  bg,
) => `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin:0; width:${w}px; height:${h}px; overflow:hidden; display:flex; align-items:center;
         justify-content:center; font-family: Tahoma, "Thonburi", sans-serif; background:${bg}; }
  .paper { background:#fbfbf6; color:#222; box-shadow:0 24px 50px rgba(0,0,0,.5); }
  .bars svg { width:100%; height:100%; display:block; }
</style></head><body>${body}</body></html>`;

const missingLabel = (width, text) =>
  `<div style="width:${width}px;height:90px;border:2px dashed #b0a99a;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#8a8170;font-size:18px">${text}</div>`;

async function ticket({ job, product, jobBarcode = true }) {
  const row = (th, en, value) =>
    `<div style="display:flex;gap:14px;align-items:center;margin:10px 0">
      <div style="width:170px"><div style="font-size:22px">${th}</div><div style="font-size:12px;color:#555">${en}</div></div>
      <div style="flex:1;border:2px solid #555;border-radius:10px;padding:10px 14px;font-size:22px">${value}</div></div>`;
  const productBlock = product
    ? `<div class="bars" style="width:560px;height:90px">${await code128(product)}</div>
       <div style="font-size:16px;margin-top:4px">${product}</div>`
    : missingLabel(560, "ฉลากบาร์โค้ดสินค้าหลุด");
  return page(
    `<div class="paper" style="width:900px;height:900px;padding:50px 60px;transform:rotate(-1.2deg)">
      <div style="font-size:24px;font-weight:bold">บริษัท ตัวอย่าง แพ็คเกจจิ้ง จำกัด</div>
      <div style="font-size:14px;color:#555;margin-top:4px">ใบติดพาเลทงานผลิต · ใช้สำหรับทดสอบการสแกนเท่านั้น</div>
      <div style="margin:28px 0 18px">
        <div style="font-size:36px;font-weight:bold;letter-spacing:1px">JOB NO. ${job}</div>
        <div style="margin-top:10px">${jobBarcode ? `<div class="bars" style="width:460px;height:90px">${await code128(job)}</div>` : missingLabel(460, "ฉลากบาร์โค้ด Job No. หลุด")}</div>
      </div>
      ${row("วันที่ส่งสินค้า", "DELIVERY DATE", "20/11/2569")}
      ${row("ชื่อสินค้า", "PART NAME", "CARTON RSC 450x350x300")}
      ${row("ชื่อลูกค้า", "CUSTOMER", "บริษัท ทดสอบ จำกัด")}
      ${row("จำนวน", "QUANTITY", "400")}
      <div style="display:flex;gap:14px;align-items:flex-start;margin-top:26px">
        <div style="width:170px;font-size:22px">บาร์โค้ดสินค้า</div><div>${productBlock}</div></div>
    </div>`,
    1000,
    1000,
    "radial-gradient(circle at 30% 20%, #5b5f64, #2c2f33 70%)",
  );
}

async function locationLabel({ code }) {
  return page(
    `<div class="paper" style="width:760px;height:400px;padding:36px 44px;transform:rotate(1deg);border:4px solid #f2c200">
      <div style="font-size:20px;color:#555">ตำแหน่งจัดเก็บ · STORAGE LOCATION</div>
      <div style="font-size:52px;font-weight:bold;font-family:monospace;margin:8px 0 18px">${code}</div>
      <div class="bars" style="width:640px;height:150px">${await code128(code)}</div>
    </div>`,
    900,
    560,
    "linear-gradient(#6d7278, #3a3e43)",
  );
}

// A pallet seen from a distance: no decodable code, so a live preview stays
// on its viewfinder instead of reading something on every frame.
const cameraScene = () =>
  page(
    `<div style="position:relative;width:1280px;height:720px">
      <div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,#4a4e53 0 180px,#43474c 180px 186px)"></div>
      <div style="position:absolute;left:0;right:0;bottom:0;height:140px;background:#5d5a55"></div>
      ${[0, 1, 2]
        .map((r) =>
          [0, 1, 2, 3]
            .map(
              (c) =>
                `<div style="position:absolute;left:${380 + c * 130}px;top:${230 + r * 110}px;width:126px;height:106px;background:#b68a57;border:2px solid #8d6638"></div>`,
            )
            .join(""),
        )
        .join("")}
      <div style="position:absolute;left:370px;top:560px;width:540px;height:40px;background:#7a5a36"></div>
      <div class="paper" style="position:absolute;left:560px;top:300px;width:120px;height:160px;padding:10px;font-size:11px;transform:rotate(-2deg)">
        <div style="font-weight:bold">JOB NO.</div>
        <div style="margin-top:8px;height:14px;background:#ccc"></div>
        <div style="margin-top:8px;height:8px;background:#ddd"></div>
        <div style="margin-top:6px;height:8px;background:#ddd"></div>
        <div style="margin-top:14px;height:18px;background:#ccc"></div>
      </div>
    </div>`,
    1280,
    720,
    "#333",
  );

const browser = await chromium.launch();
try {
  const shot = async (html, w, h, file, type = "jpeg") => {
    const tab = await browser.newPage({ viewport: { width: w, height: h } });
    await tab.setContent(html);
    await tab.evaluate(() => document.fonts.ready);
    await tab.screenshot({
      path: join(out, file),
      type,
      ...(type === "jpeg" ? { quality: 90 } : {}),
    });
    await tab.close();
  };
  await shot(
    await ticket(ASSETS.ticketPair),
    1000,
    1000,
    ASSETS.ticketPair.file,
  );
  await shot(
    await ticket(ASSETS.ticketProductOnly),
    1000,
    1000,
    ASSETS.ticketProductOnly.file,
  );
  await shot(
    await locationLabel(ASSETS.locationLabel),
    900,
    560,
    ASSETS.locationLabel.file,
  );
  await shot(cameraScene(), 1280, 720, "camera-scene.png", "png");
  await shot(
    page(
      `<div class="paper" style="padding:40px 60px"><div style="font-size:40px;font-weight:bold">JOB NO. ${ASSETS.cameraJobCode.job}</div><div class="bars" style="width:640px;height:160px;margin-top:16px">${await code128(ASSETS.cameraJobCode.job)}</div></div>`,
      1280,
      720,
      "#3a3e43",
    ),
    1280,
    720,
    "camera-job-code.png",
    "png",
  );
} finally {
  await browser.close();
}
// Chromium's fake capture device loops a Y4M file; one frame is enough.
for (const name of ["camera-scene", "camera-job-code"])
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-i",
      join(out, `${name}.png`),
      "-frames:v",
      "1",
      "-pix_fmt",
      "yuv420p",
      join(out, `${name}.y4m`),
    ],
    { stdio: "inherit" },
  );
writeFileSync(join(out, "assets.json"), `${JSON.stringify(ASSETS, null, 2)}\n`);
console.log(`Assets written to ${out}`);
