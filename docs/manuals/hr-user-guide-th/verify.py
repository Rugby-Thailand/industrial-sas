#!/usr/bin/env python3
"""Artifact integrity checks; visual/action reviews are recorded separately."""
from pathlib import Path
import json,hashlib,re,subprocess
from PIL import Image,ImageDraw,ImageChops
from pypdf import PdfReader
from reportlab.pdfbase.ttfonts import TTFont
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[2]
pages=json.loads((ROOT/'pages.json').read_text())
pdf=REPO/'output/pdf/hr-user-guide-th.pdf'
reader=PdfReader(str(pdf)); assert len(reader.pages)==len(pages)
glyphs=TTFont('ThaiCheck',str(ROOT/'assets/fonts/NotoSansThai.ttf')).face.charToGlyph
text=subprocess.check_output(['pdftotext','-layout',str(pdf),'-']).decode()
textpages=text.split('\f')[:len(pages)]
report=[]; all_steps=[]
for page,pdfpage,extracted in zip(pages,reader.pages,textpages):
 content=' '.join([page['title'],page['audience'],page['entry'],*page['steps'],page['expected'],page.get('note','')])
 assert all(glyphs.get(ord(ch)) for ch in content), (page['id'],'unsupported font glyph')
 source=ROOT/page['screenshot']['source'];annotated=ROOT/page['screenshot']['annotated']
 assert source.exists() and annotated.exists()
 assert hashlib.sha256(source.read_bytes()).hexdigest()==page['screenshot']['sha256']
 assert Image.open(source).size==Image.open(annotated).size==tuple(page['screenshot']['pixels'])
 original=Image.open(source).convert('RGB');marked=Image.open(annotated).convert('RGB')
 allowed=Image.new('L',original.size);mask=ImageDraw.Draw(allowed)
 for mark in page['highlights']:
  x,y,w,h=mark['box'];box=[round(x)-4,round(y)-4,round(x+w)+4,round(y+h)+4]
  mask.rectangle(box,fill=255);cx=max(17,box[0]-12);cy=max(17,box[1]-12)
  mask.ellipse([cx-16,cy-16,cx+16,cy+16],fill=255)
 changed=ImageChops.difference(original,marked).convert('L')
 assert ImageChops.multiply(changed,ImageChops.invert(allowed)).getbbox() is None, (page['id'],'changed outside annotation')
 assert Image.open(source).size[0]/Image.open(source).size[1]==1280/800
 assert len(list(pdfpage.images))==1
 assert list(pdfpage.images)[0].image.size==tuple(page['screenshot']['pixels'])
 assert ImageChops.difference(list(pdfpage.images)[0].image.convert('RGB'),marked).getbbox() is None, (page['id'],'pdf screenshot altered')
 assert page['title'] in extracted, (page['id'],'missing title')
 for step in page['steps']:
  assert step in extracted, (page['id'],'missing step')
  all_steps.append(step)
 assert page['expected'] in extracted
 for highlight in page['highlights']:
  x,y,w,h=highlight['box'];vw,vh=page['screenshot']['viewport']
  assert w>0 and h>0 and 0<=x<vw and 0<=y<vh and x+w<=vw and y+h<=vh
  assert highlight.get('label') and highlight.get('selector')
 assert page['verification']['status'] in ['AUTHOR_VERIFIED','INDEPENDENT_VERIFIED']
 report.append({'page':page['number'],'id':page['id'],'source_sha256':page['screenshot']['sha256'],'source_and_annotated_size_equal':True,'pdf_image_size':list(pdfpage.images)[0].image.size,'all_thai_text_present':True,'highlights_in_viewport':True,'manual_visual_review':page['verification'].get('visual'),'manual_action_review':page['verification'].get('action')})
assert len(all_steps)==len(set(all_steps)), 'Duplicated full instruction sentences'
markup=(ROOT/'index.html').read_text()
for src in re.findall(r'(?:src|href)="([^"]+)"',markup):
 if src.startswith(('#','http')):continue
 assert (ROOT/src).exists(), ('missing asset',src)
summary={'page_count':len(pages),'pdf_sha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'html_sha256':hashlib.sha256((ROOT/'index.html').read_bytes()).hexdigest(),'duplicate_instruction_sentences':0,'pages':report}
(REPO/'output/pdf/hr-user-guide-th-integrity.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'page_count':len(pages),'all_integrity_checks':'PASS','duplicate_instruction_sentences':0}))
