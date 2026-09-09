#!/usr/bin/env python3
"""Build a short feature guide from real, unchanged manual screenshots."""
import copy,importlib.util,json
from pathlib import Path
root=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('manual_renderer',root/'generate-manual.py')
renderer=importlib.util.module_from_spec(spec);spec.loader.exec_module(renderer)
source=json.loads((root/'manifest.json').read_text())
byid={s['id']:s for ch in source['chapters'] for s in ch['steps']}
def step(source_id,new_id,title,instruction,marks=None,result=None,note=None):
 s=copy.deepcopy(byid[source_id]);s.update(id=new_id,title=title,instruction=instruction,alt=title+' — ภาพจริงพร้อมกรอบแดงชี้จุดสำคัญ')
 s.pop('note',None);s.pop('result',None)
 if marks is not None:s['marks']=marks
 if result:s['result']=result
 if note:s['note']=note
 return s
def mark(x,y,w,h,label):return dict(x=x,y=y,width=w,height=h,label=label)
steps=[
step('08-03','where','ของชิ้นนี้ควรเก็บตรงไหน?',
 '① เลือก Location จากรายการด้านซ้าย ② อ่านอาคาร ชั้น และพิกัดจุดวางด้านขวา ③ ดูเหตุผลว่าตำแหน่งนี้วางได้อย่างไร',
 [mark(248,441,222,122,'Location ที่เลือก'),mark(1418,406,271,155,'อาคาร → ชั้น → Location + X/Y/Z'),mark(1420,847,266,125,'ขนาดพอดี · สูงพอ · ไม่ทับตำแหน่งเดิม')],
 'ตัวอย่าง: พาเลท 0.8 × 0.8 × 0.5 ม. → MANUAL-BLDG → ชั้น 1 → โซน FG คู่มือ → X 0.5 / Y 0.5 / Z 0 ม.',
 'ถ้าเงื่อนไขจัดเก็บยังไม่ระบุ ระบบจะแจ้งให้ตรวจความเหมาะสมเอง ตำแหน่งที่วางพอดีไม่ได้แปลว่าผ่านเงื่อนไขสินค้าทุกอย่างแล้ว'),
step('08-01','start','เริ่มจากหน่วยที่วัดขนาดแล้ว',
 'เปิดหน่วยจัดเก็บ ตรวจขนาดภายนอกจริง แล้วกดแนะนำพื้นที่ ถ้าขนาดผิด ใช้ปุ่มวัดขนาดพาเลทเพื่อแก้ก่อนขอคำแนะนำ',
 result='ระบบใช้ขนาดของหน่วยนี้ช่วยหาตำแหน่งที่วางได้'),
step('08-03','adjust','ปรับจุดวางให้ตรงกับหน้างาน',
 'ลากของในภาพ หรือกรอก X/Y เพื่อเลือกจุดย่อยภายใน Location ใช้ 2D ดูพื้นที่จากด้านบน และ 3D ดูระดับสูง หมุนพาเลท 90° เมื่อต้องการเปลี่ยนทิศทาง',
 [mark(1425,688,258,68,'ตำแหน่ง X/Y'),mark(1203.625,398,167.375,58,'มุมมอง 2D / 3D'),mark(615,477,98.375,48,'หมุนพาเลท 90°')],
 result='เห็นตำแหน่งจริงที่จะวางก่อนจอง กดคืนค่าที่แนะนำเพื่อกลับไปใช้พิกัดที่ระบบเสนอ',
 note='X/Y อ้างอิงจุดเริ่มต้นภายใน Location; Z คือระดับฐาน หน่วยเป็นเมตร ปุ่มหมุนมุมมองเปลี่ยนเฉพาะกล้อง'),
step('08-04','cannot-fit','ถ้าวางไม่ได้ ให้ดูเหตุผลแล้วแก้จุดนั้น',
 'ตัวอย่างนี้ X = 4 ทำให้พาเลทล้ำขอบพื้นที่ จึงมีขอบและข้อความเตือนสีแดง พร้อมปิดปุ่มยืนยัน แก้ X/Y ลากกลับเข้าเขต หมุนพาเลท หรือเลือก Location อื่น',
 [mark(510,922,850,73,'เหตุผล: พาเลทอยู่นอกขอบเขต'),mark(1425,708,123,48,'แก้ตำแหน่ง X'),mark(1425,836,258,48,'ยังยืนยันไม่ได้')],
 result='ดำเนินการต่อเมื่อข้อผิดพลาดของตำแหน่งถูกแก้แล้ว'),
step('08-05','reserve','พอใจตำแหน่งแล้ว ค่อยจอง',
 'กดยืนยันจุดจัดเก็บเพื่อเปิดหน้าต่างนี้ ตรวจอาคาร ชั้น Location และพิกัดอีกครั้ง แล้วกดจองจุดนี้ หากไม่ตรงให้กลับไปแก้ไข',
 result='หลังจอง ให้นำของไปวางตามพิกัด ตรวจ QR ปลายทาง แล้วจึงยืนยันว่าจัดเก็บแล้ว',
 note='การดูคำแนะนำยังไม่จองพื้นที่ และการจองยังไม่ใช่การยืนยันว่าของวางจริงแล้ว')]
manifest={'title':'ของควรเก็บตรงไหน?','subtitle':'คู่มือไฮไลต์เฉพาะฟีเจอร์แนะนำที่จัดเก็บ — รู้ว่าควรเลือกพื้นที่ไหน วางตรงจุดใด และเพราะอะไร','date':'7 กันยายน 2026','lang':'th','chapters':[{'id':'recommendation','title':'แนะนำ Location พร้อมตำแหน่งวางจริง','intro':'เปิดหน่วยที่วัดขนาดแล้ว → แนะนำพื้นที่ → เลือกและปรับจุดวาง → ตรวจสอบ → จอง','steps':steps}]}
(root/'recommendation-highlight.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
doc=renderer.render(manifest,root)
css='''<style>.toc{display:none}.layout{display:block;max-width:1320px;padding-top:28px}.hero{padding:36px max(28px,calc((100vw - 1264px)/2)) 28px}.hero h1{font-size:clamp(32px,4.5vw,54px)}.hero p{font-size:18px;max-width:1050px}.chapter-header{margin-bottom:22px}.step-number{font-size:15px}.step{margin-bottom:32px}.instruction{font-size:17px;line-height:1.8}.meta span:first-child{display:none}@media(max-width:600px){.instruction{font-size:15px}.hero p{font-size:16px}.layout{padding:20px 10px}.hero{padding:26px 18px}}@media print{.hero{padding:0}.layout{padding:16px 0}.instruction{font-size:11px}}</style>'''
doc=doc.replace('</head>',css+'</head>')
(root/'recommendation-highlight.html').write_text(doc)
print('Created 5 focused screenshots:',root/'recommendation-highlight.html')
