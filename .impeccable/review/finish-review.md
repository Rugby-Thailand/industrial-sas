## verdict

1. Resolved — FX save feedback: desktop-lower.png shows the edited source without a saved confirmation; mobile-lower.png shows the restored source with the green saved confirmation. All three input handlers reset feedback to idle in the reviewed source.

All four recaptures are valid: desktop top/lower at 1280×800 pixels and mobile top/lower at 780×1688 pixels for 390×844 CSS pixels at 2× DPR. No regression from the fix is visible. The incumbent layout and styling are preserved.

Evidence limitation: These captures visually demonstrate the source-field transition and successful save state. Rate and fee use the same confirmed reset pattern in source; their live transitions were verified by the parent. The review remains limited to the supplied Thai dark-theme captures.

## remaining

Clear. Ship covers the scored fix.

disposition: ship
