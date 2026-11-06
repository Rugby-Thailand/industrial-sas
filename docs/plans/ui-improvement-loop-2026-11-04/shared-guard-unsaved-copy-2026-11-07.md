# Unsaved-change guard description

Stage 2 Loop 4 findings S2-L4-opus-60 and 61 identified a mismatch: the generic no-save guard described details as “not sent” although the actual callers retain unsaved ticket changes. The shared description now says “unsaved changes” in English and “การเปลี่ยนแปลงที่ยังไม่ได้บันทึก” in Thai.

Only the two description strings changed. Titles, action order and emphasis, dirty/pending registration, handlers, and navigation ownership are unchanged. No caller-copy API was introduced.

Validation: the two existing provider cases covering Thai decisions/external save and multiple registered drafts passed (2 selected; 54 intentionally unselected). Prettier and diff checks passed. This is limited shared-component evidence; each consuming stage must capture the new copy in its next source boundary and retain actual caller Keep/Discard, focus, pending, and Back checks. Frozen prior audit scores and evidence remain unchanged.
