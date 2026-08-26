#!/usr/bin/env python3
"""Build the complete Industrial SAS operator manual as a styled PDF."""

from __future__ import annotations

import html
import json
import re
import subprocess
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Flowable,
    Image,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/manuals/full-application-operator-manual.md"
OUTPUT = ROOT / "output/pdf/industrial-sas-full-application-operator-manual.pdf"

NAVY = colors.HexColor("#16324F")
BLUE = colors.HexColor("#1F6FEB")
CYAN = colors.HexColor("#DDF4FF")
INK = colors.HexColor("#17212B")
MUTED = colors.HexColor("#5D6B78")
LINE = colors.HexColor("#D8E1E8")
PALE = colors.HexColor("#F5F8FA")
WHITE = colors.white
CALLOUT = colors.HexColor("#D92D20")
VERSION = "2026-08-26"
TASK_SCREENSHOT_ROOT = ROOT / "docs/manuals/assets/operator-guide-th"
ENGINEERING_SCREENSHOT = (
    ROOT / "docs/manuals/assets/full-application/engineering-designs.png"
)


def inline_markup(value: str) -> str:
    """Convert the small inline Markdown subset used by the manual."""
    escaped = html.escape(value, quote=False)
    escaped = re.sub(r"`([^`]+)`", r'<font name="Courier">\1</font>', escaped)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", escaped)
    return escaped


class ManualDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str, **kwargs):
        super().__init__(filename, **kwargs)
        self._bookmark_counter = 0
        self._outline_root_seen = False

    def beforeDocument(self):  # noqa: N802 - ReportLab callback name
        # multiBuild creates a fresh PDF outline on every pass.
        self._bookmark_counter = 0
        self._outline_root_seen = False

    def afterFlowable(self, flowable):  # noqa: N802 - ReportLab callback name
        if not isinstance(flowable, Paragraph):
            return
        style_name = flowable.style.name
        if style_name not in {"ManualH1", "ManualH2"}:
            return
        level = 0 if style_name == "ManualH1" else 1
        outline_level = level
        if level == 0:
            self._outline_root_seen = True
        elif not self._outline_root_seen:
            # Introductory H2 sections precede the first Part heading. PDF
            # outlines cannot jump directly from the root to level 1.
            outline_level = 0
        text = flowable.getPlainText()
        key = f"heading-{self._bookmark_counter}"
        self._bookmark_counter += 1
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(
            text,
            key,
            level=outline_level,
            closed=outline_level == 0,
        )
        self.notify("TOCEntry", (outline_level, text, self.page, key))


class AnnotatedScreenshot(Flowable):
    """Render a screenshot with vector callout boxes and numbered badges."""

    def __init__(self, path: Path, annotations, max_width=168 * mm, max_height=105 * mm):
        super().__init__()
        self.path = path
        self.annotations = annotations
        self.reader = ImageReader(str(path))
        self.image_width, self.image_height = self.reader.getSize()
        scale = min(max_width / self.image_width, max_height / self.image_height)
        self.width = self.image_width * scale
        self.height = self.image_height * scale
        self.scale = scale

    def draw(self):
        canvas = self.canv
        canvas.drawImage(
            self.reader,
            0,
            0,
            width=self.width,
            height=self.height,
            preserveAspectRatio=True,
            mask="auto",
        )
        canvas.saveState()
        canvas.setStrokeColor(CALLOUT)
        canvas.setLineWidth(max(1.4, 7 * self.scale))
        for annotation in self.annotations:
            x = annotation["x"] * self.scale
            top = annotation["y"] * self.scale
            if annotation["kind"] == "underline":
                y = self.height - top
                canvas.line(x, y, x + annotation["width"] * self.scale, y)
            else:
                width = annotation["width"] * self.scale
                height = annotation["height"] * self.scale
                y = self.height - top - height
                canvas.roundRect(
                    x,
                    y,
                    width,
                    height,
                    max(2, 12 * self.scale),
                    stroke=1,
                    fill=0,
                )

            badge_radius = max(6, 20 * self.scale)
            badge_x = x + badge_radius
            badge_y = self.height - top - badge_radius
            canvas.setFillColor(CALLOUT)
            canvas.setStrokeColor(WHITE)
            canvas.setLineWidth(1.2)
            canvas.circle(badge_x, badge_y, badge_radius, stroke=1, fill=1)
            canvas.setFillColor(WHITE)
            canvas.setFont("Helvetica-Bold", max(7, 20 * self.scale))
            number = str(annotation["step"])
            canvas.drawCentredString(
                badge_x,
                badge_y - max(2.4, 6 * self.scale),
                number,
            )
            canvas.setStrokeColor(CALLOUT)
        canvas.restoreState()


def header_footer(canvas, doc):
    canvas.saveState()
    width, height = A4
    if doc.page > 1:
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(18 * mm, height - 14 * mm, width - 18 * mm, height - 14 * mm)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.setFillColor(NAVY)
        canvas.drawString(18 * mm, height - 10.8 * mm, "INDUSTRIAL SAS")
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(
            width - 18 * mm,
            height - 10.8 * mm,
            "Full Application Operator Manual",
        )
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, 14 * mm, width - 18 * mm, 14 * mm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 9.5 * mm, f"Version {VERSION}")
    canvas.drawRightString(width - 18 * mm, 9.5 * mm, f"Page {doc.page}")
    canvas.restoreState()


def make_styles():
    base = getSampleStyleSheet()
    styles = {
        "cover_title": ParagraphStyle(
            "CoverTitle",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=28,
            leading=32,
            textColor=WHITE,
            alignment=TA_LEFT,
            spaceAfter=8 * mm,
        ),
        "cover_subtitle": ParagraphStyle(
            "CoverSubtitle",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=13,
            leading=18,
            textColor=colors.HexColor("#DCEBFA"),
        ),
        "h1": ParagraphStyle(
            "ManualH1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=20,
            leading=24,
            textColor=NAVY,
            spaceBefore=2 * mm,
            spaceAfter=5 * mm,
            keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "ManualH2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=14.5,
            leading=18,
            textColor=BLUE,
            spaceBefore=5 * mm,
            spaceAfter=2.5 * mm,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "ManualH3",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=10.5,
            leading=14,
            textColor=NAVY,
            spaceBefore=3 * mm,
            spaceAfter=2 * mm,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "ManualBody",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.3,
            leading=13.2,
            textColor=INK,
            spaceAfter=2.4 * mm,
            allowWidows=0,
            allowOrphans=0,
        ),
        "route": ParagraphStyle(
            "Route",
            parent=base["BodyText"],
            fontName="Courier-Bold",
            fontSize=8.6,
            leading=11,
            textColor=NAVY,
            backColor=CYAN,
            borderColor=colors.HexColor("#9BD7F5"),
            borderWidth=0.5,
            borderPadding=(4, 6, 4, 6),
            spaceAfter=3 * mm,
        ),
        "bullet": ParagraphStyle(
            "ManualBullet",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.2,
            leading=12.8,
            textColor=INK,
            leftIndent=0,
            firstLineIndent=0,
            spaceAfter=1.3 * mm,
        ),
        "toc_h": ParagraphStyle(
            "TocHeading",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=26,
            textColor=NAVY,
            spaceAfter=6 * mm,
        ),
        "caption": ParagraphStyle(
            "Caption",
            parent=base["BodyText"],
            fontName="Helvetica-Oblique",
            fontSize=8,
            leading=10,
            alignment=TA_CENTER,
            textColor=MUTED,
            spaceAfter=4 * mm,
        ),
        "small": ParagraphStyle(
            "Small",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.5,
            leading=12,
            textColor=MUTED,
        ),
        "legend_number": ParagraphStyle(
            "LegendNumber",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=11,
            alignment=TA_CENTER,
            textColor=WHITE,
        ),
        "legend_body": ParagraphStyle(
            "LegendBody",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=8.8,
            leading=12,
            textColor=INK,
        ),
    }
    return styles


def load_manual_tasks():
    script = (
        "import { MANUAL_TASKS } from './scripts/manual/tasks.mjs';"
        "process.stdout.write(JSON.stringify(MANUAL_TASKS));"
    )
    result = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def control_legend(entries, styles):
    rows = [
        [
            Paragraph(str(number), styles["legend_number"]),
            Paragraph(inline_markup(description), styles["legend_body"]),
        ]
        for number, description in entries
    ]
    table = Table(rows, colWidths=[10 * mm, 158 * mm], hAlign="CENTER")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), CALLOUT),
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 2.2 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2.2 * mm),
            ]
        )
    )
    return table


ENGINEERING_ANNOTATIONS = [
    {"kind": "rect", "step": 1, "x": 245, "y": 108, "width": 105, "height": 46},
    {"kind": "rect", "step": 2, "x": 458, "y": 108, "width": 105, "height": 46},
    {"kind": "rect", "step": 3, "x": 2290, "y": 276, "width": 132, "height": 48},
    {"kind": "rect", "step": 4, "x": 1250, "y": 330, "width": 68, "height": 58},
    {"kind": "rect", "step": 5, "x": 255, "y": 560, "width": 290, "height": 60},
    {"kind": "rect", "step": 6, "x": 255, "y": 744, "width": 165, "height": 54},
]

ENGINEERING_CONTROLS = [
    (1, "Sales orders - opens the customer-order stage of the order-to-ship workflow."),
    (2, "Factory - opens released factory packets and production handoff work."),
    (3, "Create card - opens the full master-card workspace for a new design draft."),
    (4, "Edit icon - changes the design request priority and due date."),
    (5, "Find similar design - searches approved structured designs for an exact reusable match."),
    (6, "Show revision history - opens the selected master card's immutable revision record."),
]


def visual_control_guide(styles):
    tasks = load_manual_tasks()
    pages = []
    for task in tasks:
        annotated_steps = sorted({one["step"] for one in task["annotations"]})
        pages.append(
            {
                "title": task["title"]["en"],
                "route": task["route"],
                "summary": task["summary"]["en"],
                "path": TASK_SCREENSHOT_ROOT / f'{task["image"]}.png',
                "annotations": task["annotations"],
                "controls": [
                    (number, task["steps"][number - 1]["en"])
                    for number in annotated_steps
                ],
            }
        )

    if ENGINEERING_SCREENSHOT.exists():
        pages.insert(
            1,
            {
                "title": "Engineering design control",
                "route": "/engineering/designs",
                "summary": "Design request triage, master-card creation, editing, reuse, and revision history.",
                "path": ENGINEERING_SCREENSHOT,
                "annotations": ENGINEERING_ANNOTATIONS,
                "controls": ENGINEERING_CONTROLS,
            },
        )

    story = [
        PageBreak(),
        Paragraph("Appendix C - Visual control guide", styles["h1"]),
        Paragraph(
            "Each red square marks an interactive control or work area. The number in the screenshot matches the numbered description below it. Screenshots use sample tenant data; confirm the active organization and warehouse before performing a write.",
            styles["body"],
        ),
    ]
    for index, page in enumerate(pages, start=1):
        if index > 1:
            story.append(PageBreak())
        story.extend(
            [
                Paragraph(
                    f'Visual {index} - {inline_markup(page["title"])}',
                    styles["h2"],
                ),
                Paragraph(f'Route: <font name="Courier">{html.escape(page["route"])}</font>', styles["route"]),
                Paragraph(inline_markup(page["summary"]), styles["body"]),
                AnnotatedScreenshot(page["path"], page["annotations"]),
                Spacer(1, 2 * mm),
                Paragraph(
                    "Numbered controls and work areas",
                    styles["body"],
                ),
                control_legend(page["controls"], styles),
            ]
        )
    return story


SCREENSHOTS = {
    "Page 5 - Owner dashboard": (
        ROOT / "docs/manual-html/assets/images/dashboard.png",
        "Owner dashboard: warehouse context, quick actions, attention, and capacity.",
    ),
    "Page 17 - Items": (
        ROOT / "docs/manual-html/assets/images/items.png",
        "Item register and the create-item form.",
    ),
    "Page 30 - Purchase-order detail": (
        ROOT / "docs/manual-html/assets/images/purchase-order-detail.png",
        "Purchase-order lines, remaining quantities, and receipt opening.",
    ),
    "Page 33 - Quality": (
        ROOT / "docs/manual-html/assets/images/quality.png",
        "Quality queue and controlled disposition workflow.",
    ),
    "Page 34 - Receipt detail": (
        ROOT / "docs/manual-html/assets/images/receipt-detail.png",
        "Receipt-line capture, pallet building, and label evidence.",
    ),
    "Page 36 - Operational reports and exports": (
        ROOT / "docs/manual-html/assets/images/reports.png",
        "Operational report tabs, exception center, and export workflow.",
    ),
    "Page 46 - Operator tasks": (
        ROOT / "docs/manual-html/assets/images/handheld-home.png",
        "Handheld task launcher with touch-sized task choices.",
    ),
}


def screenshot_flowable(path: Path, caption: str, styles):
    if not path.exists():
        return []
    image = Image(str(path))
    max_width = 168 * mm
    max_height = 82 * mm
    scale = min(max_width / image.imageWidth, max_height / image.imageHeight)
    image.drawWidth = image.imageWidth * scale
    image.drawHeight = image.imageHeight * scale
    image.hAlign = "CENTER"
    return [
        Spacer(1, 1.5 * mm),
        image,
        Paragraph(html.escape(caption), styles["caption"]),
    ]


def parse_markdown(source: str, styles):
    story = []
    lines = source.splitlines()
    index = 0
    pending = []

    def flush_paragraph():
        if not pending:
            return
        text = " ".join(part.strip() for part in pending).strip()
        pending.clear()
        if text:
            style = styles["route"] if text.startswith("Route: ") else styles["body"]
            story.append(Paragraph(inline_markup(text), style))

    while index < len(lines):
        raw = lines[index]
        stripped = raw.strip()

        if not stripped:
            flush_paragraph()
            index += 1
            continue

        if stripped.startswith("# "):
            flush_paragraph()
            title = stripped[2:]
            if story and not title.startswith("Part I -"):
                story.append(PageBreak())
            story.append(Paragraph(inline_markup(title), styles["h1"]))
            index += 1
            continue

        if stripped.startswith("### "):
            flush_paragraph()
            story.append(Paragraph(inline_markup(stripped[4:]), styles["h3"]))
            index += 1
            continue

        if stripped.startswith("## "):
            flush_paragraph()
            title = stripped[3:]
            story.append(Paragraph(inline_markup(title), styles["h2"]))
            if title in SCREENSHOTS:
                path, caption = SCREENSHOTS[title]
                story.extend(screenshot_flowable(path, caption, styles))
            index += 1
            continue

        markdown_image = re.match(r"^!\[[^]]*\]\(([^)]+)\)$", stripped)
        if markdown_image:
            flush_paragraph()
            target = markdown_image.group(1)
            if target.endswith("engineering-designs-annotated.svg"):
                story.extend(
                    [
                        AnnotatedScreenshot(
                            ENGINEERING_SCREENSHOT,
                            ENGINEERING_ANNOTATIONS,
                            max_height=72 * mm,
                        ),
                        Paragraph(
                            "Engineering design controls. Red squares match the numbered list below.",
                            styles["caption"],
                        ),
                    ]
                )
            index += 1
            continue

        numbered = re.match(r"^(\d+)\.\s+(.*)$", stripped)
        bullet = re.match(r"^-\s+(.*)$", stripped)
        if numbered or bullet:
            flush_paragraph()
            items = []
            ordered = numbered is not None
            while index < len(lines):
                current = lines[index].strip()
                match = re.match(r"^(\d+)\.\s+(.*)$", current) if ordered else re.match(r"^-\s+(.*)$", current)
                if match is None:
                    break
                text = match.group(2) if ordered else match.group(1)
                items.append(ListItem(Paragraph(inline_markup(text), styles["bullet"])))
                index += 1
            story.append(
                ListFlowable(
                    items,
                    bulletType="1" if ordered else "bullet",
                    start="1",
                    leftIndent=6 * mm,
                    bulletFontName="Helvetica-Bold",
                    bulletFontSize=8.5,
                    bulletColor=BLUE,
                    spaceAfter=2 * mm,
                )
            )
            continue

        pending.append(stripped)
        index += 1

    flush_paragraph()
    return story


def cover(styles):
    title_block = Table(
        [
            [Paragraph("INDUSTRIAL SAS", styles["cover_subtitle"])],
            [Paragraph("Full Application<br/>Operator Manual", styles["cover_title"])],
            [
                Paragraph(
                    "Every desktop and handheld page, from sign-in and setup through inbound, inventory, production, fulfillment, transport, HR, and administration.",
                    styles["cover_subtitle"],
                )
            ],
        ],
        colWidths=[170 * mm],
        rowHeights=[15 * mm, 49 * mm, 36 * mm],
    )
    title_block.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), NAVY),
                ("BOX", (0, 0), (-1, -1), 0, NAVY),
                ("LEFTPADDING", (0, 0), (-1, -1), 12 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 5 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5 * mm),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    facts = Table(
        [
            ["Version", VERSION],
            ["Route coverage", "53 source route pages"],
            ["Languages", "English and Thai application routes"],
            ["Audience", "Operators, supervisors, planners, and administrators"],
        ],
        colWidths=[38 * mm, 125 * mm],
    )
    facts.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), CYAN),
                ("TEXTCOLOR", (0, 0), (0, -1), NAVY),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
            ]
        )
    )
    return [
        Spacer(1, 18 * mm),
        title_block,
        Spacer(1, 18 * mm),
        facts,
        Spacer(1, 12 * mm),
        Paragraph(
            "Operational reminder: always confirm organization, warehouse, status, and physical evidence before committing a write.",
            styles["small"],
        ),
        PageBreak(),
    ]


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    styles = make_styles()
    doc = ManualDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=19 * mm,
        bottomMargin=18 * mm,
        title="Industrial SAS Full Application Operator Manual",
        author="Industrial SAS",
        subject="Operator instructions for every application route",
    )
    frame = Frame(
        doc.leftMargin,
        doc.bottomMargin,
        doc.width,
        doc.height,
        id="content",
        leftPadding=0,
        rightPadding=0,
        topPadding=2 * mm,
        bottomPadding=0,
    )
    doc.addPageTemplates([PageTemplate(id="manual", frames=[frame], onPage=header_footer)])

    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle(
            "TOC1",
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=11,
            leftIndent=0,
            firstLineIndent=0,
            textColor=NAVY,
            spaceBefore=2,
        ),
        ParagraphStyle(
            "TOC2",
            fontName="Helvetica",
            fontSize=7.7,
            leading=9.8,
            leftIndent=8 * mm,
            firstLineIndent=0,
            textColor=INK,
        ),
    ]

    source = SOURCE.read_text(encoding="utf-8")
    # The cover owns the document title and metadata; avoid duplicating them in body.
    body_start = source.index("## Document purpose")
    body = source[body_start:]
    story = cover(styles)
    story.extend(
        [
            Paragraph("Contents", styles["toc_h"]),
            Paragraph(
                "Page numbers are generated from the current manual build.",
                styles["small"],
            ),
            Spacer(1, 4 * mm),
            toc,
            PageBreak(),
        ]
    )
    story.extend(parse_markdown(body, styles))
    story.extend(visual_control_guide(styles))
    doc.multiBuild(story)
    print(OUTPUT)


if __name__ == "__main__":
    build()
