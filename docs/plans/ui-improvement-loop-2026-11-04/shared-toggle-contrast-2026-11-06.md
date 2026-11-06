# Shared toggle contrast correction

Stage 4 Sol and Kiro independently identified the enabled Draft switch as difficult to distinguish in dark mode (S4-L2-sol-01). The previous dark thumb was black on a dark track.

AnimatedToggle now uses an inset strong-border stroke, a foreground thumb when unchecked and a primary-foreground thumb when checked. Icon ink follows the contrasting surface. Track dimensions, padding, translations, 48px hit target, focus ring, disabled behavior, accessible state and handlers are unchanged.

## Verification

- Existing AnimatedToggle, theme contrast and BuildingStatusToggle tests: 31/31 passed. Changed-file ESLint, Prettier and diff checks passed.
- Real React component and shipped globals.css compiled with Vite; 24 before/after controls, 16 enabled contrast cases, light/dark keyboard Space and Enter, disabled state and visible focus passed. No authentication or backend calls.
- Unchecked thumb contrast: light 1.62 → 10.04; dark 1.64 → 10.93. Boundary contrast: light 3.95, dark 5.69. Track geometry was equal before/after.
- Theme is applied to html, as in the app. Two earlier harness attempts incorrectly used nested theme sections and a transparent background variable; their failures remain in ignored output/ui-loop/shared-toggle/attempt2 and browser-attempt1.log. They are not production contrast evidence.
- This is isolated component validation, not a Stage 4 score pass. Full catalogue pixels and independent audits must be refreshed after integration at the next stage boundary.

Evidence: [machine receipt](shared-toggle-evidence/browser-results.json), [light comparison](shared-toggle-evidence/comparison-light-desktop.png), [dark comparison](shared-toggle-evidence/comparison-dark-desktop.png), [light focus](shared-toggle-evidence/focus-light.png), [dark focus](shared-toggle-evidence/focus-dark.png).
