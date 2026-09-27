#!/usr/bin/env python3
"""Generate test assets for the job-ticket scan page.

- 3 photo-like Top Gold job tickets (FM-PD-02) for the AI extraction test
- A4 location label sheet (QR + Code128) for the location scan test

Run with the demo-label virtual environment:
  tmp/qr-pdf-venv/bin/python scripts/generate-job-scan-test-assets.py
Zone labels come from the local Convex deployment (`convex data storageZones`).
"""
from __future__ import annotations

import html
import json
import subprocess
from pathlib import Path

import qrcode
import qrcode.image.svg
from reportlab.graphics import renderPDF, renderSVG
from reportlab.graphics.barcode import code128, createBarcodeDrawing
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output/job-scan-test"
OUTPUT.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont("Thai", "/System/Library/Fonts/Supplemental/Tahoma.ttf"))
pdfmetrics.registerFont(TTFont("Thai-Bold", "/System/Library/Fonts/Supplemental/Tahoma Bold.ttf"))

TICKETS = [
    {
        "job": "FO69070145",
        "delivery": "12/7/2569",
        "part": "CARTON BOX RSC 450x350x300 Rev.01",
        "customer": "บริษัท สยามพาร์ท จำกัด",
        "mfg": "10/7/2569",
        "qty": "2,400",
        "factory": "400.00",
        "customer_qty": "400.00",
        "barcode": "SPT-RSC450-BOX-01A",
        "photo": {"rotate": -1.5, "bg": "#3b3f44", "light": 1.0},
    },
    {
        "job": "FO69070158",
        "delivery": "15/7/2569",
        "part": "DIVIDER PARTITION 6x4 Rev.03",
        "customer": "บริษัท ฟาบริเนท จำกัด (สำนักงานใหญ่)",
        "mfg": "14/7/2569",
        "qty": "5,000",
        "factory": "1,250.00",
        "customer_qty": "1,250.00",
        "barcode": "FBN-DIV6X4-PRT-03C",
        "photo": {"rotate": 2.2, "bg": "#6b5a45", "light": 0.93},
    },
    {
        "job": "FO69070163",
        "delivery": "20/7/2569",
        "part": "LAYER PAD 1200x1000 KT Rev.02",
        "customer": "บริษัท ไทยอินดัสเทรียล แพ็ค จำกัด",
        "mfg": "18/7/2569",
        "qty": "800",
        "factory": "200.00",
        "customer_qty": "200.00",
        "barcode": "TIP-PAD1200-LYR-02B",
        "photo": {"rotate": -4.0, "bg": "#23272b", "light": 0.85},
    },
]


def code128_svg(value: str, height: float) -> str:
    drawing = createBarcodeDrawing(
        "Code128", value=value, barHeight=height, barWidth=1.1, humanReadable=False
    )
    svg = renderSVG.drawToString(drawing).split("?>", 1)[-1]
    return svg.replace("<svg ", '<svg preserveAspectRatio="none" style="width:100%;height:60px;display:block" ', 1)


def qr_svg(value: str) -> str:
    image = qrcode.make(value, image_factory=qrcode.image.svg.SvgPathImage, box_size=6, border=1)
    return image.to_string(encoding="unicode").replace("<svg ", '<svg style="width:100%;height:auto;display:block" ', 1)


def field(label_th: str, label_en: str, value: str, width: str = "100%") -> str:
    return f"""
      <div class="row">
        <div class="label"><div class="th">{label_th} :</div><div class="en">{label_en}</div></div>
        <div class="box" style="width:{width}">{html.escape(value)}</div>
      </div>"""


def ticket_html(t: dict) -> str:
    photo = t["photo"]
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
  body {{ margin:0; width:1500px; height:2000px; display:flex; align-items:center; justify-content:center;
         background: radial-gradient(circle at 30% 20%, {photo['bg']}cc, {photo['bg']} 60%, #111 100%);
         font-family: Tahoma, sans-serif; filter: brightness({photo['light']}); }}
  .paper {{ width:1000px; height:1414px; background:#fbfbf8; padding:60px 70px; box-sizing:border-box;
           transform: rotate({photo['rotate']}deg); box-shadow: 0 30px 60px rgba(0,0,0,.55); color:#222; position:relative; }}
  .head {{ display:flex; gap:24px; align-items:flex-start; }}
  .logo {{ width:110px; height:90px; border-radius:10px; background:linear-gradient(135deg,#7fc6e6,#2f7fb0);
          color:#fff; font:bold 58px Tahoma; display:flex; align-items:center; justify-content:center; }}
  .company b {{ font-size:25px; }} .company div {{ font-size:15px; margin-top:6px; color:#444; }}
  .job {{ display:flex; gap:30px; align-items:center; margin:26px 0 16px; }}
  .job h1 {{ margin:0; font-size:40px; letter-spacing:1px; }}
  .row {{ display:flex; align-items:center; gap:16px; margin:12px 0; }}
  .label {{ width:190px; flex-shrink:0; }} .th {{ font-size:25px; }} .en {{ font-size:13px; color:#555; }}
  .box {{ border:2px solid #555; border-radius:12px; padding:14px 18px; font-size:25px; min-height:34px; }}
  .pair {{ display:flex; gap:12px; align-items:center; }}
  .qtyrow {{ display:flex; justify-content:space-between; align-items:center; margin:12px 0; font-size:25px; }}
  .qtyrow .box {{ width:190px; text-align:right; }}
  table {{ width:100%; border-collapse:collapse; margin-top:22px; font-size:19px; }}
  td, th {{ border:1.5px solid #666; height:52px; text-align:center; font-weight:normal; }}
  .foot {{ display:flex; justify-content:space-between; font-size:15px; color:#444; margin-top:14px; }}
  .dot {{ position:absolute; right:110px; top:150px; width:110px; height:110px; border-radius:50%; background:#f7d51d; }}
</style></head><body><div class="paper">
  <div class="dot"></div>
  <div class="head"><div class="logo">TG</div><div class="company">
    <b>บริษัท ท็อป โกลด์ โปรดักส์ แอนด์ แพ็คเกจจิ้ง จำกัด</b>
    <div>สำนักงานใหญ่ : 99/6 หมู่ 7 ถนนพหลโยธิน ต.สนับทึบ อ.วังน้อย จ.พระนครศรีอยุธยา 13170</div></div></div>
  <div class="job"><div style="width:110px">{qr_svg(t['job'])}</div>
    <div><h1>JOB NO. {t['job']}</h1><div style="width:360px">{code128_svg(t['job'], 30)}</div></div></div>
  {field("วันที่ส่งสินค้า", "DELIVERY DATE", t["delivery"])}
  {field("ชื่อสินค้า", "PART NAME", t["part"])}
  {field("ชื่อลูกค้า", "CUSTOMER", t["customer"])}
  <div class="row"><div class="label"><div class="th">วันที่ผลิต :</div><div class="en">MFG DATE</div></div>
    <div class="box" style="width:240px">{t['mfg']}</div>
    <div class="label" style="width:120px"><div class="th">จำนวน:</div><div class="en">QUANTITY</div></div>
    <div class="box" style="width:190px">{t['qty']}</div></div>
  <div class="row"><div class="label"><div class="th">ผู้ผลิต :</div><div class="en">PRODUCER BY</div></div>
    <div class="box" style="width:240px"></div>
    <div class="label" style="width:120px"><div class="th">ผู้ตรวจสอบ:</div><div class="en">CHECKER BY</div></div>
    <div class="box" style="width:190px;font-style:italic;color:#335">✓ sk</div></div>
  <div class="qtyrow">จ.น.แผ่น/พาเลท (ตอนออกจากโรงงาน) : <div class="box">{t['factory']}</div></div>
  <div class="qtyrow">จ.น.แผ่น/พาเลท (ตอนลงงานให้ลูกค้า) : <div class="box">{t['customer_qty']}</div></div>
  <div class="row" style="margin-top:18px"><div style="font-size:25px;width:190px">บาร์โค้ดสินค้า:</div>
    <div><div style="width:520px">{code128_svg(t['barcode'], 34)}</div>
    <div style="font-size:15px;margin-top:4px">{t['barcode']}</div></div></div>
  <table><tr><th>วันที่ : DATE</th><th>เข้า IN</th><th>ออก OUT</th><th>คงเหลือ BALANCE</th></tr>
    {''.join('<tr><td></td><td></td><td></td><td></td></tr>' for _ in range(5))}</table>
  <div class="foot"><span>Effective date 2-Apr-2018</span><span>FM-PD-02 REV 00</span></div>
</div></body></html>"""


def render_tickets() -> list[Path]:
    pages = []
    for index, ticket in enumerate(TICKETS, start=1):
        page = OUTPUT / f"ticket-{index}.html"
        page.write_text(ticket_html(ticket), encoding="utf-8")
        pages.append(page)
    script = """
import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 2000 } });
for (const file of process.argv.slice(1)) {
  await page.goto("file://" + file);
  await page.screenshot({ path: file.replace(/\\.html$/, ".jpg"), type: "jpeg", quality: 88 });
}
await browser.close();
"""
    subprocess.run(
        ["node", "--input-type=module", "-e", script, *[str(p) for p in pages]],
        cwd=ROOT,
        check=True,
    )
    for page in pages:
        page.unlink()
    return [p.with_suffix(".jpg") for p in pages]


def local_zones() -> list[dict]:
    raw = subprocess.run(
        ["pnpm", "exec", "convex", "data", "storageZones", "--limit", "500", "--format", "jsonLines"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout
    zones = [json.loads(line) for line in raw.splitlines() if line.startswith("{")]
    demo = [z for z in zones if z.get("status") == "ACTIVE" and z["code"].startswith("DEMO-ANNEX")]
    return sorted(demo, key=lambda z: z["code"])[:9]


def draw_label(c: canvas.Canvas, x: float, y: float, w: float, h: float, code: str, name: str, qr_value: str | None) -> None:
    c.setStrokeColor(colors.HexColor("#9CA3AF"))
    c.setDash(3, 3)
    c.rect(x, y, w, h)
    c.setDash()
    c.setFillColor(colors.HexColor("#111827"))
    size = 26 * mm
    if qr_value:
        widget = QrCodeWidget(qr_value)
        bx0, by0, bx1, by1 = widget.getBounds()
        drawing = Drawing(size, size, transform=[size / (bx1 - bx0), 0, 0, size / (by1 - by0), 0, 0])
        drawing.add(widget)
        renderPDF.draw(drawing, c, x + 4 * mm, y + h - size - 4 * mm)
    text_x = x + (size + 7 * mm if qr_value else 5 * mm)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(text_x, y + h - 12 * mm, code)
    c.setFont("Thai", 9)
    c.drawString(text_x, y + h - 18 * mm, name)
    c.setFont("Thai", 7)
    c.setFillColor(colors.HexColor("#6B7280"))
    c.drawString(text_x, y + h - 24 * mm, "QR = ISAS location id" if qr_value else "Not in system: saved as needs location")
    barcode = code128.Code128(code, barHeight=9 * mm, barWidth=0.3 * mm)
    barcode.drawOn(c, x + (w - barcode.width) / 2, y + 7 * mm)
    c.setFillColor(colors.HexColor("#111827"))
    c.setFont("Helvetica", 7)
    c.drawCentredString(x + w / 2, y + 3 * mm, f"Code128: {code}")


def render_location_sheet(zones: list[dict]) -> Path:
    output = OUTPUT / "location-labels.pdf"
    c = canvas.Canvas(str(output), pagesize=A4)
    width, height = A4
    c.setFont("Thai-Bold", 14)
    c.drawString(15 * mm, height - 15 * mm, "ป้ายทดสอบสแกนตำแหน่ง · Local demo warehouse")
    c.setFont("Thai", 8)
    c.drawString(15 * mm, height - 21 * mm,
                 "สแกน QR หรือบาร์โค้ด Code128 ในหน้า สแกนใบ Job ขั้นที่ 1 - ป้ายสุดท้ายไม่มีในระบบ ใช้ทดสอบ รอระบุตำแหน่ง")
    labels = [(z["code"], z["label"], z["qrValue"]) for z in zones]
    labels.append(("DOCK-GATE-9", "ไม่มีในระบบ (ทดสอบ รอระบุตำแหน่ง)", None))
    cols, w, h = 2, 88 * mm, 49 * mm
    for i, (code, name, qr_value) in enumerate(labels):
        col, row = i % cols, i // cols
        draw_label(c, 15 * mm + col * (w + 4 * mm), height - 30 * mm - (row + 1) * (h + 3 * mm), w, h, code, name, qr_value)
    c.save()
    return output


if __name__ == "__main__":
    for path in render_tickets():
        print(path.relative_to(ROOT))
    print(render_location_sheet(local_zones()).relative_to(ROOT))
