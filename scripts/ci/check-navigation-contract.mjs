#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { analyzeNavigationSource } from "../eslint/navigation-analysis.mjs";

// Inspect test declarations as data. Parameterized titles remain literal templates;
// this neither imports a test file nor claims that the referenced case passed.
export function regressionCases(source, filename = "evidence.test.tsx") {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const names = new Set();
  const testTarget = (node) => {
    if (ts.isIdentifier(node)) return ["it", "test"].includes(node.text);
    if (ts.isPropertyAccessExpression(node)) return testTarget(node.expression);
    if (ts.isCallExpression(node)) return testTarget(node.expression);
    return false;
  };
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      testTarget(node.expression) &&
      node.arguments[0] &&
      (ts.isStringLiteral(node.arguments[0]) ||
        ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))
    )
      names.add(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...names].sort();
}

const production = (file) =>
  /\.(ts|tsx)$/.test(file) && !/\.(test|spec)\./.test(file);
export function readSources(root) {
  const sources = new Map();
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (production(full))
        sources.set(
          relative(root, full).replaceAll("\\", "/"),
          readFileSync(full, "utf8"),
        );
    }
  }
  walk(resolve(root, "src"));
  return sources;
}
export const routeFile = (file) =>
  /^src\/app\//.test(file) &&
  /\/(page|error|global-error|not-found)\.tsx$/.test(file);
export function checkNavigationContract(
  sources,
  contract,
  readEvidence = () => true,
) {
  const problems = [];
  const facts = [...sources].map(([filename, source]) =>
    analyzeNavigationSource(source, filename, contract),
  );
  const files = new Set(sources.keys());
  const policies = new Set([
    "parent",
    "hub",
    "redirect",
    "auth",
    "public",
    "error",
    "not-found",
  ]);
  const checkUnique = (entries, key, section) => {
    const seen = new Set();
    for (const entry of entries ?? []) {
      if (seen.has(entry[key]))
        problems.push(`${section}: duplicate ${entry[key]}`);
      seen.add(entry[key]);
    }
  };
  checkUnique(contract.routes, "file", "routes");
  checkUnique(contract.states, "id", "states");
  checkUnique(contract.actions, "id", "actions");
  if (contract.version !== 1)
    problems.push(
      "back-navigation.json: unsupported/missing version; expected 1",
    );
  const checkEvidence = (entry, id, required) => {
    if (!entry.expectation || entry.expectation.trim().length < 20)
      problems.push(
        `${id}: document the expected Back behavior/presentation decision`,
      );
    if (required && !entry.tests?.length)
      problems.push(
        `${id}: declare a real caller/shared-contract regression test file`,
      );
    if (required && !entry.cases?.length)
      problems.push(
        `${id}: declare literal real regression case titles; a generic test file is not caller evidence`,
      );
    const evidence = new Map();
    for (const test of entry.tests ?? []) {
      const result = readEvidence(test);
      evidence.set(test, result);
      if (
        !/^(src|tests)\//.test(test) ||
        test.includes("..") ||
        !/\.(test|spec)\.[cm]?[jt]sx?$/.test(test) ||
        !(typeof result === "boolean" ? result : result?.exists)
      )
        problems.push(`${id}: regression evidence does not exist: ${test}`);
    }
    for (const item of entry.cases ?? []) {
      const result = evidence.get(item.file);
      if (
        !entry.tests?.includes(item.file) ||
        !item.name ||
        !result?.cases?.includes(item.name)
      )
        problems.push(
          `${id}: regression case does not exist: ${item.file} — ${item.name}; use a literal it/test title in the declared evidence file`,
        );
    }
  };
  for (const fact of facts) {
    for (const error of fact.errors)
      problems.push(
        `${fact.file}:${error.line} ${error.caller}: ${error.message}`,
      );
    if (!routeFile(fact.file)) continue;
    const entry = contract.routes?.find((route) => route.file === fact.file);
    if (!entry) {
      problems.push(
        `${fact.file}: production route has no declared Back policy. Add this exact route and its screen targets to docs/contracts/back-navigation.json (parent/hub/redirect/auth/public/error).`,
      );
      continue;
    }
    if (!policies.has(entry.policy))
      problems.push(`${fact.file}: invalid Back policy ${entry.policy}`);
    checkEvidence(
      entry,
      fact.file,
      entry.policy === "parent" || entry.policy === "hub",
    );
    if (
      JSON.stringify([...(entry.targets ?? [])].sort()) !==
      JSON.stringify(fact.targets)
    )
      problems.push(
        `${fact.file}: screen targets changed; audit Back for ${fact.targets.join(", ") || "inline page"} and update the route contract`,
      );
    if (entry.policy === "redirect" && !fact.redirects.includes("redirect"))
      problems.push(
        `${fact.file}: declared redirect policy no longer redirects`,
      );
    // Exact imported screen exports are the route's reviewed caller identity.
    // Dynamic parent builders/breadcrumbs remain backed by resolver/caller tests.
    const targetHeaders = [];
    const visitedTargets = new Set();
    const collectHeaders = (target) => {
      if (visitedTargets.has(target)) return;
      visitedTargets.add(target);
      const [module, exported] = target.split("#");
      const candidate = facts.find(
        (item) => item.file.replace(/\.(tsx?|jsx?)$/, "") === module,
      );
      if (!candidate) return;
      targetHeaders.push(
        ...candidate.headers.filter(
          (header) => header.caller === `${candidate.file}#${exported}`,
        ),
      );
      for (const edge of candidate.rendered ?? [])
        if (edge.from === exported) collectHeaders(edge.to);
    };
    for (const target of entry.targets) collectHeaders(target);
    const routeHeaders = [
      ...fact.headers.filter((header) => !header.forwarded),
      ...targetHeaders.filter((header) => !header.forwarded),
    ];
    for (const header of routeHeaders) {
      if (
        entry.policy === "hub" &&
        header.intent !== "hub" &&
        !(
          entry.conditionalParent &&
          header.helper === entry.conditionalParent &&
          contract.safeParentHelpers?.includes(entry.conditionalParent)
        )
      )
        problems.push(
          `${fact.file}: ${header.caller} contradicts declared hub policy; pass literal null or the declared conditional editor-parent helper to retain origin Back without a synthetic parent`,
        );
      if (
        entry.policy === "parent" &&
        (header.intent !== "parent" ||
          (header.parent && header.parent !== entry.parent))
      )
        problems.push(
          `${fact.file}: ${header.caller} contradicts declared parent ${entry.parent}; audit the route and actual header fallback together`,
        );
    }
    if (entry.policy === "parent") {
      const own =
        fact.file
          .replace(/^src\/app\/\[locale\]/, "")
          .replace(/\/\([^/]+\)/g, "")
          .replace(/\/page\.tsx$/, "") || "/";
      if (
        !/^\/(?!\/)/.test(entry.parent ?? "") ||
        /[\\\r\n]/.test(entry.parent ?? "") ||
        entry.parent === own
      )
        problems.push(
          `${fact.file}: parent must be a safe internal route different from this route (${own})`,
        );
    }
  }
  for (const route of contract.routes ?? [])
    if (!files.has(route.file))
      problems.push(
        `${route.file}: stale route contract; remove deleted routes explicitly`,
      );
  const observed = new Map(
    facts.flatMap((fact) => fact.states.map((state) => [state.id, state])),
  );
  for (const entry of contract.states ?? []) {
    const actual = observed.get(entry.id);
    if (!actual)
      problems.push(
        `${entry.id}: stale state contract; audit removed/renamed state and delete the entry`,
      );
    if (!["workflow", "overlay", "presentation"].includes(entry.policy))
      problems.push(`${entry.id}: invalid state policy ${entry.policy}`);
    if (
      entry.policy === "presentation" &&
      (!entry.uses?.length || entry.integration)
    )
      problems.push(
        `${entry.id}: presentation must list its audited render uses and must not claim integration`,
      );
    checkEvidence(entry, entry.id, entry.policy !== "presentation");
  }
  const observedActions = new Set(
    facts.flatMap((fact) => fact.actions.map((action) => action.id)),
  );
  for (const action of contract.actions ?? []) {
    if (!observedActions.has(action.id))
      problems.push(
        `${action.id}: stale navigation action; review removed/renamed return or completion intent`,
      );
    if (
      !["advance", "dispatch", "return", "completion"].includes(action.intent)
    )
      problems.push(`${action.id}: invalid navigation intent ${action.intent}`);
    if (action.lifetime && action.lifetime !== "synchronous-exit")
      problems.push(
        `${action.id}: invalid lifetime ${action.lifetime}; async completion must use the shared live operation owner`,
      );
    checkEvidence(action, action.id, true);
  }
  for (const [alias, target] of Object.entries({
    ...(contract.destinationAliases ?? {}),
    ...(contract.navigationAliases ?? {}),
  })) {
    const [module, name] = alias.split("#");
    const source = facts.find(
      (fact) => fact.file === `${module}.tsx` || fact.file === `${module}.ts`,
    );
    if (source?.exportBindings[name] !== target)
      problems.push(
        `${alias}: sanctioned navigation/destination re-export changed; re-audit its canonical owner and internal URL construction`,
      );
  }
  for (const provider of contract.headerBackProviders ?? []) {
    const [module, name] = provider.split("#");
    const fact = facts.find(
      (item) => item.file.replace(/\.(tsx?|jsx?)$/, "") === module,
    );
    if (
      !contract.safeParentHelpers?.includes(provider) ||
      !fact?.functions.includes(name)
    )
      problems.push(
        `${provider}: header Back provider requires its exact existing canonical function and reviewed safe-parent declaration`,
      );
  }
  for (const entry of contract.urlReturnOwners ?? []) {
    const state = observed.get(entry.state);
    const [path, caller] = entry.caller.split("#");
    if (
      !state?.integrated.includes("useUrlBackedState") ||
      !facts.find((fact) => fact.file === path)?.functions.includes(caller)
    )
      problems.push(
        `${entry.caller}: same-page URL return owner requires its exact URL-backed state and closure function`,
      );
  }
  for (const exception of contract.infrastructure ?? []) {
    if (
      !files.has(exception.file) ||
      !exception.functions?.length ||
      !exception.capabilities?.length ||
      !exception.reason
    )
      problems.push(
        `${exception.file}: infrastructure exceptions require an existing file, exact functions, capabilities, and a reason`,
      );
    const functions =
      facts.find((fact) => fact.file === exception.file)?.functions ?? [];
    for (const name of exception.functions ?? [])
      if (!functions.includes(name))
        problems.push(
          `${exception.file}#${name}: stale/nonexistent infrastructure exception`,
        );
    if (exception.parent && !functions.includes(exception.parent))
      problems.push(
        `${exception.file}#${exception.parent}: nonexistent containing infrastructure owner`,
      );
    if (exception.tests || exception.cases)
      checkEvidence(exception, exception.file, false);
  }
  for (const delegate of contract.overlayDelegates ?? [])
    if (
      !observed
        .get(delegate.owner)
        ?.integrated.some((integration) =>
          ["dialog", "sheet", "confirmation"].includes(integration),
        )
    )
      problems.push(
        `${delegate.component}: delegated overlay lost its audited shared owner ${delegate.owner}`,
      );
  return { problems: [...new Set(problems)].sort(), facts };
}
export function main(root = process.cwd()) {
  const contract = JSON.parse(
    readFileSync(resolve(root, "docs/contracts/back-navigation.json"), "utf8"),
  );
  const evidenceCache = new Map();
  const result = checkNavigationContract(
    readSources(root),
    contract,
    (test) => {
      if (!evidenceCache.has(test)) {
        const path = resolve(root, test);
        const exists =
          /^(src|tests)\//.test(test) &&
          !test.includes("..") &&
          existsSync(path);
        evidenceCache.set(test, {
          exists,
          cases: exists
            ? regressionCases(readFileSync(path, "utf8"), test)
            : [],
        });
      }
      return evidenceCache.get(test);
    },
  );
  if (result.problems.length) {
    console.error(
      `Back navigation contract FAILED (${result.problems.length}):`,
    );
    for (const problem of result.problems) console.error(`  ${problem}`);
    return 1;
  }
  console.log(
    `Back navigation contract OK: ${contract.routes.length} route/error policies; ${contract.states.length} exact state/overlay owners; ${contract.actions?.length ?? 0} navigation action intents.`,
  );
  return 0;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = main();
