"""Refresh affected manual steps from the September 8 verified browser evidence.
Run after assemble-manifest.py or build-recommendation-highlight.py.
"""
import importlib.util,json,re,shutil,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
proof=root.parents[2]/'artifacts/ui-simplification-2026-09-08'
spec=importlib.util.spec_from_file_location('manual_renderer',root/'generate-manual.py')
renderer=importlib.util.module_from_spec(spec);spec.loader.exec_module(renderer)
target=root/'screenshots/simplification-2026-09-08';target.mkdir(exist_ok=True)
def screenshot(name):
 source=proof/name
 dest=target/source.name
 shutil.copyfile(source,dest)
 info=subprocess.check_output(['sips','-g','pixelWidth','-g','pixelHeight',str(dest)],text=True)
 width=int(re.search(r'pixelWidth: (\d+)',info)[1]);height=int(re.search(r'pixelHeight: (\d+)',info)[1])
 return {'image':str(dest.relative_to(root)),'width':width,'height':height,'marks':[]}
placement=screenshot('manual-placement.jpg');placement['marks']=json.loads((proof/'manual-placement-marks.json').read_text())
verification=screenshot('manual-verification.jpg');verification['marks']=json.loads((proof/'manual-verification-marks.json').read_text())
move=screenshot('manual-move.jpg');move['marks']=json.loads((proof/'manual-move-marks.json').read_text())
invalid=screenshot('frames/013.jpg');wrong=screenshot('mobile-en-verification.jpg');correct=screenshot('frames/019.jpg')
texts={
'08-02':(placement,'ค้นหาและเลือก Location','พิมพ์ชื่ออาคาร จุดจัดเก็บ หรือชั้นวาง แล้วเลือกจุดที่ต้องการ ช่องค้นหาใช้รูปแบบเดียวกันกับหน้าย้าย'),
'08-03':(placement,'กำหนดตำแหน่งและแก้ขนาดได้ตรงนี้','ตรวจอาคาร ชั้น Location และ X/Y/Z ข้างภาพ ปรับ X/Y หรือลากหน่วยในภาพ 2D/3D หากขนาดผิด กด Edit measurements เพื่อแก้เฉพาะหน่วยนี้ เมื่อปิดโดยไม่มีการแทนที่หน่วย ระบบกลับมาที่ Location พิกัด และมุมมองเดิมโดยอัตโนมัติ'),
'08-04':(invalid,'ตำแหน่งสีแดงหมายถึงวางไม่ได้','แก้พิกัดที่ล้ำขอบหรือชนตำแหน่งอื่นก่อนจอง ระบบเก็บค่าที่ผิดไว้ให้แก้ พร้อมเหตุผลและปิดปุ่มจอง'),
'08-05':(placement,'จองจากภาพและสรุปในหน้าเดียว','ตรวจปลายทางและพิกัดในหน้านี้ แล้วกด Reserve this position / จองตำแหน่งนี้ ได้ทันที ไม่ต้องเปิดหน้าต่างตรวจซ้ำ การจองยังไม่ยืนยันว่าของวางจริงแล้ว'),
'08-06':(verification,'นำหน่วยไปยังตำแหน่งที่จอง','หลังจอง ดูชื่อจุดจัดเก็บและพิกัดที่แน่นอน แล้วนำหน่วยไปวาง ช่องตรวจรหัสแสดงในหน้านี้อยู่แล้ว ไม่ต้องเปิดหน้าต่างสแกน'),
'08-07':(verification,'ตรวจรหัสปลายทางในหน้าเดียว','กรอกรหัสจากป้ายแล้วกด Verify entered code หรือกด Start camera เมื่อพร้อมสแกนจริง การตรวจรหัสไม่ใช่การยืนยันการวาง'),
'08-08':(wrong,'รหัสผิดต้องแก้ก่อนยืนยัน','เมื่อรหัสไม่ตรง ระบบแสดงเหตุผลใต้ช่องตรวจรหัสและปิด Confirm stored ตรวจป้ายปลายทางที่จองแล้วกรอกใหม่'),
'08-09':(correct,'ยืนยันหลังวางจริง','หลังตรวจรหัสถูกต้อง ให้วางตามตำแหน่งและทิศทางที่แสดง แล้วกด Confirm stored / ยืนยันจัดเก็บ เป็นขั้นตอนแยกต่างหาก'),
'09-02':(move,'ดูต้นทางและปลายทางแล้วจองในหน้าเดียว','ส่วน From แสดงตำแหน่งเดิม ส่วน To แสดงปลายทางใหม่ ใส่เหตุผลถ้าต้องการ แล้วกด Reserve this position ได้ทันที ทั้งสองพื้นที่ยังถูกกันไว้จนกว่าจะยืนยันการวางหรือคืนจริง')}
m=json.loads((root/'manifest.json').read_text())
m['date']='8 กันยายน 2026'
for chapter in m['chapters']:
 for step in chapter['steps']:
  if step['id'] in texts:
   shot,title,instruction=texts[step['id']];step.update(shot,title=title,instruction=instruction,alt=title)
   step.pop('url',None);step.pop('note',None);step.pop('result',None)
   step['note']='ภาพขั้นตอนนี้อัปเดต 8 กันยายน 2026 จากข้อมูลทดสอบ SIMPLIFY-QA-0908; ชื่อสินค้าและรหัสต่างจากตัวอย่างเดิมได้'
(root/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2))
(root/'index.html').write_text(renderer.render(m,root))
h=json.loads((root/'recommendation-highlight.json').read_text());h['date']=m['date']
ch=h['chapters'][0];ch['intro']='เปิดหน่วยที่วัดแล้ว → เลือกจุดและปรับตำแหน่ง → จองในหน้าเดียว → ตรวจรหัส → ยืนยันหลังวางจริง'
keys=['08-02','08-03','08-04','08-05','08-07']
ch['steps']=[]
for key in keys:
 shot,title,instruction=texts[key]
 ch['steps'].append(dict(shot,id='highlight-'+key,title=title,instruction=instruction,alt=title,note='การดูตัวอย่างยังไม่จองพื้นที่ การตรวจรหัสไม่ยืนยันการวางจริง'))
(root/'recommendation-highlight.json').write_text(json.dumps(h,ensure_ascii=False,indent=2))
(root/'recommendation-highlight.html').write_text(renderer.render(h,root))
print('Updated full manual and highlight with embedded current screenshots')
