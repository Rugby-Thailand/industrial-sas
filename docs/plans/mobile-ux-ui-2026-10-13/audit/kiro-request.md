# Kiro audit request

Audit the UX/UI plan against the actual pixels of all nine supplied annotated screenshots and the relevant source code. This is a review of images and planning only. Preserve all existing work. Do not implement UI, change source code, alter the plan, install anything, launch the app, modify Git state, or contact anyone.

Work only in `/Users/macbook/.codex/worktrees/mobile-ux-ui-plan/industrial-sas`. You may read related code here. Write your completed report in Thai to `docs/plans/mobile-ux-ui-2026-10-13/kiro-audit.md`. That report is the only repository file you may create or edit.

## Authoritative user intent

- Red annotations mean remove. Green/turquoise annotations mean add or adjust.
- The user is collecting a plan and may add more screenshots; implementation has not been requested.
- The user has explicitly confirmed screenshot 1: REMOVE the old sliders/settings button, ADD a pen icon immediately AFTER the building name. The new icon opens the existing building editing form. Do not propose merely changing the icon in the old position or ask the user to confirm this again.
- The user has explicitly confirmed screenshot 5: center the X close button vertically with the Search heading. Do not ask to confirm this again.
- Screenshot 9's hand-drawn circular arrow may mean moving retry onto the photo or rotating the photo; this has not been confirmed. Separate visible annotation from inferred function.
- Do not invent additional user requirements or make unannotated controls/features disappear.

## Required inspection

1. Read `AGENTS.md`, `docs/plans/mobile-ux-ui-2026-10-13/README.md`, and `docs/plans/mobile-ux-ui-2026-10-13/images.json`.
2. Load and VISUALLY INSPECT every original image listed in `images.json` using an image-capable tool. Reading JPEG bytes as text or reading the plan's descriptions is not image inspection. Make actual image-tool calls for the nine paths. If your tool/model cannot view image pixels, say so clearly and restrict conclusions to text/code; never claim you inspected pictures you could not see.
3. Compare red/green marks and readable text with UX-01 through UX-17. Check omissions, incorrect interpretations, duplication, and requirements that exceed the annotation.
4. Inspect the relevant source files and existing tests cited in the plan, especially selection/reopening behavior in FloorMap; the distinction between the sheet's Close and clearSelection; dynamic sidebar content and scrolling; Search actions versus other result details; building title/actions/filter composition; locale options; camera aspect/crop geometry and stream lifetime; AI image retries. Validate claims rather than restating the plan.
5. Identify screenshot/source-version differences honestly. The existing checkout has separate uncommitted work and was not copied here; the plan's source base is commit `733c6acad348f1c024ef033f9d6ae8300e45e363`. Do not guess the source of a page absent from this worktree. Finding another worktree is not required.

## Report requirements

- Lead with a concrete verdict: whether the plan is ready for implementation, ready with specific prerequisites, or needs revision.
- Include an image-by-image evidence table (IMG-01 through IMG-09), image link, visible red removal marks, green additions/adjustments, mapped UX IDs, confidence, and unresolved ambiguity. Explicitly state which images were visually inspected and which could not be inspected.
- Give prioritized findings only when supported by image or source evidence. For each: severity, affected UX ID(s), exact image/source location, current issue, practical consequence, precise plan correction, and whether it can be resolved from existing evidence or genuinely needs the user's decision.
- Respect confirmed UX-01 and UX-10. Avoid reopening settled choices.
- Flag cases where removing a control could break the preserved workflow, where assertions about source behavior are wrong, and where shared components could spread a requested mobile change beyond its scope.
- Suggest a minimal dependency order and concrete acceptance checks. Keep extra aesthetic opinions out of the findings unless directly relevant to the annotations.
- Mark screenshot 9's function as unresolved unless actual pixels conclusively distinguish retry from rotation; show your evidence either way. Do not treat a drawn icon alone as proof of a new rotation feature.
- List which existing tests should be updated only for changed behavior; no need to run tests for a planning audit.
- Finish with remaining decisions and limitations. Cite local image/file references and source line numbers for verifiable findings.

Do not edit README.md. Return a short completion summary and report path after saving the audit. If visual inspection fails, still produce the text/code audit and clearly document the incomplete visual portion.
