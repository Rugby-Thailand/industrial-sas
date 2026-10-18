# Preliminary coordinator observations (not final findings)

- Re-audit History date input behavior after its URL-state rewrite. Direct-link invalid range fallback is appropriate, but using the same fallback while editing may replace a temporarily empty date input with the current month and disrupt keyboard entry. Exercise clear/partial input and retained counterpart before accepting.
- Re-audit new HR access-status reads for permission parity and bounded reads. The new per-member/code cache may still repeat role + permission reads across employees sharing roles. Assess concrete limits/tests rather than speculative performance claims.
- Storage completion must retain dirty floor underlay while consuming only the spot editor entry. Added separation of floor-write pending must not allow Back/cancel during any active child write; inspect real caller tests.
