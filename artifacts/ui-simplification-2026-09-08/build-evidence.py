"""Build an offline screenshot report and action-based video manifests."""
import base64,html,json
from pathlib import Path
root=Path(__file__).resolve().parent
esc=html.escape
actions=json.loads((root/'actions.json').read_text())
chapters=[('packing','Create and pack',1,11),('reservation','Choose, correct, reserve and verify',12,20),('stacking','Stack and lock support',21,27),('moving','Move upper pallet and release support',28,38),('repacking','Repack four units into two',39,45),('correction-mobile','Correction return, mobile and cancellation',46,54),('next-actions-production','Direct actions and production inspection',55,59)]
parts=[]
for slug,title,start,end in chapters:
 selected=actions[start-1:end]
 manifest={'width':1728,'height':940,'fps':10,'durationMs':len(selected)*2500,'frames':[{'path':a['path'],'timestampMs':i*2500} for i,a in enumerate(selected)]}
 (root/(slug+'.json')).write_text(json.dumps(manifest,indent=2))
 steps=[]
 for n,a in enumerate(selected,start):
  data=base64.b64encode((root/a['path']).read_bytes()).decode()
  steps.append(f'<article id="action-{n}"><h3>{n:02}. {esc(a["label"])}</h3><p>{esc(a["url"])}</p><img loading="lazy" src="data:image/jpeg;base64,{data}" alt="{esc(a["label"])}"></article>')
 parts.append(f'<section id="{slug}"><h2>{esc(title)}</h2><video controls preload="metadata" src="{slug}.mp4" poster="data:image/jpeg;base64,{base64.b64encode((root/selected[0]["path"]).read_bytes()).decode()}"></video><p>Real browser action captures, held for 2.5 seconds each. Idle time shortened; this is an action-based walkthrough, not continuous screen recording.</p>{"".join(steps)}</section>')
nav=' · '.join(f'<a href="#{s}">{esc(t)}</a>' for s,t,_,_ in chapters)
doc=f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Storage planner — implementation evidence</title><style>body{{margin:auto;max-width:1280px;padding:28px;background:#0b1116;color:#eef4f8;font:16px/1.6 system-ui}}h1{{font-size:32px}}a{{color:#88bfff}}nav{{padding:20px 0}}section{{margin:48px 0}}article{{border:1px solid #35404b;border-radius:12px;padding:18px;margin:24px 0;background:#18212b}}img,video{{display:block;width:100%;height:auto;border-radius:8px}}article p{{overflow-wrap:anywhere;color:#aab8c4;font-size:12px}}.summary{{background:#18212b;padding:20px;border-radius:12px}}@media(max-width:600px){{body{{padding:12px}}}}</style><h1>Fewer clicks, tested workflows</h1><p>8 September 2026 · codex/storage-planner · app on port 3100</p><div class="summary"><p><strong>671 tests passed, type checking and lint passed, production build passed.</strong></p><p>Direct reservation: two activations → one. Verification is inline. Exact-unit correction returns to the selected destination and preview. Unit lists show the next action directly.</p><p>Live checks: packing, invalid input, refresh, wrong QR, stacking, supporting-pallet lock, upper-pallet move and lock release, 4 → 2 repacking, Thai/English, desktop1728 and mobile390.</p><p>All screenshots below are embedded in this HTML. No image-opening clicks are needed. Keep the MP4 files beside the HTML for video playback, or share the ZIP.</p><p>Boundaries: mobile is viewport testing; no physical camera/handheld scanner was tested. Return/cancel-move dialogs were inspected; actual return and concurrent-write cases are automated tests. Runtime latency was not benchmarked. Weight/load enforcement remains deferred.</p><p>Code reuse reduced duplication, but added recovery/actions made total finished-goods production source grow from 10,669 to 10,767 lines (+98). No claim of net overall code reduction.</p><a href="results.md">Detailed results</a></div><nav>{nav}</nav>{''.join(parts)}</html>'''
(root/'index.html').write_text(doc)
print('Wrote report for',len(actions),'actions and',len(chapters),'video chapters')
