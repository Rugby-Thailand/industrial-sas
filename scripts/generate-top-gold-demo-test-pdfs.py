#!/usr/bin/env python3
"""Generate individual Top Gold pallet labels and a Thai testing guide PDF.

Run with the repo virtual environment created for these demo labels:
  tmp/qr-pdf-venv/bin/python scripts/generate-top-gold-demo-test-pdfs.py
"""
from __future__ import annotations

import csv
from pathlib import Path

import qrcode
from reportlab.graphics.barcode import code128
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output/pdf"
TMP = ROOT / "tmp/pdfs/top-gold-individual-labels"
OUTPUT.mkdir(parents=True, exist_ok=True)
TMP.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont("Thai", "/System/Library/Fonts/Supplemental/Tahoma.ttf"))
pdfmetrics.registerFont(TTFont("Thai-Bold", "/System/Library/Fonts/Supplemental/Tahoma Bold.ttf"))


def rows() -> list[dict[str, str]]:
    with (ROOT / "data/top-gold-demo/package-labels.csv").open(newline="") as file:
        return list(csv.DictReader(file))


def draw_header(c: canvas.Canvas, title: str, subtitle: str) -> None:
    width, height = A4
    c.setFillColor(colors.HexColor("#7C3AED"))
    c.rect(0, height - 28 * mm, width, 28 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(18 * mm, height - 16 * mm, title)
    c.setFont("Helvetica", 9)
    c.drawString(18 * mm, height - 22 * mm, subtitle)


def draw_individual_label(row: dict[str, str]) -> Path:
    output = OUTPUT / f"top-gold-demo-pallet-{row['pallet_code']}.pdf"
    c = canvas.Canvas(str(output), pagesize=A4)
    width, height = A4
    draw_header(c, "TOP GOLD - PALLET TEST LABEL", "Unique pallet label for Thai Property AI test")
    x, y, w, h = 18 * mm, 62 * mm, width - 36 * mm, 170 * mm
    c.setFillColor(colors.white)
    c.setStrokeColor(colors.HexColor("#263238"))
    c.setLineWidth(1)
    c.roundRect(x, y, w, h, 5 * mm, stroke=1, fill=1)
    c.setFillColor(colors.HexColor("#111827"))
    c.setFont("Helvetica-Bold", 28)
    c.drawCentredString(width / 2, y + h - 30 * mm, row["pallet_code"])
    c.setFont("Helvetica", 14)
    c.setFillColor(colors.HexColor("#374151"))
    c.drawCentredString(width / 2, y + h - 41 * mm, row["product_sku"])
    c.setFont("Helvetica", 11)
    c.drawCentredString(width / 2, y + h - 49 * mm, f"Lot {row['lot']} | {row['quantity']} {row['unit']}")
    bar = code128.Code128(row["pallet_code"], barWidth=.62 * mm, barHeight=28 * mm, humanReadable=False)
    barcode_x = x + 18 * mm
    bar.drawOn(c, barcode_x, y + 72 * mm)
    c.setFont("Courier-Bold", 16)
    c.setFillColor(colors.black)
    c.drawCentredString(barcode_x + bar.width / 2, y + 64 * mm, row["pallet_code"])
    img_path = TMP / f"{row['pallet_code']}.png"
    qrcode.make(row["qr_value"]).save(img_path)
    q = 62 * mm
    c.drawImage(ImageReader(str(img_path)), x + w - q - 15 * mm, y + 25 * mm, q, q, mask="auto")
    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(colors.HexColor("#111827"))
    c.drawString(x + 18 * mm, y + 17 * mm, "QR: scan in Thai Property AI")
    c.drawString(x + 18 * mm, y + 11 * mm, "Code 128: readable pallet ID")
    c.showPage()
    c.save()
    return output


def wrapped_lines(text: str, font: str, size: float, max_width: float) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and stringWidth(candidate, font, size) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def thai_guide(items: list[dict[str, str]]) -> Path:
    output = OUTPUT / "top-gold-demo-test-guide-th.pdf"
    c = canvas.Canvas(str(output), pagesize=A4)
    width, height = A4
    draw_header(c, "Top Gold Demo Test Guide", "Thai test guide for unplaced pallets")
    x = 18 * mm
    y = height - 42 * mm
    c.setFillColor(colors.HexColor("#111827"))
    c.setFont("Thai-Bold", 15)
    c.drawString(x, y, "รายการ pallet ที่ยังไม่ได้วางใน location")
    y -= 9 * mm
    c.setFont("Thai", 10)
    for item in items:
        c.drawString(x, y, f"{item['pallet_code']}  |  {item['product_sku']}  |  {item['lot']}  |  {item['quantity']} {item['unit']}  |  Awaiting placement")
        y -= 7 * mm
    y -= 4 * mm
    c.setFont("Thai-Bold", 14)
    c.drawString(x, y, "วิธีทดสอบ")
    y -= 9 * mm
    steps = [
        "1. เข้าสู่ระบบ Top Gold แล้วเลือกคลัง TG-DEMO - Top Gold Demo Warehouse.",
        "2. เปิด Finished goods > Scan Packages.",
        "3. เลือกฉลากของ pallet ที่ต้องการทดสอบ และสแกน QR ที่อยู่ด้านล่างของฉลาก.",
        "4. ตรวจสอบรหัส pallet, สินค้า, lot และจำนวนให้ตรงกับฉลาก.",
        "5. สแกน QR ของ location ที่ต้องการจัดเก็บ แล้วตรวจสอบ location ก่อนยืนยัน.",
        "6. ยืนยันการจัดเก็บ จากนั้นตรวจสอบว่า Awaiting storage ลดลง และ Stored ของ location เพิ่มขึ้น.",
    ]
    c.setFont("Thai", 10)
    for step in steps:
        for line in wrapped_lines(step, "Thai", 10, width - 36 * mm):
            c.drawString(x, y, line)
            y -= 6 * mm
        y -= 2 * mm
    y -= 3 * mm
    c.setFont("Thai-Bold", 13)
    c.drawString(x, y, "ลำดับทดสอบที่แนะนำ")
    y -= 9 * mm
    recommendations = [
        "P-000001 -> TG-A-F01-Z01 (Receiving and QC)",
        "P-000002 -> TG-A-F01-Z02 (Pallet Storage A)",
        "P-000003 -> TG-A-F01-Z02 (Pallet Storage A)",
        "P-000004 -> TG-A-F01-Z03 (Dispatch Staging)",
    ]
    c.setFont("Thai", 10)
    for rec in recommendations:
        c.drawString(x, y, rec)
        y -= 7 * mm
    y -= 3 * mm
    c.setFillColor(colors.HexColor("#B91C1C"))
    c.setFont("Helvetica-Bold", 9)
    c.drawString(x, y, "Demo data only. Do not mix with real stock. Use the QR for the app workflow.")
    c.save()
    return output


if __name__ == "__main__":
    items = rows()
    outputs = [thai_guide(items), *(draw_individual_label(row) for row in items)]
    print("\n".join(str(path) for path in outputs))
