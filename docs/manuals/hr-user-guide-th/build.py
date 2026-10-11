#!/usr/bin/env python3
"""Render the verified JSON guide. Full source screenshots are never cropped."""
from pathlib import Path
import json, hashlib, html, shutil
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
PAGES = json.loads((ROOT/'pages.json').read_text())
OUT = REPO/'output/pdf/hr-user-guide-th.pdf'
OUT.parent.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(TTFont('Thai',str(ROOT/'assets/fonts/NotoSansThai.ttf'),shapable=True))
W,H = 1200,1040
blue='#155eef'; ink='#172b4d'; muted='#516176'
styles = {
 'title':ParagraphStyle('title',fontName='Thai',fontSize=26,leading=34,textColor=HexColor(ink),shaping=True),
 'body':ParagraphStyle('body',fontName='Thai',fontSize=14,leading=21,textColor=HexColor(ink),shaping=True),
 'meta':ParagraphStyle('meta',fontName='Thai',fontSize=11,leading=16,textColor=HexColor(muted),shaping=True),
}
def para(c,txt,x,y,width,style):
 p=Paragraph(html.escape(txt),styles[style]); pw,ph=p.wrap(width,1000)
 c._code.append('/Span << /ActualText <FEFF' + txt.encode('utf-16-be').hex() + '> >> BDC')
 p.drawOn(c,x,y-ph)
 c._code.append('EMC')
 return y-ph

def annotate(page):
 source=ROOT/page['screenshot']['source']
 im=Image.open(source).convert('RGB')
 w,h=im.size
 if (w,h)!=tuple(page['screenshot']['pixels']): raise ValueError(f"size changed {source}")
 if hashlib.sha256(source.read_bytes()).hexdigest()!=page['screenshot']['sha256']: raise ValueError(f"hash changed {source}")
 d=ImageDraw.Draw(im)
 f=ImageFont.truetype(str(ROOT/'assets/fonts/NotoSansThai.ttf'),22)
 sx=w/page['screenshot']['viewport'][0]; sy=h/page['screenshot']['viewport'][1]
 for mark in page['highlights']:
  x,y,bw,bh=mark['box']; box=[round(x*sx)-4,round(y*sy)-4,round((x+bw)*sx)+4,round((y+bh)*sy)+4]
  if box[0]<0 or box[1]<0 or box[2]>w or box[3]>h: raise ValueError(f"highlight out of bounds {page['id']}")
  d.rounded_rectangle(box,radius=7,outline=blue,width=4)
  cx=max(17,box[0]-12); cy=max(17,box[1]-12)
  d.ellipse([cx-16,cy-16,cx+16,cy+16],fill=blue,outline='white',width=2)
  d.text((cx,cy),str(mark['number']),font=f,fill='white',anchor='mm')
 dest=ROOT/'assets/annotated'/f"{page['number']:02}-{page['id']}.png"
 im.save(dest)
 page['screenshot']['annotated']=str(dest.relative_to(ROOT))
 return dest

c=canvas.Canvas(str(OUT),pagesize=(W,H))
c.setTitle('คู่มือ HR - ทำงานทีละขั้น');c.setAuthor('Industrial SAS')
nav=[]; articles=[]
for page in PAGES:
 if page['verification']['status'] not in ['CONTENT_VERIFIED','AUTHOR_VERIFIED','INDEPENDENT_VERIFIED']: raise ValueError(f"page content not verified {page['id']}")
 img=annotate(page)
 c.setFillColor(HexColor('#eef4ff')); c.rect(0,H-94,W,94,stroke=0,fill=1)
 para(c,f"{page['number']:02}  {page['title']}",36,H-20,W-180,'title')
 para(c,f"สำหรับ {page['audience']}  ·  {page['entry']}",36,H-62,W-90,'meta')
 iw,ih=page['screenshot']['pixels']; displayw=W-72; displayh=displayw*ih/iw
 imageTop=H-112; imageY=imageTop-displayh
 c.drawImage(str(img),36,imageY,width=displayw,height=displayh,preserveAspectRatio=True,mask='auto')
 cursor=imageY-14
 for index,step in enumerate(page['steps'],1):
  cursor=para(c,f"{index}. {step}",36,cursor,W-72,'body')-4
 cursor=para(c,f"ผลที่ควรเห็น: {page['expected']}",36,cursor-3,W-72,'meta')
 if page.get('note'): cursor=para(c,page['note'],36,cursor-5,W-72,'meta')
 if cursor < 32: raise ValueError(f"page overflow {page['id']} {cursor}")
 c.setStrokeColor(HexColor('#d9e2ef'));c.line(36,28,W-36,28)
 para(c,'คู่มือ HR · ภาพจากแอปจริง · กรอบเลขชี้ตำแหน่งที่ใช้',36,22,W-200,'meta')
 c.setFont('Thai',10);c.setFillColor(HexColor(muted));c.drawRightString(W-36,9,f"{page['number']} / {len(PAGES)}")
 c.showPage()
 nav.append(f'<a href="#{page["id"]}">{page["number"]:02} {html.escape(page["title"])}</a>')
 steps=''.join(f'<li>{html.escape(x)}</li>' for x in page['steps'])
 note=f'<p class="note">{html.escape(page["note"])}</p>' if page.get('note') else ''
 articles.append(f'''<article id="{page['id']}"><div class="page-heading"><span class="tag">{page['number']:02} / {len(PAGES)}</span><h2>{html.escape(page['title'])}</h2><p>สำหรับ {html.escape(page['audience'])} · {html.escape(page['entry'])}</p></div><figure><img src="{page['screenshot']['annotated']}" alt="{html.escape(page['title'])}: หน้าจอเต็มพร้อมกรอบหมายเลข" width="{iw}" height="{ih}"><figcaption>ภาพหน้าจอเต็ม ไม่ครอปหรือซูม · <a href="{page['screenshot']['source']}" download>ดาวน์โหลดภาพต้นฉบับ</a></figcaption></figure><ol>{steps}</ol><p class="expected"><strong>ผลที่ควรเห็น:</strong> {html.escape(page['expected'])}</p>{note}</article>''')
c.save()
htmlout='''<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>คู่มือ HR - ทำงานทีละขั้น</title><style>@font-face{font-family:Thai;src:url(assets/fonts/NotoSansThai.ttf)}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f3f6fb;color:#172b4d;font-family:Thai,sans-serif;line-height:1.65}header,main{max-width:1280px;margin:auto}header{padding:40px 24px 20px}h1{margin:0;font-size:32px}header p{max-width:750px}.nav{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0}.nav a{background:#fff;border:1px solid #d9e2ef;border-radius:8px;padding:6px 12px;color:#155eef;text-decoration:none}article{background:white;margin:20px 0 40px;border:1px solid #d9e2ef;border-radius:16px;overflow:hidden;scroll-margin-top:20px}.page-heading{background:#eef4ff;padding:20px 28px}.page-heading h2{margin:2px 0;font-size:28px}.page-heading p{margin:0;color:#516176}.tag{color:#155eef;font-size:13px;font-weight:bold}figure{margin:20px 24px 12px}img{display:block;width:100%;height:auto;border:1px solid #d9e2ef}figcaption{font-size:12px;color:#516176;margin-top:6px}ol{margin:12px 24px 18px;padding-left:30px;font-size:18px}li{padding:3px 0}.expected,.note{margin:12px 28px 22px}.expected{background:#f4f8ff;padding:12px 16px;border-left:3px solid #155eef}.note{font-size:14px;color:#516176}a{color:#155eef}footer{padding:20px 28px;color:#516176;font-size:12px}@media(max-width:700px){header{padding:24px 16px}h1{font-size:28px}main{padding:0 8px}.page-heading{padding:16px}.page-heading h2{font-size:24px}figure{margin:12px 8px}ol{margin:12px 16px;font-size:16px}.expected,.note{margin:12px 16px}article{border-radius:10px}}@media print{body{background:white}header,.nav,figcaption{display:none}article{page-break-after:always;border:none;margin:0}}</style></head><body><header><h1>คู่มือ HR</h1><p>เลือกงานที่ต้องทำ แล้วทำตามเลขบนภาพ หนึ่งหน้าครอบคลุมหนึ่งงาน ปุ่มและข้อมูลอาจต่างกันตามสิทธิ์ของคุณ</p><div class="nav">''' + ''.join(nav)+'''</div></header><main>'''+''.join(articles)+'''</main><footer>ฉบับวันที่ 10 ตุลาคม 2569 · ใช้ข้อมูลตัวอย่างในระบบทดสอบ · ภาพเก็บเต็มหน้าจอ 1280 × 800 โดยไม่ครอปหรือซูม</footer></body></html>'''
(ROOT/'index.html').write_text(htmlout)
(ROOT/'pages.json').write_text(json.dumps(PAGES,ensure_ascii=False,indent=2)+'\n')
print(f"Created {OUT} ({len(PAGES)} pages) and {ROOT/'index.html'}")
