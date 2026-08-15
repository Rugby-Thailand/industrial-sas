#!/usr/bin/env python3
"""Build the Thai visual operator guide as a reviewed, shareable PDF."""

from __future__ import annotations

from pathlib import Path
from textwrap import shorten

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs/manuals/assets/operator-guide-th"
TMP = ROOT / "tmp/pdfs/operator-guide-th"
OUTPUT = ROOT / "output/pdf/industrial-sas-visual-operator-guide-th.pdf"
FONT = "/System/Library/Fonts/Supplemental/SukhumvitSet.ttc"

PAGE_W, PAGE_H = landscape(A4)
MARGIN = 32
HEADER_H = 58
FOOTER_H = 22
IMAGE_W = 525
GAP = 20
TEXT_X = MARGIN + IMAGE_W + GAP
TEXT_W = PAGE_W - TEXT_X - MARGIN
CONTENT_TOP = PAGE_H - HEADER_H - 16
CONTENT_BOTTOM = FOOTER_H + 16
CONTENT_H = CONTENT_TOP - CONTENT_BOTTOM

NAVY = colors.HexColor("#10233f")
BLUE = colors.HexColor("#2f80ed")
RED = colors.HexColor("#ff3b30")
INK = colors.HexColor("#152033")
MUTED = colors.HexColor("#5d6878")
PAPER = colors.HexColor("#f7f9fc")
LINE = colors.HexColor("#dce3ec")
WHITE = colors.white


TASKS = [
    {
        "number": 1,
        "title": "เริ่มต้นใช้งานและเลือกคลังสินค้า",
        "goal": "กำหนดบริบทของงานก่อนเปิดหน้าปฏิบัติงาน",
        "screen": "dashboard",
        "panels": [
            ((0, 110, 1280, 470), [(205, 158, 270, 58, 1)]),
            ((245, 1000, 1270, 1410), [(270, 1080, 965, 300, 2)]),
        ],
        "steps": [
            "เลือกคลังสินค้าที่กรอบ 1",
            "เลือกงานที่ต้องการเริ่มจากกรอบ 2",
            "ตรวจชื่อคลังสินค้าที่แสดงบนแดชบอร์ดอีกครั้ง",
        ],
        "done": "สำเร็จเมื่อชื่อคลังสินค้าที่ต้องการแสดงบนแดชบอร์ด",
    },
    {
        "number": 2,
        "title": "สร้างรายการสินค้า",
        "goal": "เพิ่มสินค้าและเปิดรายละเอียดสินค้าที่มีอยู่",
        "screen": "items",
        "panels": [
            ((260, 420, 1265, 1010), [(1090, 525, 120, 435, 1)]),
            ((260, 1040, 1265, 1530), [(278, 1110, 980, 380, 2)]),
        ],
        "steps": [
            "กรอบ 1 ใช้เปิดข้อมูลสินค้าที่มีอยู่",
            "กรอบ 2 กรอกรหัส ชื่อ หน่วยนับหลัก และรูปแบบการติดตาม",
            "ตรวจรหัสและหน่วยนับหลักก่อนกดบันทึกสินค้า",
        ],
        "done": "สำเร็จเมื่อสินค้าใหม่ปรากฏในทะเบียนและสถานะเป็นใช้งาน",
    },
    {
        "number": 3,
        "title": "สร้างผู้จัดจำหน่าย",
        "goal": "ลงทะเบียนคู่ค้าที่ใช้ในใบสั่งซื้อ",
        "screen": "suppliers",
        "panels": [
            ((260, 440, 1265, 850), [(1010, 540, 145, 285, 1)]),
            ((260, 920, 1265, 1260), [(278, 970, 980, 270, 2)]),
        ],
        "steps": [
            "กรอบ 1 ใช้ปิดหรือเปิดใช้งานผู้จัดจำหน่ายเดิม",
            "กรอบ 2 กรอกรหัสและชื่อผู้จัดจำหน่าย",
            "กดบันทึกผู้จัดจำหน่าย",
        ],
        "done": "สำเร็จเมื่อผู้จัดจำหน่ายปรากฏในทะเบียนและมีสถานะใช้งาน",
    },
    {
        "number": 4,
        "title": "สร้างและเปิดใบสั่งซื้อ",
        "goal": "สร้างหัวใบสั่งซื้อและเปิดเอกสารที่มีอยู่",
        "screen": "purchase-orders",
        "panels": [
            ((260, 360, 1265, 720), [(1010, 465, 115, 205, 1)]),
            ((260, 760, 1265, 1180), [(278, 815, 980, 335, 2)]),
        ],
        "steps": [
            "กรอบ 1 กดเปิดใบสั่งซื้อที่ต้องการทำงานต่อ",
            "กรอบ 2 กรอกเลขที่ใบสั่งซื้อและเลือกผู้จัดจำหน่าย",
            "กรอกอ้างอิงภายนอกถ้ามี แล้วกดบันทึกใบสั่งซื้อ",
        ],
        "done": "ใบสั่งซื้อใหม่เริ่มเป็นฉบับร่างจนกว่าจะเพิ่มรายการสินค้า",
    },
    {
        "number": 5,
        "title": "เพิ่มรายการสินค้าและเปิดใบรับ",
        "goal": "ทำให้ใบสั่งซื้อพร้อมรับสินค้า",
        "screen": "purchase-order-detail",
        "panels": [
            ((260, 780, 1265, 1195), [(278, 840, 980, 325, 1)]),
            ((260, 1195, 1265, 1520), [(278, 1238, 980, 250, 2)]),
        ],
        "steps": [
            "กรอบ 1 เลือกสินค้า กรอกจำนวนและหน่วยนับ แล้วบันทึกรายการ",
            "ตรวจยอดสั่งซื้อ รับแล้ว และคงเหลือ",
            "กรอบ 2 กรอกเลขที่ใบรับ แล้วกดเปิดใบรับ",
        ],
        "done": "สำเร็จเมื่อรายการมีสถานะยังรับได้และมีใบรับใหม่",
    },
    {
        "number": 6,
        "title": "เปิดใบรับและบันทึกข้อยกเว้น",
        "goal": "เตรียมเอกสารรับสินค้าและบันทึกปัญหาการส่งมอบ",
        "screen": "receiving",
        "panels": [
            ((260, 690, 1265, 1020), [(278, 745, 980, 245, 1)]),
            ((260, 1015, 1265, 1420), [(278, 1062, 980, 335, 2)]),
        ],
        "steps": [
            "กรอบ 1 กรอกเลขที่ใบรับและเลือกใบสั่งซื้อที่เปิดอยู่",
            "กรอบ 2 ใช้เมื่อพบของเสียหาย ของไม่ครบ หรือปัญหาการส่งมอบ",
            "เลือกประเภทและรหัสเหตุผลก่อนกดแจ้งข้อยกเว้น",
        ],
        "done": "สำเร็จเมื่อใบรับปรากฏในทะเบียนหรือข้อยกเว้นถูกบันทึก",
    },
    {
        "number": 7,
        "title": "บันทึกรายการรับ พาเลท และข้อมูลป้าย",
        "goal": "รับสินค้าเข้าคลังพร้อมหลักฐานที่เกี่ยวข้อง",
        "screen": "receipt-detail",
        "panels": [
            ((255, 560, 1265, 1350), [(278, 610, 980, 710, 1)]),
            ((255, 1325, 1265, 1685), [(278, 1360, 980, 300, 2)]),
            ((255, 1680, 1265, 2300), [(278, 1710, 980, 555, 3)]),
        ],
        "steps": [
            "กรอบ 1 เลือกตำแหน่งรับ สินค้า บรรทัด จำนวน หน่วย ล็อต และวันหมดอายุ",
            "กรอบ 2 กรอกรหัสพาเลทเมื่อต้องรวมรายการรับ",
            "กรอบ 3 เลือกแม่แบบ กรอก LPN และ SKU แล้วสร้างข้อมูลป้าย",
        ],
        "done": "สำเร็จเมื่อรายการรับปรากฏในตารางและมีสถานะสต็อก",
    },
    {
        "number": 8,
        "title": "ตัดสินผลการตรวจสอบคุณภาพ",
        "goal": "บันทึกผลและให้ผู้ใช้คนที่สองอนุมัติ",
        "screen": "quality",
        "panels": [
            ((260, 335, 1265, 680), [(278, 378, 980, 260, 1)]),
            ((260, 720, 1265, 1260), [(278, 775, 980, 455, 2)]),
        ],
        "steps": [
            "กรอบ 1 เลือกใบตรวจที่เปิดอยู่และกดตัดสินผลการตรวจ",
            "บันทึกผล เช่น ปล่อยผ่าน กักกัน หรือไม่ผ่าน",
            "กรอบ 2 ให้ผู้ใช้คนที่สองเลือกใบตรวจและกดอนุมัติผลนี้",
        ],
        "done": "สำเร็จเมื่อสถานะเปลี่ยนเป็นตัดสินแล้ว",
    },
    {
        "number": 9,
        "title": "รับงานจัดเก็บและยืนยันตำแหน่ง",
        "goal": "นำสินค้าไปยังชั้นที่เหมาะสมพร้อมบันทึกหลักฐาน",
        "screen": "putaway",
        "panels": [
            ((260, 335, 1265, 820), [(278, 378, 980, 395, 1)]),
            ((260, 850, 1265, 1050), [(278, 905, 980, 115, 2)]),
        ],
        "steps": [
            "กรอบ 1 เลือกงานพร้อมจัดเก็บ แล้วกดรับงานนี้",
            "กดคำแนะนำตำแหน่งและอ่านเหตุผล",
            "กรอบ 2 ตรวจคำแนะนำ แล้วจึงยืนยันหลังวางสินค้าบนชั้น",
        ],
        "done": "สำเร็จเมื่อสถานะเป็นจัดเก็บแล้วและมีตำแหน่งที่เลือก",
    },
    {
        "number": 10,
        "title": "ตรวจสอบยอดคงเหลือ",
        "goal": "อ่านปริมาณจริงตามสินค้า ตำแหน่ง ล็อต และสถานะ",
        "screen": "inventory-balances",
        "panels": [
            ((260, 330, 1265, 975), [(278, 367, 980, 570, 1)]),
        ],
        "steps": [
            "หาแถวจากสินค้า ตำแหน่งจัดเก็บ และล็อต",
            "ตรวจสถานะสต็อกก่อนอ่านจำนวน",
            "อ่านจำนวนคู่กับหน่วยนับเสมอ",
        ],
        "done": "หน้านี้อ่านอย่างเดียว การแก้ยอดต้องใช้รายการกลับรายการ",
    },
    {
        "number": 11,
        "title": "ตรวจสอบประวัติการเคลื่อนไหว",
        "goal": "ตรวจหลักฐานธุรกรรมแบบเพิ่มอย่างเดียว",
        "screen": "inventory-history",
        "panels": [
            ((260, 300, 1265, 715), [(278, 335, 980, 335, 1)]),
        ],
        "steps": [
            "ตรวจรหัสรายการ ประเภท เวลา วันที่ทางธุรกิจ และจำนวนบรรทัด",
            "รายการที่มีป้ายรายการกลับรายการคือการแก้ไขที่อ้างธุรกรรมเดิม",
            "ใช้รหัสรายการเมื่อติดต่อฝ่ายสนับสนุน",
        ],
        "done": "ประวัติไม่มีปุ่มลบหรือแก้ไข เพราะเป็นหลักฐานถาวร",
    },
    {
        "number": 12,
        "title": "ส่งออกข้อมูล",
        "goal": "ขอสร้างไฟล์และดาวน์โหลดเมื่อครบถ้วน",
        "screen": "reports",
        "panels": [
            ((260, 220, 1265, 535), [(278, 262, 980, 240, 1)]),
            ((260, 500, 1265, 900), [(278, 525, 980, 345, 2)]),
        ],
        "steps": [
            "กรอบ 1 เลือกชนิดข้อมูลแล้วกดขอส่งออก",
            "กรอบ 2 ดาวน์โหลดเมื่อสถานะเสร็จแล้ว หรือทำหน้าถัดไปเมื่อยังทำงาน",
            "ถ้างานหยุด ให้อ่านเหตุผลและลดขอบเขตข้อมูลก่อนเริ่มใหม่",
        ],
        "done": "ตรวจจำนวนแถวก่อนนำไฟล์ไปใช้งาน",
    },
    {
        "number": 13,
        "title": "ใช้งานบนเครื่องพกพา",
        "goal": "เลือกงานหน้างานแบบหนึ่งงานต่อหนึ่งหน้าจอ",
        "screen": "handheld-home",
        "panels": [
            ((400, 50, 880, 320), [(430, 96, 420, 178, 1)]),
            ((400, 330, 880, 750), [(430, 380, 420, 330, 2)]),
        ],
        "steps": [
            "กรอบ 1 ตรวจภาษา องค์กร และคลังสินค้า",
            "กรอบ 2 เลือกค้นหาสต็อก รับสินค้า ตรวจสอบคุณภาพ หรือจัดเก็บ",
            "ทำตามลำดับบนหน้าจอจนปุ่มขั้นถัดไปพร้อม",
        ],
        "done": "กดกลับไปหน้าจอเดสก์ท็อปเมื่อต้องกลับสู่งานหัวหน้างาน",
    },
]


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont("Sukhumvit", FONT, subfontIndex=2))
    pdfmetrics.registerFont(TTFont("SukhumvitMedium", FONT, subfontIndex=3))
    pdfmetrics.registerFont(TTFont("SukhumvitBold", FONT, subfontIndex=5))


def pil_font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size=size, index=5)


def draw_callout(draw: ImageDraw.ImageDraw, box, crop_origin, scale=1.0) -> None:
    x, y, width, height, number = box
    crop_x, crop_y = crop_origin
    x1 = int((x - crop_x) * scale)
    y1 = int((y - crop_y) * scale)
    x2 = int((x + width - crop_x) * scale)
    y2 = int((y + height - crop_y) * scale)
    stroke = max(5, int(7 * scale))
    radius = max(20, int(25 * scale))
    draw.rounded_rectangle((x1, y1, x2, y2), radius=12, outline="#ff3b30", width=stroke)
    cx, cy = x1 + 10, y1 + 10
    draw.ellipse(
        (cx - radius, cy - radius, cx + radius, cy + radius),
        fill="#ff3b30",
        outline="white",
        width=max(2, int(3 * scale)),
    )
    font = pil_font(max(20, int(27 * scale)))
    label = str(number)
    bounds = draw.textbbox((0, 0), label, font=font)
    draw.text(
        (cx - (bounds[2] - bounds[0]) / 2, cy - (bounds[3] - bounds[1]) / 2 - bounds[1]),
        label,
        font=font,
        fill="white",
    )


def build_panel(screen: str, panel_index: int, region, boxes) -> Path:
    source = Image.open(ASSETS / f"{screen}.png").convert("RGB")
    crop = source.crop(region)
    draw = ImageDraw.Draw(crop)
    for box in boxes:
        draw_callout(draw, box, (region[0], region[1]))
    path = TMP / f"{screen}-{panel_index}.png"
    crop.save(path, "PNG", optimize=True)
    return path


def paragraph(canvas: Canvas, text: str, x: float, y_top: float, width: float, style) -> float:
    item = Paragraph(text, style)
    _, height = item.wrap(width, PAGE_H)
    item.drawOn(canvas, x, y_top - height)
    return y_top - height


BODY = ParagraphStyle(
    "body",
    fontName="Sukhumvit",
    fontSize=11.2,
    leading=17,
    textColor=INK,
    alignment=TA_LEFT,
    spaceAfter=5,
)
STEP = ParagraphStyle(
    "step",
    parent=BODY,
    fontName="SukhumvitMedium",
    fontSize=11.5,
    leading=18,
    leftIndent=28,
    firstLineIndent=-24,
    spaceAfter=10,
)
SMALL = ParagraphStyle(
    "small",
    parent=BODY,
    fontSize=9.5,
    leading=14,
    textColor=MUTED,
)
DONE = ParagraphStyle(
    "done",
    parent=BODY,
    fontName="SukhumvitMedium",
    fontSize=10.5,
    leading=16,
    textColor=NAVY,
)


def page_header(canvas: Canvas, number: int, title: str, page_number: int) -> None:
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    canvas.setFillColor(NAVY)
    canvas.rect(0, PAGE_H - HEADER_H, PAGE_W, HEADER_H, stroke=0, fill=1)
    canvas.setFillColor(RED)
    canvas.circle(MARGIN + 18, PAGE_H - HEADER_H / 2, 18, stroke=0, fill=1)
    canvas.setFillColor(WHITE)
    canvas.setFont("SukhumvitBold", 17)
    canvas.drawCentredString(MARGIN + 18, PAGE_H - HEADER_H / 2 - 6, str(number))
    canvas.setFont("SukhumvitBold", 20)
    canvas.drawString(MARGIN + 48, PAGE_H - HEADER_H / 2 - 7, title)
    canvas.setFillColor(MUTED)
    canvas.setFont("Sukhumvit", 8.5)
    canvas.drawRightString(PAGE_W - MARGIN, 10, f"Industrial SAS - คู่มือผู้ปฏิบัติงาน | {page_number}")


def draw_panel(canvas: Canvas, path: Path, x: float, y: float, max_w: float, max_h: float) -> None:
    with Image.open(path) as image:
        width, height = image.size
    scale = min(max_w / width, max_h / height)
    draw_w, draw_h = width * scale, height * scale
    draw_x = x + (max_w - draw_w) / 2
    draw_y = y + (max_h - draw_h) / 2
    canvas.setFillColor(WHITE)
    canvas.roundRect(x, y, max_w, max_h, 7, stroke=0, fill=1)
    canvas.drawImage(ImageReader(path), draw_x, draw_y, draw_w, draw_h, preserveAspectRatio=True)
    canvas.setStrokeColor(LINE)
    canvas.roundRect(x, y, max_w, max_h, 7, stroke=1, fill=0)


def draw_task_page(canvas: Canvas, task, page_number: int) -> None:
    page_header(canvas, task["number"], task["title"], page_number)

    panel_count = len(task["panels"])
    panel_gap = 10
    panel_h = (CONTENT_H - panel_gap * (panel_count - 1)) / panel_count
    for index, (region, boxes) in enumerate(task["panels"]):
        path = build_panel(task["screen"], index + 1, region, boxes)
        y = CONTENT_TOP - (index + 1) * panel_h - index * panel_gap
        draw_panel(canvas, path, MARGIN, y, IMAGE_W, panel_h)

    y = CONTENT_TOP
    canvas.setFillColor(BLUE)
    canvas.setFont("SukhumvitMedium", 10)
    canvas.drawString(TEXT_X, y - 4, "เป้าหมาย")
    y -= 12
    y = paragraph(canvas, task["goal"], TEXT_X, y, TEXT_W, BODY) - 16

    canvas.setFillColor(NAVY)
    canvas.setFont("SukhumvitBold", 15)
    canvas.drawString(TEXT_X, y, "ขั้นตอน")
    y -= 12
    for index, step in enumerate(task["steps"], start=1):
        y = paragraph(canvas, f'<font color="#ff3b30">{index}</font>  {step}', TEXT_X, y, TEXT_W, STEP)

    y -= 6
    box_y = max(CONTENT_BOTTOM, y - 90)
    box_h = min(90, y - CONTENT_BOTTOM)
    if box_h > 45:
        canvas.setFillColor(colors.HexColor("#eaf2ff"))
        canvas.roundRect(TEXT_X, box_y, TEXT_W, box_h, 8, stroke=0, fill=1)
        canvas.setFillColor(BLUE)
        canvas.setFont("SukhumvitBold", 10.5)
        canvas.drawString(TEXT_X + 12, box_y + box_h - 20, "ตรวจว่างานเสร็จ")
        paragraph(canvas, task["done"], TEXT_X + 12, box_y + box_h - 28, TEXT_W - 24, DONE)

    canvas.showPage()


def draw_cover(canvas: Canvas) -> None:
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    canvas.setFillColor(BLUE)
    canvas.rect(0, PAGE_H - 12, PAGE_W, 12, stroke=0, fill=1)
    canvas.setStrokeColor(RED)
    canvas.setLineWidth(8)
    canvas.roundRect(52, 105, PAGE_W - 104, PAGE_H - 190, 20, stroke=1, fill=0)
    canvas.setFillColor(WHITE)
    canvas.setFont("SukhumvitBold", 31)
    canvas.drawString(82, PAGE_H - 145, "คู่มือใช้งานแบบมีภาพประกอบ")
    canvas.setFont("SukhumvitMedium", 18)
    canvas.setFillColor(colors.HexColor("#b8d6ff"))
    canvas.drawString(82, PAGE_H - 185, "Industrial SAS - งานคลังสินค้าตั้งแต่รับเข้าจนถึงส่งออกข้อมูล")
    canvas.setFillColor(WHITE)
    canvas.setFont("Sukhumvit", 13)
    canvas.drawString(82, PAGE_H - 250, "13 ขั้นตอนหลัก | ภาพหน้าจอภาษาไทย | กรอบสีแดงตรงกับหมายเลขคำแนะนำ")
    canvas.setFillColor(RED)
    canvas.circle(105, 190, 30, stroke=0, fill=1)
    canvas.setFillColor(WHITE)
    canvas.setFont("SukhumvitBold", 26)
    canvas.drawCentredString(105, 181, "1")
    canvas.setFont("Sukhumvit", 12)
    canvas.drawString(150, 185, "เริ่มจากหมายเลขในภาพ แล้วทำตามขั้นตอนด้านขวาของแต่ละหน้า")
    canvas.setFillColor(colors.HexColor("#8fa7c7"))
    canvas.setFont("Sukhumvit", 9.5)
    canvas.drawString(82, 64, "ฉบับข้อมูลตัวอย่าง - การบันทึกในโหมดตัวอย่างไม่เขียนข้อมูลลงเซิร์ฟเวอร์")
    canvas.showPage()


def draw_checklist(canvas: Canvas, page_number: int) -> None:
    page_header(canvas, 14, "รายการตรวจสอบก่อนจบงาน", page_number)
    checks = [
        "ตรวจชื่อองค์กรและคลังสินค้าก่อนและหลังทำงาน",
        "ตรวจสถานะของเอกสารหรือรายการ ไม่ใช้ข้อความบนปุ่มเป็นหลักฐานเพียงอย่างเดียว",
        "ตรวจจำนวนพร้อมหน่วยนับทุกครั้ง",
        "บันทึกรหัสคำขอเมื่อได้รับข้อความปฏิเสธ เพื่อใช้ติดต่อฝ่ายสนับสนุน",
        "ในโหมดข้อมูลตัวอย่าง ให้ถือผลเป็นการสาธิต เพราะระบบไม่เก็บข้อมูล",
    ]
    y = CONTENT_TOP - 10
    canvas.setFillColor(INK)
    canvas.setFont("SukhumvitMedium", 15)
    canvas.drawString(MARGIN, y, "ก่อนออกจากหน้าจอ ให้ตรวจครบทั้ง 5 ข้อ")
    y -= 42
    for index, check in enumerate(checks, start=1):
        canvas.setStrokeColor(BLUE)
        canvas.setLineWidth(2)
        canvas.roundRect(MARGIN, y - 8, 24, 24, 4, stroke=1, fill=0)
        canvas.setFillColor(RED)
        canvas.circle(MARGIN + 54, y + 4, 14, stroke=0, fill=1)
        canvas.setFillColor(WHITE)
        canvas.setFont("SukhumvitBold", 11)
        canvas.drawCentredString(MARGIN + 54, y, str(index))
        paragraph(canvas, check, MARGIN + 82, y + 14, PAGE_W - MARGIN * 2 - 82, BODY)
        y -= 64

    canvas.setFillColor(colors.HexColor("#fff1ef"))
    canvas.roundRect(MARGIN, 70, PAGE_W - MARGIN * 2, 86, 10, stroke=0, fill=1)
    canvas.setFillColor(RED)
    canvas.setFont("SukhumvitBold", 12)
    canvas.drawString(MARGIN + 16, 128, "สำคัญ")
    paragraph(
        canvas,
        "หากแถบด้านบนระบุว่าเป็นโหมดข้อมูลตัวอย่างในเครื่อง ข้อมูลทั้งหมดเป็นข้อมูลสังเคราะห์และการกดบันทึกจะไม่เปลี่ยนข้อมูลจริง",
        MARGIN + 16,
        119,
        PAGE_W - MARGIN * 2 - 32,
        BODY,
    )
    canvas.showPage()


def main() -> None:
    register_fonts()
    TMP.mkdir(parents=True, exist_ok=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    canvas = Canvas(str(OUTPUT), pagesize=landscape(A4), pageCompression=1)
    canvas.setTitle("คู่มือใช้งาน Industrial SAS แบบมีภาพประกอบ")
    canvas.setAuthor("Industrial SAS")
    canvas.setSubject("คู่มือผู้ปฏิบัติงานพร้อมภาพหน้าจอและกรอบคำแนะนำ")

    draw_cover(canvas)
    for page_number, task in enumerate(TASKS, start=2):
        draw_task_page(canvas, task, page_number)
    draw_checklist(canvas, len(TASKS) + 2)
    canvas.save()
    print(OUTPUT)


if __name__ == "__main__":
    main()
