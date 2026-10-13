import test from "node:test";
import assert from "node:assert/strict";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { createNavigationPlugin } from "./navigation.mjs";
import { analyzeNavigationSource } from "./navigation-analysis.mjs";

const file = "src/features/Fixture.tsx";
const base = {
  version: 1,
  destinations: { hrToday: "/hr/today" },
  states: [],
  hubs: [],
  infrastructure: [],
  destinationBuilders: ["productPath"],
};
const codes = (source, contract = base, filename = file) =>
  analyzeNavigationSource(source, filename, contract).errors.map(
    (error) => error.code,
  );
const react = 'import {useState as localState} from "react";';
const header =
  'import {PageHeader as Header} from "@/components/ui/PageHeader";';
const policy = (state, integration, uses = ["branch"]) => ({
  id: `${file}#Screen:${state}`,
  policy: integration ? "workflow" : "presentation",
  ...(integration
    ? { integration }
    : { uses, render: [{ shape: "and", truthy: ["p"], falsy: [] }] }),
  expectation:
    "Back restores the audited previous view with all draft inputs retained.",
});

test("original whole-view Location defect fails the actual ESLint rule", () => {
  const source = `${react}${header} function Screen(){ const [location,setLocation]=localState(null); return <><Header title="Tickets" backFallbackHref="/finished-goods"/>{location ? <TicketForm/> : <LocationPicker onSelect={setLocation}/>}</> }`;
  const linter = new Linter();
  const messages = linter.verify(
    source,
    [
      {
        files: ["**/*.tsx"],
        languageOptions: { parser: tseslint.parser },
        plugins: { navigation: createNavigationPlugin(base) },
        rules: { "navigation/architecture": "error" },
      },
    ],
    { filename: file },
  );
  assert.ok(
    messages.some((message) =>
      /Screen:location.*no predecessor contract/.test(message.message),
    ),
    JSON.stringify(messages),
  );
});
test("another workflow hook never proves a local Location predecessor", () => {
  const source = `${react} import {useWorkflowStep} from "@/hooks/useWorkflowStep"; function Screen(){const [location,setLocation]=localState(null); const unrelated=useWorkflowStep('x','s',location!==null,()=>{}); return <>{location ? <LocationPicker/> : null}{unrelated.active ? <Other/> : null}</>}`;
  const contract = {
    ...base,
    states: [
      policy("location", "useWorkflowStep"),
      policy("unrelated", "useWorkflowStep"),
    ],
  };
  assert.ok(codes(source, contract).includes("state-policy"));
});
test("specific shared predecessor and audited presentation pass", () => {
  const source = `${react}${header} import {useWorkflowStep as useStep} from "@/hooks/useWorkflowStep"; function Screen(){const [query,setQuery]=localState(''); const locationStep=useStep('location','tickets',true); return <><Header title="Tickets" backFallbackHref="/finished-goods"/>{locationStep.active ? <LocationPicker/> : <TicketForm/>}{query && <p>Filtered</p>}</>}`;
  assert.deepEqual(
    codes(source, {
      ...base,
      states: [policy("query"), policy("locationStep", "useWorkflowStep")],
    }),
    [],
  );
});
test("exact state setter in the predecessor callback passes", () => {
  const source = `${react} import {useWorkflowStep} from "@/hooks/useWorkflowStep"; function Screen(){const [review,setReview]=localState(false); const step=useWorkflowStep('review','draft',true,()=>setReview(false)); return <><button onClick={()=>{setReview(true);step.enter();}}>Open review</button>{review ? <Review/> : null}</>;}`;
  assert.deepEqual(
    codes(source, {
      ...base,
      states: [
        policy("review", "useWorkflowStep"),
        policy("step", "useWorkflowStep"),
      ],
    }),
    [],
  );
});
for (const [name, source] of [
  [
    "aliased router",
    'import {useRouter as useNav} from "@/i18n/navigation"; function Screen(){const nav=useNav(); const r=nav; r["back"]();}',
  ],
  [
    "destructured router",
    'import {useRouter as useNav} from "next/navigation"; function Screen(){const {back:leave}=useNav(); leave();}',
  ],
  [
    "bound router",
    'import * as n from "next/navigation"; function Screen(){const nav=n.useRouter(); const leave=nav.back.bind(nav); leave();}',
  ],
  [
    "computed history",
    'function Screen(){const method="back"; const h=window.history; h[method]();}',
  ],
  [
    "destructured history",
    "function Screen(){const {history:h}=window; const {back:leave}=h; leave.call(h);}",
  ],
  ["global history", "function Screen(){history.go(-1);}"],
])
  test(`rejects ${name} traversal`, () =>
    assert.ok(codes(source).includes("raw-history")));
test("infra exception is scoped to the named function", () => {
  const contract = {
    ...base,
    infrastructure: [
      { file, functions: ["owned"], capabilities: ["history-traversal"] },
    ],
  };
  assert.deepEqual(
    codes("function owned(){window.history.back();}", contract),
    [],
  );
  assert.ok(
    codes("function other(){window.history.back();}", contract).includes(
      "raw-history",
    ),
  );
});
for (const source of [
  'import {Dialog as D} from "radix-ui"; function Screen(){return <D.Root/>}',
  'import * as D from "@radix-ui/react-dialog"; function Screen(){const Modal=D.Root; return <Modal/>}',
  "function Screen(){return <dialog open/>}",
])
  test(`rejects raw modal bypass: ${source.slice(0, 42)}`, () =>
    assert.ok(codes(source).includes("modal-primitive")));
test("shared aliased modal records exact overlay ownership", () => {
  const source = `${react} import {Dialog as Modal} from "@/components/ui/dialog"; function Screen(){const [review,setReview]=localState(false);return <Modal open={review} onOpenChange={setReview}/>}`;
  const overlay = {
    id: `${file}#Screen:$overlay:Dialog:review`,
    policy: "overlay",
    integration: "dialog",
  };
  assert.deepEqual(
    codes(source, { ...base, states: [policy("review", "dialog"), overlay] }),
    [],
  );
});
test("cannot disable shared modal Back", () => {
  assert.ok(
    codes(
      'import {Dialog} from "@/components/ui/dialog";function Screen(){return <Dialog managedBack={false}/>}',
    ).includes("overlay-bypass"),
  );
});
for (const props of [
  'title="x"',
  'backFallbackHref="https://outside.invalid"',
  'backFallbackHref="//outside.invalid"',
  "backFallbackHref={returnTo}",
  "breadcrumbs={[]}",
  "showBack={false}",
])
  test(`rejects missing/unsafe header policy: ${props}`, () =>
    assert.ok(
      codes(`${header} function Screen(){return <Header ${props}/>}`).includes(
        "header-policy",
      ),
    ));
test("safe parent breadcrumb and audited hub are permitted", () => {
  assert.deepEqual(
    codes(
      `${header} import {ROUTES} from "@/lib/navigation";function Screen(){return <Header breadcrumbs={[{label:'Today',href:ROUTES.hrToday}]}/>} `,
    ),
    [],
  );
  assert.deepEqual(
    codes(`${header} function Screen(){return <Header showBack={false}/>}`, {
      ...base,
      hubs: [{ id: `${file}#Screen` }],
    }),
    [],
  );
});
test("page cannot fall back to itself", () => {
  assert.ok(
    codes(
      `${header} function Screen(){return <Header backFallbackHref="/hr/test"/>}`,
      base,
      "src/app/[locale]/(desktop)/hr/test/page.tsx",
    ).includes("header-policy"),
  );
});
test("query-derived return navigation requires validation", () => {
  const source =
    'import {useRouter,useSearchParams} from "next/navigation";function Screen(){const nav=useRouter();const params=useSearchParams();nav.replace(params.get("returnTo"));}';
  assert.ok(codes(source).includes("unsafe-return"));
  assert.deepEqual(
    codes(
      'import {useRouter,useSearchParams} from "next/navigation";import {safeInternalReturnHref} from "@/lib/navigationGuard";function Screen(){const nav=useRouter();const params=useSearchParams();nav.replace(safeInternalReturnHref(params.get("returnTo"),"/hr/today"));}',
      {
        ...base,
        actions: [
          {
            id: `${file}#Screen:$navigate:replace:safeInternalReturnHref`,
            intent: "dispatch",
          },
        ],
      },
    ),
    [],
  );
});
test("dormant relevant workflow hook cannot excuse a state-only opening", () => {
  const source = `${react} import {useWorkflowStep} from "@/hooks/useWorkflowStep"; function Screen(){const [review,setReview]=localState(false); const step=useWorkflowStep('review','draft',true,()=>setReview(false)); return <><button onClick={()=>setReview(true)}>Open review</button>{review ? <Review/> : null}</>;}`;
  const contract = {
    ...base,
    states: [
      policy("review", "useWorkflowStep"),
      policy("step", "useWorkflowStep"),
    ],
  };
  assert.ok(
    codes(source, contract).includes("state-policy"),
    "A declared but never-entered step cannot own the local review view",
  );
});
test("explicit Close callback cannot push its parent even with wrong advance intent", () => {
  const source =
    'import {useRouter} from "@/i18n/navigation";function Screen(){const router=useRouter();function finish(){router.push("/hr/employees");}return <EmployeeForm onClose={finish}/>;}';
  assert.ok(
    codes(source, {
      ...base,
      actions: [
        {
          id: `${file}#finish:$navigate:push:/hr/employees`,
          intent: "advance",
        },
      ],
    }).includes("navigation-action"),
  );
});
test("audited Review Back-to-list push fails without handler-name guessing", () => {
  const source =
    'import {useRouter} from "@/i18n/navigation";function Screen(){const router=useRouter();return <button onClick={()=>router.push("/hr/review")}>Back to list</button>}';
  assert.ok(
    codes(source, {
      ...base,
      actions: [
        { id: `${file}#Screen:$navigate:push:/hr/review`, intent: "return" },
        {
          id: `${file}#Screen:$task:returnFromTask:/finished-goods`,
          intent: "return",
        },
      ],
    }).includes("navigation-action"),
  );
});
test("new parent push needs an explicit navigation-action audit", () => {
  assert.ok(
    codes(
      'import {useRouter} from "next/navigation";function Screen(){useRouter().push("/finished-goods");}',
    ).includes("navigation-action"),
  );
});
test("shared task return uses replacement callback instead of pushing cancelled task", () => {
  const source =
    'import {useRouter} from "@/i18n/navigation";import {returnFromTask} from "@/lib/taskNavigation";function Screen(){const router=useRouter();return <button onClick={()=>returnFromTask("/finished-goods",href=>router.replace(href))}>Cancel</button>}';
  assert.deepEqual(
    codes(source, {
      ...base,
      actions: [
        { id: `${file}#Screen:$navigate:replace:$dynamic`, intent: "return" },
        {
          id: `${file}#Screen:$task:returnFromTask:/finished-goods`,
          intent: "return",
        },
      ],
    }),
    [],
  );
});
test("post-await navigation without live completion owner fails", () => {
  const source =
    'import {useRouter} from "next/navigation";async function Screen(){const router=useRouter();await save();router.push("/finished-goods");}';
  assert.ok(
    codes(source, {
      ...base,
      actions: [
        {
          id: `${file}#Screen:$navigate:push:/finished-goods`,
          intent: "completion",
        },
      ],
    }).includes("navigation-action"),
  );
});
test("live shared operation completion consumes owned task before replacement", () => {
  const source =
    'import {useRouter} from "@/i18n/navigation";import {useOperation} from "@/features/finishedGoods/shared";import {completeTask} from "@/lib/taskNavigation";function Screen(){const router=useRouter();const op=useOperation("task");op.complete(()=>completeTask("/finished-goods",href=>router.replace(href)));}';
  assert.deepEqual(
    codes(source, {
      ...base,
      actions: [
        {
          id: `${file}#Screen:$navigate:replace:$dynamic`,
          intent: "completion",
        },
        {
          id: `${file}#Screen:$task:completeTask:/finished-goods`,
          intent: "completion",
        },
      ],
    }),
    [],
  );
  assert.ok(
    codes(
      source.replace(
        'const op=useOperation("task")',
        "const op={complete:action=>action()}",
      ),
      {
        ...base,
        actions: [
          {
            id: `${file}#Screen:$navigate:replace:$dynamic`,
            intent: "completion",
          },
        ],
      },
    ).includes("navigation-action"),
  );
});
test("existing presentation state cannot silently become a whole-view Location workflow", () => {
  const original = `${react}function Screen(){const [query,setQuery]=localState('');return <>{query && <p>Filtered</p>}</>}`;
  const recorded = analyzeNavigationSource(original, file, base).states[0];
  const declaration = { ...policy("query"), render: recorded.render };
  const changed = `${react}function Screen(){const [query,setQuery]=localState('');return <>{query ? <LocationPicker/> : <TicketForm/>}</>}`;
  assert.ok(
    codes(changed, { ...base, states: [declaration] }).includes("state-policy"),
    "same state id/branch use must not bypass a changed render-owner audit",
  );
});

test("presentation ownership ignores copy, whitespace, and imported JSX aliases", () => {
  const original = `${react} import {Notice as Message} from "@/components/ui/Notice";function Screen(){const [query,setQuery]=localState('');return query && <Message role="status">Original</Message>;}`;
  const recorded = analyzeNavigationSource(original, file, base).states[0];
  const entry = { ...policy("query"), render: recorded.render };
  const changed = original
    .replaceAll("Message", "NoticeAlias")
    .replace("Original", "New translated copy")
    .replace("return query", "return   query");
  assert.deepEqual(codes(changed, { ...base, states: [entry] }), []);
});

test("task owners cannot disguise router.push as a replace callback", () => {
  const source =
    'import {useRouter} from "@/i18n/navigation";import {returnFromTask} from "@/lib/taskNavigation";function Screen(){const router=useRouter();returnFromTask("/finished-goods",router.push);}';
  const policy = {
    ...base,
    actions: [
      {
        id: `${file}#Screen:$task:returnFromTask:/finished-goods`,
        intent: "return",
      },
    ],
  };
  assert.ok(codes(source, policy).includes("navigation-action"));
});
test("opaque computed router operations fail closed through aliases", () => {
  const source =
    'import {useRouter as useNav} from "@/i18n/navigation";function Screen(){const router=useNav();const nav=router;const method=chooseMethod();nav[method]("/finished-goods");}';
  assert.ok(codes(source).includes("navigation-action"));
});
test("default React imports cannot hide a local-state-only view", () => {
  const source =
    'import R from "react";function Screen(){const [location,setLocation]=R.useState(null);return location ? <TicketForm/> : <LocationPicker/>;}';
  assert.ok(codes(source).includes("state-policy"));
});
test("opaque/destructured step ownership fails closed instead of disappearing from inventory", () => {
  const source =
    'import {useWorkflowStep} from "@/hooks/useWorkflowStep";function Screen(){const {active,enter}=useWorkflowStep("location","draft",true);return <button onClick={enter}>{active ? <LocationPicker/> : <TicketForm/>}</button>}';
  assert.ok(codes(source).includes("state-policy"));
});
test("named step.enter wired directly to an event creates an auditable entry", () => {
  const source =
    'import {useWorkflowStep} from "@/hooks/useWorkflowStep";function Screen(){const step=useWorkflowStep("create","scope",true);return <button onClick={step.enter}>Create</button>}';
  assert.deepEqual(
    codes(source, { ...base, states: [policy("step", "useWorkflowStep")] }),
    [],
  );
});
test("tiny same-file router wrappers cannot hide raw Back", () => {
  const source =
    'import {useRouter} from "@/i18n/navigation";function useNav(){return useRouter()}function Screen(){const nav=useNav();nav.back()}';
  assert.ok(codes(source).includes("raw-history"));
});
test("sensitive navigation reexports require an audited canonical facade", () => {
  assert.ok(
    codes(
      'export {useRouter as useNav} from "@/i18n/navigation";export {completeTask as finishTask} from "@/lib/taskNavigation";',
    ).includes("navigation-reexport"),
  );
});
test("guarded URL cancellation cannot push an abandoned editor", () => {
  const source =
    'import {useGuardedUrl} from "@/lib/deepLink";function Screen(){const navigate=useGuardedUrl();return <EmployeeForm onCancel={()=>navigate("/hr/employees")}/>;}';
  assert.ok(codes(source).includes("navigation-action"));
});
test("guarded URL cannot accept unsanitized native URL query returns", () => {
  const source =
    'import {useGuardedUrl} from "@/lib/deepLink";function Screen(){const navigate=useGuardedUrl();const href=new URL(window.location.href).searchParams.get("returnTo");navigate(href!);}';
  assert.ok(codes(source).includes("unsafe-return"));
});
test("audited synchronous task exit cannot excuse asynchronous completion", () => {
  const source =
    'import {useRouter} from "@/i18n/navigation";import {completeTask} from "@/lib/taskNavigation";function Screen(){const router=useRouter();completeTask("/finished-goods",router.replace)}';
  const contract = {
    ...base,
    actions: [
      {
        id: `${file}#Screen:$task:completeTask:/finished-goods`,
        intent: "completion",
        lifetime: "synchronous-exit",
      },
    ],
  };
  assert.deepEqual(codes(source, contract), []);
  assert.ok(
    codes(
      source
        .replace("function Screen()", "async function Screen()")
        .replace('completeTask("', 'await save();completeTask("'),
      contract,
    ).includes("navigation-action"),
  );
});
test("wildcard navigation reexports fail closed", () => {
  assert.ok(
    codes('export * from "@/i18n/navigation";').includes("navigation-reexport"),
  );
});
test("audited canonical namespace router aliases still reject Back", () => {
  const source =
    'import * as facade from "@/features/nav";function Screen(){facade.useNav().back()}';
  assert.ok(
    codes(source, {
      ...base,
      navigationAliases: {
        "src/features/nav#useNav": "src/i18n/navigation#useRouter",
      },
    }).includes("raw-history"),
  );
});
test("passing editor state to a branching same-file child cannot hide its missing predecessor", () => {
  const source = `${react}function Screen(){const [editing,setEditing]=localState(false);return <Content editing={editing}/>}function Content({editing}){return editing ? <EmployeeForm/> : <Registry/>}`;
  assert.ok(codes(source).includes("state-policy"));
});
test("nested infrastructure traversal permission stays within its exact parent", () => {
  const contract = {
    ...base,
    infrastructure: [
      {
        file,
        parent: "track",
        functions: ["onPopState"],
        capabilities: ["history-traversal"],
      },
    ],
  };
  assert.deepEqual(
    codes(
      "function track(){const onPopState=()=>history.go(-1);onPopState()}",
      contract,
    ),
    [],
  );
  assert.ok(
    codes(
      "function other(){const onPopState=()=>history.go(-1);onPopState()}",
      contract,
    ).includes("raw-history"),
  );
});

test("only an exact reviewed header provider can supply parent/hub intent through a spread", () => {
  const source =
    'import {PageHeader} from "@/components/ui/PageHeader"; import {useHrBack as useBack} from "@/features/hr/HrShared"; function Caller(){const back=useBack();return <PageHeader title="HR" {...back}/>;}';
  const provider = "src/features/hr/HrShared#useHrBack";
  assert.ok(codes(source).includes("header-policy"));
  const contract = {
    ...base,
    headerBackProviders: [provider],
    safeParentHelpers: [provider],
  };
  assert.deepEqual(codes(source, contract), []);
  assert.equal(
    analyzeNavigationSource(source, file, contract).headers[0].helper,
    provider,
  );
});
