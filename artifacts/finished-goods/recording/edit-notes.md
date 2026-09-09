# Finished goods walkthrough edits

**Edited browser viewport recording; pauses and refresh troubleshooting omitted.**

Video: `../finished-goods-walkthrough.mp4`  
Edited timing and source mapping: `edited-manifest.json`  
Original evidence: `manifest.json` and all 195 PNGs under `frames/` (unchanged).

## Edits

- Retained 182 original screenshot frames in their chronological order. No artwork, synthetic motion, or intermediate UI states were generated. The encoder only repeats captured frames to hold each state.
- Omitted source frames 161–173, corresponding to raw time **142.831s inclusive to 299.964s exclusive**. This removes refresh troubleshooting after action 14. The successful stored result from action 13 is retained, followed by the recovered stored result (frame 174) and the planner/occupied-location inspection from actions 15–16.
- Capped seven idle gaps between retained captures at **3 seconds**. All shorter capture gaps retain their original elapsed timing. The long final wait is shortened to a 3-second final frame hold.
- Raw duration: **386.237 seconds**. Edited manifest duration: **68.431 seconds**. This is an edited, sampled viewport recording, not uninterrupted operating-system screen capture.
- Output dimensions are **1440 × 900**. Each source viewport is preserved in full; shorter captures have black letterboxing. No source screenshot was cropped or overwritten.

## Verified output

- MP4 / H.264 (`avc1`), nominal **10 fps**, **685 encoded frames**, **no audio**.
- AVFoundation duration: **68.431667 seconds** (container time-base rounding under 1 ms).
- Size: **4,536,107 bytes**.
- Decoded 17 sample frames spanning the full video and compared them with the expected original PNGs. Maximum mean absolute RGB difference: **3.621/255**, consistent with lossy H.264 compression. Sample checks establish frame order, timing, orientation, and content.
- Visually inspected decoded measurement, exact placement, recovered stored result, and final occupied-location frames. Confirmed the green stored status, P-000003 / POS-000003, exact X 0.2m / Y 0.3m / 90° position, and the planner location card.
- Raw manifest SHA-256: `ba12436ab0eeefc066f994460636f4723708cf3e191b107dc9424d2273327d31`. Verified unchanged before publishing the edited files.
- Video SHA-256: `c51d0c0f5fd68d96dadca1baace95694470b9c21a0db57d8b17ca08f442963b1`.
- Encoding and decoded-frame checks ran outside the repository; completed deliverables were copied into artifacts once to avoid development watcher rebuilds.

## Action index

The index follows the source action labels; action 14 is intentionally omitted. Action timestamps are mapped onto the edited timeline. Some actions begin while the page is still transitioning, exactly as captured.

| Edited time | Action |
| --- | --- |
| 0.00s | 01 — Add finished good |
| 5.05s | 02 — Enter product details |
| 7.45s | 03 — Create product and continue to measurement |
| 13.93s | 04 — Measure the physical pallet |
| 16.06s | 05 — Inspect the same 3D controls |
| 22.75s | 06 — Save measurements and calculate storage |
| 28.04s | 07 — Choose location FG-1 |
| 30.16s | 08 — Adjust exact position and orientation |
| 34.00s | 09 — Review placement confirmation |
| 43.49s | 10 — Reserve the exact position |
| 45.58s | 11 — Open destination verification |
| 50.63s | 12 — Verify the destination label manually |
| 55.70s | 13 — Confirm physical storage |
| 57.82s | 15 — Open the building floor and occupied location |
| 63.12s | 16 — Inspect the occupied location card and fixed QR labels |

## Re-encode

From the repository root, choose an output filename that does not already exist:

```sh
swift scripts/encode-browser-recording.swift artifacts/finished-goods/recording/edited-manifest.json /tmp/finished-goods-walkthrough.mp4
```

The editable manifest retains each source frame's index and raw timestamp, plus every shortened gap, so these cuts can be audited or changed without touching the original recording.
