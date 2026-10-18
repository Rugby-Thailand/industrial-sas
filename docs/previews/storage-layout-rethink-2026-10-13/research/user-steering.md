# Confirmed user steering

User confirmed Kiro Opus 5.5 (Kilo was a typo).

User answered the task-priority question: จริง ๆ ก็ทั้งหมดอ่ะ — ALL three workflows matter: find locations/check inventory, place or move stock, and edit floors/zones/layout.

The prototype must visibly support these three tasks without displaying every task's tools at once. Prefer clearly labeled task entry points with shared location selection, keeping search/map/list common; operations and edit have deliberate contextual controls and safe local demo confirmations. A complete operational flow (select occupied location → move one demo unit → select eligible target → review → confirm → coherent counts/stock change in memory, optionally undo) is needed. A place/reserve demo from a pending unit can be included if supported truthfully. Do not imply real writes, QR scans, or backend guarantees. Production retains existing job scan/reservation/confirmation domain guards. Every stock count derives from one dataset. Avoid treating lookup-only as the user's chosen primary objective. Parent will send a follow-up task once the current run completes if this arrives after it was read.
