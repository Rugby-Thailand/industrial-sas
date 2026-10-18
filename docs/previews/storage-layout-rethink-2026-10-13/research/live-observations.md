# Live observations, 2026-10-13
URL: https://app.thaipropertyai.com/en/master-data/storage-layouts/n57c2n3sjmdpkjncn9jf0a19gh8ey9h5?floor=1&view=storage
Authenticated page loaded successfully in T3 preview at 1280x800. Screenshot: /Users/macbook/.t3/userdata/browser-artifacts/browser-screenshot-app-thaipropertyai-com-mv61ntfp-f9f9c1d8.png
Warehouse TG-OPT / Top Gold. Building อาคาร PD, 61.5 x 11.96 m, height 5 m, floor 1.
198 storage positions in 12 groups. This is a very long narrow floor; avoid inventing a square warehouse as an accurate map.
Left global sidebar occupies 288px and includes warehouse and HR destinations.
Header has duplicate building breadcrumb/title, dimensions, ACTIVE MUTABLE SWITCH, icon-only Storage map / Building model.
Toolbar: Floor 1 dropdown, dimensions again, search, unlabeled filter, icon-only Map/Table, 2D/3D, zoom out/in, Fit, display options, + add storage stack.
Canvas is only ~279px high while page has large blank area beneath. It is dark blue with dotted grid, tiny positions, salmon-colored broad pathways and reserved areas overpowering empty locations. Map group labels PD-L1 through PD-L12. Actual position click target PD-L1-1 is ~27x17px. Labels left clipped (PD-L6/12). All major controls compete in same row. Table and search are useful but visually hidden among icons.
Live positions are not yet inspected for inventory; any prototype counts/status/product names MUST clearly be demo data, never real.
Primary references checked by parent:
https://www.nngroup.com/articles/progressive-disclosure/
https://www.nngroup.com/articles/icon-usability/
https://www.nngroup.com/articles/complex-application-design/
https://www.nngroup.com/articles/recognition-and-recall/
https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
Guidance: progressive disclosure, labels for ambiguous icons, expose daily lookup and subordinate setup; target AA 24px or exception (44px preferred touch). Distinguish normative minimum from chosen touch size.


Additional actual browser checks: Table view is already implemented and naturally ordered PD-L1-1 through PD-L1-15 then PD-L2-1. First 25 live rows showed zero stored/reserved/unmeasured units. Selecting PD-L1-1 expanded inline details with dimensions 1.884 x 1.184 m, maximum height 0.65 m, 0 units, Show on map, QR and position labels, and Edit location. Do not claim the current app lacks table view, natural sorting, details, empty state, or search. Improve discoverability and hierarchy; preserve these capabilities. Preserve geometric spatial order in map; natural sort applies navigational lists.

Mobile actual inspection at 390x844 CSS px: after selecting PD-L1-1 in Table and switching to Map, map correctly focused the location at 400%. Screenshot evidence/current-mobile-selected.png is this selected state, NOT initial default. Header + toolbar occupy roughly the first 390px before plan content, with three rows of floor/view controls, search, and camera controls. Need preserve this useful focus-on-map behavior.
