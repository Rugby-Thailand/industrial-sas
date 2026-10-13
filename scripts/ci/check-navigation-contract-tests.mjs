import test from "node:test";
import assert from "node:assert/strict";
import {
  checkNavigationContract,
  regressionCases,
} from "./check-navigation-contract.mjs";
const file = "src/app/[locale]/(desktop)/hr/test/page.tsx";
const source =
  'import {PageHeader} from "@/components/ui/PageHeader";export default function Page(){return <PageHeader title="Test" backFallbackHref="/hr/today"/>}';
const route = {
  file,
  policy: "parent",
  parent: "/hr/today",
  targets: ["src/components/ui/PageHeader#PageHeader"],
  expectation:
    "Direct links return to Today; tracked Back preserves the original locale, query, and hash.",
  tests: ["src/components/ui/PageBackButton.test.tsx"],
  cases: [
    {
      file: "src/components/ui/PageBackButton.test.tsx",
      name: "fixture direct parent Back",
    },
  ],
};
const base = { version: 1, routes: [route], states: [] };
const problems = (
  contract,
  sources = new Map([[file, source]]),
  exists = () => ({ exists: true, cases: ["fixture direct parent Back"] }),
) => checkNavigationContract(sources, contract, exists).problems;

test("declared parent route passes", () =>
  assert.deepEqual(problems(base), []));
test("new production route fails without an exact policy", () => {
  const added = new Map([
    [file, source],
    [
      "src/app/[locale]/new/page.tsx",
      "export default function Page(){return <main/>}",
    ],
  ]);
  assert.ok(
    problems(base, added).some((problem) =>
      /new\/page.tsx: production route has no declared Back policy/.test(
        problem,
      ),
    ),
  );
});
test("special error entry also needs explicit policy", () => {
  const added = new Map([
    [file, source],
    [
      "src/app/global-error.tsx",
      "export default function Error(){return <main/>}",
    ],
  ]);
  assert.ok(
    problems(base, added).some((problem) =>
      /global-error.tsx: production route/.test(problem),
    ),
  );
});
test("route screen migration needs a fresh audit", () => {
  const changed = source.replaceAll("PageHeader", "OtherHeader");
  assert.ok(
    problems(base, new Map([[file, changed]])).some((problem) =>
      /screen targets changed/.test(problem),
    ),
  );
});
for (const parent of [
  "https://external.invalid",
  "//external.invalid",
  "/hr/test",
])
  test(`rejects invalid parent ${parent}`, () =>
    assert.ok(
      problems({ ...base, routes: [{ ...route, parent }] }).some((problem) =>
        /parent must be a safe internal/.test(problem),
      ),
    ));
test("invented regression evidence fails", () =>
  assert.ok(
    problems(base, undefined, () => false).some((problem) =>
      /regression evidence does not exist/.test(problem),
    ),
  ));
test("invented literal caller case fails even when its test file exists", () => {
  const entry = {
    ...route,
    cases: [{ file: route.tests[0], name: "invented caller Back proof" }],
  };
  assert.ok(
    problems({ ...base, routes: [entry] }, undefined, () => ({
      exists: true,
      cases: ["actual caller Back proof"],
    })).some((problem) => /regression case does not exist/.test(problem)),
  );
});
test("literal template case extraction never accepts an arbitrary body string", () => {
  assert.deepEqual(
    regressionCases(
      'it.each(["native"])("%s Back retains draft",()=>{});test("real caller",()=>{const invented="fake proof"});',
    ),
    ["%s Back retains draft", "real caller"],
  );
});
test("changed navigation policies require concrete literal cases", () => {
  assert.ok(
    problems({ ...base, routes: [{ ...route, cases: [] }] }).some((problem) =>
      /declare literal real regression/.test(problem),
    ),
  );
});
test("actual imported screen header cannot contradict its route parent", () => {
  const feature = "src/features/Example.tsx";
  const routeSource =
    'import {Screen} from "@/features/Example";export default function Page(){return <Screen/>}';
  const screenSource =
    'import {PageHeader} from "@/components/ui/PageHeader";export function Screen(){return <PageHeader title="View" backFallbackHref="/hr/settings"/>}';
  assert.ok(
    problems(
      {
        ...base,
        routes: [{ ...route, targets: ["src/features/Example#Screen"] }],
      },
      new Map([
        [file, routeSource],
        [feature, screenSource],
      ]),
    ).some((problem) => /contradicts declared parent/.test(problem)),
  );
});
test("cannot erase redirect implementation behind a manifest entry", () =>
  assert.ok(
    problems({ ...base, routes: [{ ...route, policy: "redirect" }] }).some(
      (problem) => /no longer redirects/.test(problem),
    ),
  ));
test("stale and duplicate exact state inventory entries fail", () => {
  const entry = {
    id: "src/features/Old.tsx#Screen:review",
    policy: "presentation",
    uses: ["branch"],
    expectation:
      "Read-only decoration; it never replaces the active page or foreground workflow.",
  };
  const result = problems({ ...base, states: [entry, entry] });
  assert.ok(result.some((problem) => /duplicate/.test(problem)));
  assert.ok(result.some((problem) => /stale state contract/.test(problem)));
});
test("losing this state integration fails even when another step still exists", () => {
  const feature = "src/features/Example.tsx";
  const code =
    'import {useState} from "react";import {useWorkflowStep} from "@/hooks/useWorkflowStep";function Screen(){const [review,setReview]=useState(false);const other=useWorkflowStep("other","s",true);return <>{review&&<Review/>}{other.active&&<Other/>}</>}';
  const make = (state) => ({
    id: `${feature}#Screen:${state}`,
    policy: "workflow",
    integration: "useWorkflowStep",
    expectation:
      "Back consumes the owned review predecessor and retains drafts.",
    tests: ["src/components/ui/ForegroundBack.test.tsx"],
  });
  assert.ok(
    problems(
      { ...base, states: [make("review"), make("other")] },
      new Map([
        [file, source],
        [feature, code],
      ]),
    ).some((problem) => /review lost its declared/.test(problem)),
  );
});
test("checker treats source as data and performs no source execution", () => {
  let called = false;
  const input = new Map([[file, source + ";globalThis.unexpectedWrite=true;"]]);
  checkNavigationContract(input, base, () => {
    called = true;
    return true;
  });
  assert.equal(globalThis.unexpectedWrite, undefined);
  assert.equal(called, true);
});
