# Parent review: location acquisition and registration

Actual caller tests exposed four defects after the first integration:

- Forward after leaving Photo AI opened the barcode camera instead. The camera owner now retains the selected acquisition mode.
- A resolved scan could open registration before consuming its camera entry, leaving an extra Back step. Location acquisition now completes its owned foreground before publishing the next choice, and a manual choice immediately invalidates an older lookup.
- Successful location registration requested navigation while its own dirty draft still guarded the form. It now settles that draft before queuing completion with the live write owner, then consumes registration before notifying its caller.
- Retake cleared the reviewed photo and corrected code, so its declared predecessor never became active. The existing photo and code remain until a replacement is captured; Back/Close dismisses the retake camera first.

`LocationPicker.navigation.test.tsx` uses the real navigation provider, history tracker, disclosure owners, registration form, and image reader. Only API and hardware resources are substituted. Its seven cases cover camera Close then native Back; actual origin locale/query/hash; AI Back/Forward; nested AI dismissal and late response; dirty registration Keep editing/discard; pending registration and successful completion; retained photo/code during retake; and remount retirement.

Validation: 85 tests across the navigation, location search, AI, image, and registration caller suites; normal scoped ESLint; TypeScript 6; formatting. Physical camera hardware and production data were not exercised.
