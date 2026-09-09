#!/usr/bin/env python3
"""Render a self-contained, expanded screenshot manual from manifest.json."""

import argparse
import base64
import html
import json
import mimetypes
from pathlib import Path


def esc(value):
    return html.escape(str(value), quote=True)


def positive(value, field):
    number = float(value)
    if not 0 < number < float("inf"):
        raise ValueError(f"{field} must be a positive finite number")
    return number


def render(manifest, base):
    chapters = manifest["chapters"]
    title = manifest.get("title", "คู่มือใช้งาน Storage Planner")
    subtitle = manifest.get("subtitle", "ดูภาพและทำตามทีละขั้นตอน กรอบสีแดงแสดงตำแหน่งที่ต้องใช้งาน")
    generated = manifest.get("date", "")
    toc, sections, seen = [], [], {"manual"}
    count = 0
    for chapter_number, chapter in enumerate(chapters, 1):
        chapter_id = str(chapter["id"])
        if chapter_id in seen:
            raise ValueError(f"Duplicate id: {chapter_id}")
        seen.add(chapter_id)
        toc.append(f'<a href="#{esc(chapter_id)}"><span>{chapter_number:02}</span>{esc(chapter["title"])}</a>')
        steps = []
        for step_number, step in enumerate(chapter["steps"], 1):
            step_id = str(step["id"])
            if step_id in seen:
                raise ValueError(f"Duplicate id: {step_id}")
            seen.add(step_id)
            count += 1
            image_path = (base / step["image"]).resolve()
            mime = mimetypes.guess_type(image_path.name)[0]
            if mime not in ("image/png", "image/jpeg", "image/webp", "image/gif"):
                raise ValueError(f"Unsupported screenshot format: {image_path}")
            source = "data:" + mime + ";base64," + base64.b64encode(image_path.read_bytes()).decode("ascii")
            width = positive(step["width"], "width")
            height = positive(step["height"], "height")
            marks, legend = [], []
            for mark_number, mark in enumerate(step.get("marks", []), 1):
                x, y = float(mark["x"]), float(mark["y"])
                mw, mh = positive(mark["width"], "mark width"), positive(mark["height"], "mark height")
                if not (0 <= x < width and 0 <= y < height and x + mw <= width + 1 and y + mh <= height + 1):
                    raise ValueError(f"Mark outside screenshot: {step_id}, mark {mark_number}")
                label = str(mark.get("label", "")).strip()
                style = f"left:{x / width * 100:.5f}%;top:{y / height * 100:.5f}%;width:{mw / width * 100:.5f}%;height:{mh / height * 100:.5f}%"
                marks.append(f'<span class="mark" style="{style}" aria-hidden="true"><b>{mark_number}</b></span>')
                if label and not label.isdecimal():
                    legend.append(f'<li><span class="legend-number">{mark_number}</span><span>{esc(label)}</span></li>')
            result = f'<p class="result"><strong>ผลที่ควรเห็น</strong> {esc(step["result"])}</p>' if step.get("result") else ""
            note = f'<aside class="note"><strong>ข้อควรรู้</strong> {esc(step["note"])}</aside>' if step.get("note") else ""
            caption = '<ol class="legend">' + "".join(legend) + '</ol>' if legend else ""
            screenshot_class = "screenshot portrait" if width <= 600 and height > width else "screenshot"
            screenshot_style = f"--print-image-width:{145 * width / height:.3f}mm"
            steps.append(f'''<article class="step" id="{esc(step_id)}">
              <header class="step-header"><span class="step-number">{chapter_number}.{step_number}</span><h3>{esc(step["title"])}</h3></header>
              <p class="instruction">{esc(step["instruction"])}</p>
              <figure><div class="{screenshot_class}" style="{screenshot_style}"><img src="{source}" width="{int(width)}" height="{int(height)}" alt="{esc(step.get('alt', step['title']))}" decoding="async">{"".join(marks)}</div><figcaption>{caption}</figcaption></figure>
              {result}{note}
            </article>''')
        intro = f'<p>{esc(chapter["intro"])}</p>' if chapter.get("intro") else ""
        sections.append(f'''<section class="chapter" id="{esc(chapter_id)}"><header class="chapter-header"><span class="eyebrow">หัวข้อ {chapter_number:02}</span><h2>{esc(chapter["title"])}</h2>{intro}</header>{"".join(steps)}</section>''')
    date = f'<span>อัปเดต {esc(generated)}</span>' if generated else ""
    return f'''<!doctype html>
<html lang="{esc(manifest.get('lang', 'th'))}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>{esc(title)}</title>
<style>
*{{box-sizing:border-box}}html{{scroll-behavior:smooth;scroll-padding-top:24px}}body{{margin:0;background:#f5f6f8;color:#172b3a;font-family:Tahoma,"Noto Sans Thai",system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.7}}a{{color:inherit}}.skip{{position:fixed;top:-100px;left:16px;background:white;padding:12px;z-index:10}}.skip:focus{{top:12px}}.hero{{background:#fff;border-bottom:1px solid #dce3e9;padding:40px max(28px,calc((100vw - 1580px)/2)) 32px}}.eyebrow{{color:#486c82;font-size:12px;font-weight:bold;letter-spacing:.06em}}h1,h2,h3,p{{margin:0}}h1{{font-size:clamp(26px,3.3vw,42px);line-height:1.35;margin:10px 0 14px;letter-spacing:-.025em}}.hero p{{max-width:860px;color:#536775}}.meta{{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px;color:#617381;font-size:13px}}.meta span{{background:#edf2f6;border-radius:30px;padding:4px 12px}}.layout{{display:grid;grid-template-columns:240px minmax(0,1fr);gap:36px;max-width:1580px;margin:0 auto;padding:32px 28px 72px}}.toc{{position:sticky;top:24px;align-self:start;max-height:calc(100vh - 48px);overflow:auto;padding-right:5px}}.toc h2{{font-size:14px;margin:0 0 12px 10px}}.toc a{{display:flex;gap:10px;text-decoration:none;padding:9px 10px;border-radius:8px;font-size:13px;line-height:1.55;transition:background .15s}}.toc a span{{color:#7290a3;flex:none;font-variant-numeric:tabular-nums}}.toc a:hover,.toc a:focus-visible{{background:#e5edf3;color:#143b55}}main{{min-width:0}}.chapter{{margin-bottom:64px;scroll-margin-top:24px}}.chapter-header{{margin-bottom:24px}}h2{{font-size:26px;line-height:1.4;margin-top:6px}}.chapter-header p{{color:#586d7c;margin-top:10px;max-width:920px}}.step{{background:#fff;border:1px solid #dce3e9;border-radius:14px;padding:24px;margin:0 0 24px;scroll-margin-top:24px;box-shadow:0 3px 12px #1e364b04}}.step-header{{display:flex;align-items:baseline;gap:12px}}.step-number{{flex:none;color:#2f5c77;background:#eaf2f7;border-radius:7px;padding:3px 9px;font-size:13px;font-weight:bold}}h3{{font-size:20px;line-height:1.5}}.instruction{{margin:12px 0 20px;white-space:pre-line}}figure{{margin:0}}.screenshot{{position:relative;width:100%;line-height:0;border-radius:8px;background:#0b1217;overflow:hidden}}.screenshot.portrait{{max-width:430px;margin-inline:auto}}.screenshot img{{display:block;width:100%;height:auto}}.mark{{position:absolute;display:block;border:3px solid #ff2929;box-shadow:0 0 0 1px #fff9,inset 0 0 0 1px #fff5;pointer-events:none}}.mark b{{position:absolute;left:-2px;top:-2px;display:flex;align-items:center;justify-content:center;background:#e60017;color:white;border:1px solid #fff;border-radius:50%;width:24px;height:24px;line-height:1;font-size:12px;font-family:system-ui,sans-serif;box-shadow:0 1px 3px #0005}}.legend{{display:flex;gap:10px 22px;flex-wrap:wrap;list-style:none;margin:14px 0 0;padding:0;font-size:13px;color:#3d5261}}.legend li{{display:flex;gap:8px;align-items:flex-start}}.legend-number{{display:inline-flex;align-items:center;justify-content:center;width:21px;height:21px;flex:none;margin-top:1px;background:#e60017;color:white;border-radius:50%;font:11px/1 system-ui,sans-serif}}.result{{margin-top:20px;padding:12px 14px;background:#eff8f3;border-radius:8px;color:#285741;font-size:14px;white-space:pre-line}}.result strong,.note strong{{margin-right:6px}}.note{{margin-top:12px;padding:12px 14px;border-left:3px solid #dfad44;background:#fff9ea;color:#6b552b;font-size:14px;white-space:pre-line}}.footer{{border-top:1px solid #dce3e9;padding-top:20px;color:#607685;font-size:13px}}a:focus-visible{{outline:3px solid #3279b4;outline-offset:3px}}
@media(min-width:1850px){{.layout{{max-width:1800px;grid-template-columns:250px minmax(0,1fr)}}}}
@media(max-width:1050px){{.layout{{grid-template-columns:1fr;gap:28px;padding:24px 20px}}.toc{{position:static;max-height:none;overflow:visible;padding:0}}.toc nav{{display:flex;flex-wrap:wrap;gap:6px}}.toc a{{border:1px solid #dce3e9;background:white}}.toc h2{{margin-left:0}}.hero{{padding:28px 20px}}}}
@media(max-width:600px){{body{{font-size:15px}}.layout{{padding:20px 10px 48px}}.hero{{padding:24px 18px}}.step{{padding:16px 12px;border-radius:10px}}h2{{font-size:23px}}h3{{font-size:18px}}.step-header{{gap:8px}}.instruction{{margin-bottom:15px}}.mark{{border-width:2px}}.mark b{{width:17px;height:17px;font-size:9px}}.chapter{{margin-bottom:44px}}.toc a{{font-size:12px;padding:7px 9px}}.legend{{gap:8px 14px}}}}
@media(prefers-reduced-motion:reduce){{html{{scroll-behavior:auto}}}}
@media print{{@page{{size:A4 landscape;margin:12mm}}html{{scroll-behavior:auto}}body{{background:white;font-size:11px;-webkit-print-color-adjust:exact;print-color-adjust:exact}}.skip,.toc{{display:none}}.hero{{padding:0 0 16px}}h1{{font-size:27px}}.layout{{display:block;padding:16px 0;max-width:none}}.chapter{{margin-bottom:28px;break-before:page}}.chapter:first-child{{break-before:auto}}.chapter-header{{break-after:avoid}}h2{{font-size:22px}}h3{{font-size:16px}}.step{{padding:14px;box-shadow:none;break-inside:avoid;margin-bottom:18px}}.instruction{{margin:8px 0 12px}}.result,.note{{font-size:11px;padding:8px 10px;margin-top:10px}}.legend{{font-size:10px;margin-top:8px}}.screenshot,.screenshot.portrait{{width:min(100%,var(--print-image-width));max-width:none;margin:auto}}.screenshot img{{width:100%;height:auto}}.mark{{border-width:2px}}.mark b{{width:17px;height:17px;font-size:9px}}a{{text-decoration:none}}}}
</style></head>
<body><a class="skip" href="#manual">ข้ามไปยังคู่มือ</a><header class="hero"><span class="eyebrow">STORAGE PLANNER · คู่มือจากหน้าจอจริง</span><h1>{esc(title)}</h1><p>{esc(subtitle)}</p><div class="meta"><span>{len(chapters)} หัวข้อ</span><span>{count} ขั้นตอน</span><span>ภาพทั้งหมดแสดงทันที ไม่ต้องคลิกเปิด</span>{date}</div></header>
<div class="layout"><aside class="toc" aria-label="สารบัญ"><h2>เลือกหัวข้อ</h2><nav>{"".join(toc)}</nav></aside><main id="manual" tabindex="-1">{"".join(sections)}<footer class="footer">ภาพแสดงอยู่ในไฟล์ HTML นี้ทั้งหมด สามารถเปิดอ่านแบบออฟไลน์ หรือใช้เมนูพิมพ์ของเบราว์เซอร์เพื่อบันทึกเป็น PDF</footer></main></div></body></html>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", nargs="?", type=Path, default=Path(__file__).with_name("manifest.json"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    output = args.output or args.manifest.with_name("index.html")
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    document = render(manifest, args.manifest.resolve().parent)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(document, encoding="utf-8")
    print(f"Wrote {output.resolve()} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
