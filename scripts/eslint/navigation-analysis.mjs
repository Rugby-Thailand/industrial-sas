import path from "node:path";
import ts from "typescript";

const unwrap = (node) => {
  while (
    node &&
    (ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node))
  )
    node = node.expression;
  return node;
};
const functionNode = (node) =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node);
function functionName(node) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  )
    return node.parent.name.text;
  if (ts.isExportAssignment(node.parent)) return "default";
  return undefined;
}
function owner(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (functionNode(current) && functionName(current))
      return functionName(current);
  }
  return "$module";
}
function topOwner(node) {
  let result = "$module";
  for (let current = node.parent; current; current = current.parent) {
    if (functionNode(current) && functionName(current))
      result = functionName(current);
  }
  return result;
}
const scopeNode = (node) =>
  ts.isSourceFile(node) || ts.isBlock(node) || functionNode(node);
function scope(node) {
  for (let current = node.parent; current; current = current.parent)
    if (scopeNode(current)) return current;
}
function modulePath(source, filename) {
  if (source.startsWith("@/")) return `src/${source.slice(2)}`;
  if (source.startsWith("."))
    return path.posix.normalize(
      path.posix.join(path.posix.dirname(filename), source),
    );
  return source;
}
function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}
const jsxNode = (node) =>
  ts.isJsxElement(node) ||
  ts.isJsxSelfClosingElement(node) ||
  ts.isJsxFragment(node);
const containsJsx = (node) => {
  let found = false;
  if (node)
    visit(node, (child) => {
      if (jsxNode(child)) found = true;
    });
  return found;
};
const routesModule = "src/lib/navigation";
const navigationModule = "src/lib/navigationGuard";
const sensitiveNavigation = (module, name) =>
  ([
    "next/navigation",
    "src/i18n/navigation",
    "src/i18n/navigationClient",
    "src/i18n/navigationBase",
  ].includes(module) &&
    name === "useRouter") ||
  (module === "src/lib/taskNavigation" &&
    ["returnFromTask", "completeTask"].includes(name)) ||
  (module === "src/lib/deepLink" && name === "useGuardedUrl") ||
  (module === "src/hooks/useTaskCompletion" && name === "useTaskCompletion");
const sharedOverlays = new Map([
  ["src/components/ui/dialog:Dialog", "dialog"],
  ["src/components/ui/sheet:Sheet", "sheet"],
  ["src/components/ui/ConfirmDialog:ConfirmDialog", "confirmation"],
]);
const headers = new Map([
  ["src/components/ui/PageHeader:PageHeader", "backFallbackHref"],
  ["src/features/finishedGoods/shared:Heading", "backFallbackHref"],
  ["src/components/ui/PageBackButton:PageBackButton", "fallbackHref"],
]);

/** AST facts are shared by ESLint and the inventory gate. No source execution or filesystem writes. */
export function analyzeNavigationSource(text, filename, contract = {}) {
  const file = ts.createSourceFile(
    filename,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const bindings = new Map();
  const states = new Map();
  const setterStates = new Map();
  const workflowLinks = [];
  const errors = [];
  const headerFacts = [];
  const targets = new Set();
  const redirects = new Set();
  const functions = new Set();
  const exportBindings = {};
  const actions = [];
  const rendered = [];
  const exitCallbacks = new Set();
  const put = (node, name, value) => {
    const key = scope(node) ?? file;
    if (!bindings.has(key)) bindings.set(key, new Map());
    bindings.get(key).set(name, value);
  };
  const find = (node, name) => {
    for (let current = node; current; current = current.parent) {
      const value = bindings.get(current)?.get(name);
      if (value) return value;
    }
  };
  const report = (node, code, message) => {
    const loc = file.getLineAndCharacterOfPosition(node.getStart(file));
    errors.push({
      code,
      message,
      line: loc.line + 1,
      column: loc.character,
      caller: `${filename}#${owner(node)}`,
    });
  };
  visit(file, (node) => {
    if (!ts.isImportDeclaration(node) || !node.importClause) return;
    const importPath = modulePath(node.moduleSpecifier.text, filename).replace(
      /\.(tsx?|jsx?)$/,
      "",
    );
    const clause = node.importClause;
    if (clause.name)
      put(node, clause.name.text, {
        kind: "import",
        module: importPath,
        name: "default",
      });
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named))
      put(node, named.name.text, { kind: "namespace", module: importPath });
    if (named && ts.isNamedImports(named))
      for (const spec of named.elements)
        put(node, spec.name.text, {
          kind: "import",
          module: importPath,
          name: (spec.propertyName ?? spec.name).text,
        });
  });
  visit(file, (node) => {
    if (functionNode(node) && functionName(node))
      functions.add(functionName(node));
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      !node.exportClause
    ) {
      const source = modulePath(node.moduleSpecifier.text, filename);
      if (
        [
          "next/navigation",
          "src/i18n/navigation",
          "src/i18n/navigationClient",
          "src/i18n/navigationBase",
          "src/lib/taskNavigation",
          "src/lib/deepLink",
          "src/hooks/useTaskCompletion",
        ].includes(source) ||
        /^@radix-ui\/react-(dialog|alert-dialog)$/.test(source)
      )
        report(
          node,
          "navigation-reexport",
          "Wildcard navigation/modal reexports hide canonical ownership. Export only reviewed exact named facade aliases.",
        );
    }
    if (ts.isFunctionDeclaration(node) && node.name)
      put(node, node.name.text, { expression: node });
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    )
      for (const part of node.exportClause.elements) {
        const source = modulePath(node.moduleSpecifier.text, filename).replace(
          /\.(tsx?|jsx?)$/,
          "",
        );
        const importedName = (part.propertyName ?? part.name).text;
        const target = `${source}#${importedName}`;
        targets.add(target);
        exportBindings[part.name.text] = target;
        const alias = `${filename.replace(/\.(tsx?|jsx?)$/, "")}#${part.name.text}`;
        if (
          sensitiveNavigation(source, importedName) &&
          contract.navigationAliases?.[alias] !== target
        )
          report(
            part,
            "navigation-reexport",
            "Navigation APIs must retain their canonical audited import. Declare and verify this exact facade alias in navigationAliases; unaudited router/task reexports hide Back and completion ownership.",
          );
      }
    if (!ts.isVariableDeclaration(node) || !node.initializer) return;
    if (ts.isIdentifier(node.name))
      put(node, node.name.text, { expression: node.initializer });
    if (ts.isObjectBindingPattern(node.name))
      for (const part of node.name.elements) {
        if (ts.isIdentifier(part.name))
          put(node, part.name.text, {
            expression: node.initializer,
            property: (part.propertyName ?? part.name)
              .getText(file)
              .replace(/["']/g, ""),
          });
      }
    if (ts.isArrayBindingPattern(node.name))
      for (const [index, part] of node.name.elements.entries()) {
        if (ts.isBindingElement(part) && ts.isIdentifier(part.name))
          put(node, part.name.text, { expression: node.initializer, index });
      }
  });
  const propertyName = (node, seen) => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node))
      return resolve(node.argumentExpression, seen)?.literal;
  };
  function resolve(input, seen = new Set()) {
    const node = unwrap(input);
    if (!node || seen.has(node)) return undefined;
    const nextSeen = new Set(seen).add(node);
    if (ts.isStringLiteralLike(node)) return { literal: node.text };
    if (node.kind === ts.SyntaxKind.FalseKeyword) return { literal: false };
    if (node.kind === ts.SyntaxKind.TrueKeyword) return { literal: true };
    if (ts.isIdentifier(node)) {
      const binding = find(node, node.text);
      if (binding) {
        const fact = states.get(binding);
        if (fact?.workflow) return { kind: "workflow", fact };
        if (!binding.expression) {
          const target =
            binding.kind === "import" &&
            (contract.destinationAliases?.[
              `${binding.module}#${binding.name}`
            ] ??
              contract.navigationAliases?.[
                `${binding.module}#${binding.name}`
              ]);
          if (target) {
            const [module, name] = target.split("#");
            return { ...binding, module, name };
          }
          return binding;
        }
        const result = resolve(binding.expression, nextSeen);
        return binding.property ? member(result, binding.property) : result;
      }
      if (node.text === "history") return { kind: "history" };
      if (["window", "globalThis", "self"].includes(node.text))
        return { kind: "window" };
      return undefined;
    }
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    )
      return member(
        resolve(node.expression, nextSeen),
        propertyName(node, nextSeen),
      );
    if (functionNode(node)) return { kind: "function", node };
    if (ts.isCallExpression(node)) {
      const callee = resolve(node.expression, nextSeen);
      if (
        callee?.kind === "import" &&
        callee.name === "useRouter" &&
        [
          "next/navigation",
          "src/i18n/navigation",
          "src/i18n/navigationClient",
          "src/i18n/navigationBase",
        ].includes(callee.module)
      )
        return { kind: "router" };
      if (
        callee?.kind === "import" &&
        ["useSearchParams", "useQueryParams"].includes(callee.name) &&
        ["next/navigation", "src/lib/deepLink"].includes(callee.module)
      )
        return { kind: "query" };
      if (
        callee?.kind === "import" &&
        ["useOperation", "useAsyncOperation"].includes(callee.name) &&
        [
          "src/features/finishedGoods/shared",
          "src/hooks/useAsyncOperation",
        ].includes(callee.module)
      )
        return { kind: "operation" };
      if (
        callee?.kind === "import" &&
        callee.module === "src/hooks/useTaskCompletion" &&
        callee.name === "useTaskCompletion"
      )
        return { kind: "task-completion-setter" };
      if (
        callee?.kind === "import" &&
        callee.module === "src/lib/deepLink" &&
        callee.name === "useGuardedUrl"
      )
        return { kind: "guarded-url" };
      if (callee?.kind === "function") {
        const body = callee.node.body;
        if (body && !ts.isBlock(body)) return resolve(body, nextSeen);
        const returns = [];
        const walkReturns = (part) => {
          if (part !== body && functionNode(part)) return;
          if (ts.isReturnStatement(part) && part.expression)
            returns.push(part.expression);
          ts.forEachChild(part, walkReturns);
        };
        if (body) walkReturns(body);
        if (returns.length === 1) return resolve(returns[0], nextSeen);
      }
      if (callee?.kind === "query-read") return { kind: "untrusted-return" };
      if (callee?.kind === "bound") return callee.target;
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "URLSearchParams"
    )
      return { kind: "query" };
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "URL"
    )
      return { kind: "url" };
    return undefined;
  }
  function member(object, name) {
    if (!object) return undefined;
    if (object.kind === "router" && name === undefined)
      return { kind: "dynamic-navigation" };
    if (name === undefined) return undefined;
    if (object.kind === "operation" && name === "complete")
      return { kind: "completion-guard" };
    if (object.kind === "workflow" && name === "enter")
      return { kind: "workflow-enter", fact: object.fact };
    if (object.kind === "workflow" && name === "active")
      return { kind: "workflow-active", fact: object.fact };
    if (
      object.kind === "import" &&
      object.module === "react" &&
      object.name === "default"
    )
      return { kind: "import", module: "react", name };
    if (object.kind === "namespace") {
      const target =
        contract.navigationAliases?.[`${object.module}#${name}`] ??
        contract.destinationAliases?.[`${object.module}#${name}`];
      if (target) {
        const [module, exported] = target.split("#");
        return { kind: "import", module, name: exported };
      }
      return { kind: "import", module: object.module, name };
    }
    if (
      object.kind === "import" &&
      (/^@radix-ui\/react-(dialog|alert-dialog)$/.test(object.module) ||
        (object.module === "radix-ui" &&
          ["Dialog", "AlertDialog"].includes(object.name)))
    )
      return object;
    if (object.kind === "window" && name === "history")
      return { kind: "history" };
    if (object.kind === "window" && ["window", "self"].includes(name))
      return object;
    if (object.kind === "query" && name === "get")
      return { kind: "query-read" };
    if (object.kind === "url" && name === "searchParams")
      return { kind: "query" };
    if (object.kind === "router" && ["push", "replace"].includes(name))
      return { kind: "navigation", method: name };
    if (
      ["router", "history"].includes(object.kind) &&
      ["back", "forward", "go", "pushState", "replaceState"].includes(name)
    )
      return { kind: "traversal", method: name, source: object.kind };
    if (
      ["traversal", "navigation"].includes(object.kind) &&
      ["bind", "call", "apply"].includes(name)
    )
      return name === "bind" ? { kind: "bound", target: object } : object;
    if (
      object.kind === "import" &&
      object.module === routesModule &&
      object.name === "ROUTES"
    )
      return { kind: "destination", name };
    return undefined;
  }
  const imported = (node, module, name) => {
    const result = resolve(node);
    return (
      result?.kind === "import" &&
      result.module === module &&
      result.name === name
    );
  };
  const identity = (node) => {
    const result = resolve(node);
    return result?.kind === "import"
      ? `${result.module}:${result.name}`
      : undefined;
  };
  const infrastructure = (node, capability) =>
    (contract.infrastructure ?? []).some(
      (entry) =>
        entry.file === filename &&
        (entry.parent
          ? entry.parent === topOwner(node) &&
            entry.functions.includes(owner(node))
          : entry.functions.includes(topOwner(node))) &&
        entry.capabilities.includes(capability),
    );
  const stateId = (node, name) => `${filename}#${owner(node)}:${name}`;
  visit(file, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !node.initializer ||
      !ts.isCallExpression(unwrap(node.initializer))
    )
      return;
    const call = unwrap(node.initializer);
    const callee = resolve(call.expression);
    if (callee?.kind !== "import") return;
    if (
      (callee.module === "react" &&
        ["useState", "useReducer"].includes(callee.name)) ||
      (callee.module === "src/lib/deepLink" &&
        callee.name === "useUrlBackedState")
    ) {
      if (!ts.isArrayBindingPattern(node.name)) return;
      const first = node.name.elements[0];
      if (!first || !ts.isBindingElement(first) || !ts.isIdentifier(first.name))
        return;
      const id = stateId(node, first.name.text);
      const binding = find(first.name, first.name.text);
      const fact = {
        id,
        node,
        state: first.name.text,
        caller: owner(node),
        uses: new Set(callee.name === "useUrlBackedState" ? ["url-state"] : []),
        render: new Set(),
        integrated: new Set(
          callee.name === "useUrlBackedState" ? ["useUrlBackedState"] : [],
        ),
      };
      states.set(binding, fact);
      const second = node.name.elements[1];
      if (second && ts.isBindingElement(second) && ts.isIdentifier(second.name))
        setterStates.set(find(second.name, second.name.text), fact);
    }
    if (
      callee.module === "src/hooks/useWorkflowStep" &&
      callee.name === "useWorkflowStep" &&
      ts.isIdentifier(node.name)
    ) {
      const binding = find(node.name, node.name.text);
      const id = stateId(node, node.name.text);
      const fact = {
        id,
        node,
        state: node.name.text,
        caller: owner(node),
        uses: new Set(["workflow"]),
        render: new Set(),
        integrated: new Set(["useWorkflowStep"]),
        workflow: true,
        entered: false,
        active: false,
      };
      states.set(binding, fact);
    }
  });
  // Follow local component prop-to-parameter flow. This records an editor state
  // passed to a same-file child that actually branches on it, without using
  // prop/handler names as proof of navigation ownership.
  visit(file, (node) => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node))
      return;
    const component = resolve(node.tagName);
    const target =
      component?.kind === "import"
        ? `${component.module}#${component.name}`
        : component?.kind === "function" && functionName(component.node)
          ? `${filename.replace(/\.(tsx?|jsx?)$/, "")}#${functionName(component.node)}`
          : undefined;
    if (target) rendered.push({ from: owner(node), to: target });
    if (component?.kind !== "function") return;
    const parameter = component.node.parameters[0];
    if (!parameter || !ts.isObjectBindingPattern(parameter.name)) return;
    if (!bindings.has(component.node)) bindings.set(component.node, new Map());
    const componentBindings = bindings.get(component.node);
    for (const part of parameter.name.elements) {
      if (!ts.isIdentifier(part.name)) continue;
      const attr = node.attributes.properties.find(
        (item) =>
          ts.isJsxAttribute(item) &&
          item.name.getText(file) ===
            (part.propertyName ?? part.name).getText(file),
      );
      if (
        !attr?.initializer ||
        !ts.isJsxExpression(attr.initializer) ||
        !attr.initializer.expression
      )
        continue;
      if (!componentBindings.has(part.name.text))
        componentBindings.set(part.name.text, { expressions: [] });
      componentBindings
        .get(part.name.text)
        .expressions.push(attr.initializer.expression);
    }
  });
  function stateDependencies(input, seen = new Set()) {
    const found = new Set();
    if (!input || seen.has(input)) return found;
    const visited = new Set(seen).add(input);
    visit(input, (node) => {
      if (!ts.isIdentifier(node)) return;
      // Property names and JSX tag names are not references to local state.
      if (
        ts.isPropertyAccessExpression(node.parent) &&
        node.parent.name === node
      )
        return;
      const binding = find(node, node.text);
      if (states.has(binding)) found.add(states.get(binding));
      else if (binding?.expression)
        for (const fact of stateDependencies(binding.expression, visited))
          found.add(fact);
      else if (binding?.expressions)
        for (let expression of binding.expressions) {
          // An object's presence does not depend on its callback fields. For
          // workspace.editing, follow that actual property instead of treating
          // sibling dirty/pending telemetry as whole-view control.
          const input = unwrap(expression);
          if (input && ts.isObjectLiteralExpression(input)) {
            const access = node.parent;
            const property =
              (ts.isPropertyAccessExpression(access) ||
                ts.isElementAccessExpression(access)) &&
              access.expression === node
                ? propertyName(access)
                : undefined;
            const item =
              property &&
              input.properties.find(
                (part) =>
                  (ts.isPropertyAssignment(part) ||
                    ts.isShorthandPropertyAssignment(part)) &&
                  part.name.getText(file) === property,
              );
            expression = item
              ? ts.isPropertyAssignment(item)
                ? item.initializer
                : item.name
              : undefined;
          }
          for (const fact of stateDependencies(expression, visited))
            found.add(fact);
        }
    });
    return found;
  }
  const renderTags = (node) => {
    const tags = new Set();
    if (node)
      visit(node, (part) => {
        if (!ts.isJsxOpeningElement(part) && !ts.isJsxSelfClosingElement(part))
          return;
        const role = literal(attributeValue(part, "role"));
        const tag =
          identity(part.tagName)?.replace(":", "#") ??
          part.tagName.getText(file);
        tags.add(typeof role === "string" ? `${tag}[role=${role}]` : tag);
      });
    return [...tags].sort();
  };
  const control = (input, kind, shape, truthy, falsy) => {
    for (const fact of stateDependencies(input)) {
      fact.uses.add(kind);
      if (shape)
        fact.render.add(
          JSON.stringify({
            shape,
            truthy: renderTags(truthy),
            falsy: renderTags(falsy),
          }),
        );
    }
    if (input)
      visit(input, (part) => {
        const result = resolve(part);
        if (result?.kind === "workflow-active") result.fact.active = true;
      });
  };
  const integrate = (input, kind) => {
    for (const fact of stateDependencies(input)) fact.integrated.add(kind);
  };
  const attributeValue = (element, name) => {
    const attr = element.attributes.properties.find(
      (property) =>
        ts.isJsxAttribute(property) && property.name.getText(file) === name,
    );
    if (!attr) return undefined;
    if (!attr.initializer) return { node: attr, literal: true };
    return {
      node: attr.initializer,
      expression: ts.isJsxExpression(attr.initializer)
        ? attr.initializer.expression
        : attr.initializer,
    };
  };
  const literal = (attr) => attr?.literal ?? resolve(attr?.expression)?.literal;
  const safeDestination = (input, seen = new Set()) => {
    const node = unwrap(input);
    if (!node || seen.has(node)) return false;
    const next = new Set(seen).add(node);
    const result = resolve(node);
    if (typeof result?.literal === "string")
      return (
        /^\/(?!\/)/.test(result.literal) && !/[\\\r\n]/.test(result.literal)
      );
    if (result?.kind === "destination")
      return Object.hasOwn(contract.destinations ?? {}, result.name);
    if (result?.kind === "import" && result.module === routesModule)
      return (contract.destinationConstants ?? []).includes(result.name);
    if (ts.isIdentifier(node)) {
      const binding = find(node, node.text);
      return binding?.expression
        ? safeDestination(binding.expression, next)
        : false;
    }
    if (ts.isCallExpression(node)) {
      const callee = resolve(node.expression);
      if (
        (contract.safeParentHelpers ?? []).includes(
          identity(node.expression)?.replace(":", "#"),
        )
      )
        return true;
      if (
        callee?.module === navigationModule &&
        callee.name === "safeInternalReturnHref"
      )
        return true;
      if (
        callee?.module === "src/lib/auth/returnPath" &&
        callee.name === "plannerReturnPath"
      )
        return true;
      return (
        callee?.module === routesModule &&
        (contract.destinationBuilders ?? []).includes(callee.name)
      );
    }
    if (
      ts.isCallExpression(node) &&
      (contract.safeParentHelpers ?? []).includes(
        identity(node.expression)?.replace(":", "#"),
      )
    )
      return true;
    if (ts.isConditionalExpression(node))
      return (
        safeDestination(node.whenTrue, next) &&
        safeDestination(node.whenFalse, next)
      );
    if (
      ts.isBinaryExpression(node) &&
      [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(
        node.operatorToken.kind,
      )
    )
      return (
        safeDestination(node.left, next) && safeDestination(node.right, next)
      );
    if (ts.isTemplateExpression(node)) {
      if (/^\/[^/]/.test(node.head.text) && !/[\\\r\n]/.test(node.head.text))
        return true;
      if (
        node.head.text === "" &&
        safeDestination(node.templateSpans[0]?.expression, next)
      )
        return true;
      return false;
    }
    return false;
  };
  const breadcrumbDestination = (input, seen = new Set()) => {
    const node = unwrap(input);
    if (!node || seen.has(node)) return false;
    const next = new Set(seen).add(node);
    if (ts.isIdentifier(node))
      return breadcrumbDestination(find(node, node.text)?.expression, next);
    if (
      ts.isCallExpression(node) &&
      (contract.breadcrumbBuilders ?? []).includes(
        identity(node.expression)?.replace(":", "#"),
      )
    )
      return true;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "map" &&
      breadcrumbDestination(node.expression.expression, next)
    ) {
      let safe = true;
      for (const argument of node.arguments)
        visit(argument, (part) => {
          if (
            ts.isPropertyAssignment(part) &&
            part.name.getText(file) === "href" &&
            !safeDestination(part.initializer)
          )
            safe = false;
        });
      return safe;
    }
    if (!ts.isArrayLiteralExpression(node) || !node.elements.length)
      return false;
    const last = unwrap(node.elements.at(-1));
    if (ts.isIdentifier(last))
      return breadcrumbItem(find(last, last.text)?.expression);
    if (ts.isCallExpression(last)) return breadcrumbItem(last);
    if (!ts.isObjectLiteralExpression(last)) return false;
    const href = last.properties.find(
      (property) =>
        ts.isPropertyAssignment(property) &&
        property.name.getText(file) === "href",
    );
    return href && safeDestination(href.initializer);
  };
  const breadcrumbItem = (node) =>
    node &&
    ts.isCallExpression(unwrap(node)) &&
    (contract.breadcrumbItemBuilders ?? []).includes(
      identity(unwrap(node).expression)?.replace(":", "#"),
    );
  const enclosingOwnerApi = (node) => {
    const result = new Set();
    for (let current = node.parent; current; current = current.parent) {
      if (ts.isCallExpression(current)) {
        const callee = resolve(current.expression);
        if (callee?.kind === "completion-guard") result.add("live-completion");
        if (
          callee?.kind === "import" &&
          callee.module === "src/lib/taskNavigation" &&
          ["returnFromTask", "completeTask"].includes(callee.name)
        )
          result.add(callee.name);
      }
      if (exitCallbacks.has(current)) result.add("exit-callback");
      if (
        ts.isJsxAttribute(current) &&
        ["onCancel", "onClose", "onBack", "onDone"].includes(
          current.name.getText(file),
        )
      )
        result.add("exit-callback");
    }
    return result;
  };
  visit(file, (node) => {
    if (
      !ts.isJsxAttribute(node) ||
      !["onCancel", "onClose", "onBack", "onDone"].includes(
        node.name.getText(file),
      )
    )
      return;
    if (node.initializer && ts.isJsxExpression(node.initializer)) {
      const value = unwrap(node.initializer.expression);
      if (value && ts.isIdentifier(value)) {
        const definition = find(value, value.text)?.expression;
        if (definition && functionNode(unwrap(definition)))
          exitCallbacks.add(unwrap(definition));
      }
    }
  });
  const targetFamily = (node) => {
    const result = resolve(node);
    if (typeof result?.literal === "string") return result.literal;
    if (result?.kind === "destination") return `ROUTES.${result.name}`;
    if (result?.kind === "import") return result.name;
    if (ts.isIdentifier(unwrap(node))) {
      const definition = find(node, unwrap(node).text)?.expression;
      return definition ? targetFamily(definition) : "$dynamic";
    }
    if (ts.isCallExpression(unwrap(node)))
      return resolve(unwrap(node).expression)?.name ?? "$dynamic";
    if (ts.isConditionalExpression(unwrap(node)))
      return [
        ...new Set([
          targetFamily(unwrap(node).whenTrue),
          targetFamily(unwrap(node).whenFalse),
        ]),
      ]
        .sort()
        .join("|");
    return "$dynamic";
  };
  visit(file, (node) => {
    if (
      ts.isJsxAttribute(node) &&
      /^on[A-Z]/.test(node.name.getText(file)) &&
      node.initializer &&
      ts.isJsxExpression(node.initializer)
    ) {
      const handler = resolve(node.initializer.expression);
      if (handler?.kind === "workflow-enter") handler.fact.entered = true;
    }
    if (ts.isCallExpression(node)) {
      const result = resolve(node.expression);
      if (
        imported(
          node.expression,
          "src/hooks/useWorkflowStep",
          "useWorkflowStep",
        ) &&
        !(
          ts.isVariableDeclaration(node.parent) &&
          ts.isIdentifier(node.parent.name)
        )
      )
        report(
          node,
          "state-policy",
          "Retain a named workflow step object and connect step.enter()/step.active. Destructured or opaque step ownership cannot be audited in the current contract.",
        );
      if (result?.kind === "workflow-enter") result.fact.entered = true;
      const taskApi =
        result?.kind === "task-completion-setter"
          ? "useTaskCompletion"
          : result?.kind === "import" &&
              result.module === "src/lib/taskNavigation" &&
              ["returnFromTask", "completeTask"].includes(result.name)
            ? result.name
            : undefined;
      if (taskApi && node.arguments[0]) {
        const intent = taskApi === "returnFromTask" ? "return" : "completion";
        const id = `${filename}#${owner(node)}:$task:${taskApi}:${targetFamily(node.arguments[0])}`;
        if (!actions.some((candidate) => candidate.id === id))
          actions.push({
            id,
            method: taskApi,
            owned: [taskApi],
            afterAwait: false,
            line:
              file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
          });
        const action = (contract.actions ?? []).find(
          (entry) => entry.id === id,
        );
        if (!action)
          report(
            node,
            "navigation-action",
            `${id} needs an exact audited ${intent} contract and concrete caller regression evidence.`,
          );
        else if (action.intent !== intent)
          report(
            node,
            "navigation-action",
            `${id} must declare ${intent} intent rather than ${action.intent}.`,
          );
        if (node.arguments[1])
          visit(node.arguments[1], (part) => {
            const callback = resolve(part);
            if (callback?.kind === "navigation" && callback.method === "push")
              report(
                part,
                "navigation-action",
                "Task return/completion callbacks must replace, never push. Passing router.push leaves the abandoned task in Back history.",
              );
          });
        let enclosing = node.parent;
        while (enclosing && !functionNode(enclosing))
          enclosing = enclosing.parent;
        let asynchronous = Boolean(
          enclosing?.modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
          ),
        );
        if (enclosing)
          visit(enclosing, (part) => {
            if (ts.isAwaitExpression(part)) asynchronous = true;
          });
        if (
          taskApi === "completeTask" &&
          !enclosingOwnerApi(node).has("live-completion") &&
          !infrastructure(node, "completion-owner") &&
          !(action?.lifetime === "synchronous-exit" && !asynchronous)
        )
          report(
            node,
            "navigation-action",
            `${id}: completeTask must run through live op.complete or useTaskCompletion after pending/draft registration settles; only an exact audited synchronous exit may bypass pending settlement.`,
          );
      }
      if (
        result?.kind === "traversal" &&
        !infrastructure(
          node,
          result.source === "history" &&
            ["pushState", "replaceState"].includes(result.method)
            ? "history-write"
            : "history-traversal",
        )
      )
        report(
          node,
          "raw-history",
          `Use navigateBack/traverseBack/useWorkflowStep instead of raw ${result.source}.${result.method}; native traversal belongs to reviewed navigation infrastructure.`,
        );
      if (
        result?.kind === "dynamic-navigation" &&
        !infrastructure(node, "programmatic-navigation")
      )
        report(
          node,
          "navigation-action",
          "Computed router navigation must use a shared owned navigation API; its Back/return intent cannot be proved here.",
        );
      if (
        ["navigation", "guarded-url"].includes(result?.kind) &&
        node.arguments[0]
      ) {
        const method =
          result.kind === "guarded-url"
            ? node.arguments[2]
              ? resolve(node.arguments[2])?.literal
              : "push"
            : result.method;
        if (!["push", "replace"].includes(method))
          report(
            node,
            "navigation-action",
            "Guarded URL navigation requires an explicit push/replace mode so ownership intent can be audited.",
          );
        const owned = enclosingOwnerApi(node);
        const id = `${filename}#${owner(node)}:$navigate:${method}:${targetFamily(node.arguments[0])}`;
        let afterAwait = false;
        let enclosing = node.parent;
        while (enclosing && !functionNode(enclosing))
          enclosing = enclosing.parent;
        if (enclosing)
          visit(enclosing, (part) => {
            if (
              ts.isAwaitExpression(part) &&
              part.getStart(file) < node.getStart(file)
            )
              afterAwait = true;
          });
        const action = {
          id,
          method,
          owned: [...owned].sort(),
          afterAwait,
          line:
            file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        };
        if (!actions.some((candidate) => candidate.id === id))
          actions.push(action);
        const declaration = (contract.actions ?? []).find(
          (candidate) => candidate.id === id,
        );
        if (!declaration)
          report(
            node,
            "navigation-action",
            `${id} has no audited navigation intent. Declare advance/dispatch/return/completion with real caller evidence; cancellation and completion must use returnFromTask/completeTask.`,
          );
        if (
          method === "push" &&
          (owned.has("exit-callback") ||
            owned.has("returnFromTask") ||
            ["return", "completion"].includes(declaration?.intent))
        )
          report(
            node,
            "navigation-action",
            "Cancel/Close/Back-to-list/completion must consume the owned predecessor through returnFromTask/completeTask; router.push(parent) leaves an abandoned task or duplicate return entry.",
          );
        const urlReturn =
          result.kind === "guarded-url" &&
          method === "replace" &&
          (contract.urlReturnOwners ?? []).some((entry) => {
            if (entry.caller !== `${filename}#${owner(node)}` || !states.size)
              return false;
            const state = [...states.values()].find(
              (fact) => fact.id === entry.state,
            );
            if (!state?.integrated.has("useUrlBackedState")) return false;
            let traverses = false;
            let enclosing = node.parent;
            while (enclosing && !functionNode(enclosing))
              enclosing = enclosing.parent;
            if (enclosing)
              visit(enclosing, (part) => {
                if (
                  ts.isCallExpression(part) &&
                  imported(part.expression, navigationModule, "traverseBack")
                )
                  traverses = true;
              });
            return traverses;
          });
        if (
          declaration?.intent === "return" &&
          !owned.has("returnFromTask") &&
          !urlReturn
        )
          report(
            node,
            "navigation-action",
            `${id}: return intent must use the shared returnFromTask owner, even when replacing.`,
          );
        if (
          (afterAwait || declaration?.intent === "completion") &&
          !(owned.has("completeTask") && owned.has("live-completion"))
        )
          report(
            node,
            "navigation-action",
            `${id}: post-await/completion navigation must run through live op.complete(() => completeTask(...)); do not redirect an unmounted or pending editor.`,
          );
        let untrusted = false;
        visit(node.arguments[0], (part) => {
          if (resolve(part)?.kind === "untrusted-return") untrusted = true;
        });
        const argument = resolve(node.arguments[0]);
        if (
          (untrusted ||
            (typeof argument?.literal === "string" &&
              !/^\/(?!\/)/.test(argument.literal))) &&
          !safeDestination(node.arguments[0])
        )
          report(
            node,
            "unsafe-return",
            "Do not navigate to an unchecked query/external return URL. Pass it through safeInternalReturnHref (or plannerReturnPath for sign-in) and provide a safe internal parent.",
          );
      }
      if (
        result?.kind === "import" &&
        ["next/navigation", "src/i18n/navigation"].includes(result.module) &&
        ["redirect", "notFound"].includes(result.name)
      )
        redirects.add(result.name);
      if (
        imported(
          node.expression,
          "src/hooks/useBackDisclosure",
          "useBackDisclosure",
        )
      )
        integrate(node.arguments[0], "useBackDisclosure");
      if (
        imported(
          node.expression,
          "src/hooks/useWorkflowStep",
          "useWorkflowStep",
        ) &&
        node.arguments[3]
      ) {
        // A callback must actually invoke this state's setter. Availability alone
        // does not prove that Back returns the controlled view to a predecessor.
        const seen = new Set();
        const inspect = (argument) => {
          if (!argument || seen.has(argument)) return;
          seen.add(argument);
          visit(argument, (part) => {
            if (ts.isIdentifier(part)) {
              const definition = find(part, part.text)?.expression;
              if (definition && functionNode(unwrap(definition)))
                inspect(definition);
            }
            if (!ts.isCallExpression(part) || !ts.isIdentifier(part.expression))
              return;
            const fact = setterStates.get(
              find(part.expression, part.expression.text),
            );
            if (fact) {
              const declaration = node.parent;
              const step =
                ts.isVariableDeclaration(declaration) &&
                ts.isIdentifier(declaration.name)
                  ? states.get(find(declaration.name, declaration.name.text))
                  : undefined;
              workflowLinks.push({ fact, step });
            }
          });
        };
        inspect(node.arguments[3]);
      }
    }
    if (
      ts.isConditionalExpression(node) &&
      (containsJsx(node.whenTrue) || containsJsx(node.whenFalse))
    )
      control(
        node.condition,
        "branch",
        "conditional",
        node.whenTrue,
        node.whenFalse,
      );
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
      ].includes(node.operatorToken.kind) &&
      containsJsx(node.right)
    )
      control(
        node.left,
        "branch",
        node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
          ? "and"
          : "or",
        node.right,
      );
    if (
      ts.isIfStatement(node) &&
      (containsJsx(node.thenStatement) || containsJsx(node.elseStatement))
    )
      control(
        node.expression,
        "return",
        "early-return",
        node.thenStatement,
        node.elseStatement,
      );
    if (ts.isSwitchStatement(node) && containsJsx(node.caseBlock))
      control(node.expression, "return", "switch", node.caseBlock);
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node))
      return;
    const name = identity(node.tagName);
    if (name) targets.add(name.replace(":", "#"));
    for (const attr of ["open", "hidden", "aria-hidden", "inert"])
      control(
        attributeValue(node, attr)?.expression,
        attr,
        `prop:${attr}`,
        node,
      );
    const delegate = (contract.overlayDelegates ?? []).find(
      (entry) => entry.component.replace("#", ":") === name,
    );
    if (delegate)
      integrate(
        attributeValue(node, delegate.prop ?? "open")?.expression,
        "delegated-overlay",
      );
    let rendered = ts.isJsxElement(node.parent) ? node.parent : node;
    while (rendered.parent && ts.isParenthesizedExpression(rendered.parent))
      rendered = rendered.parent;
    if (
      delegate &&
      ts.isBinaryExpression(rendered.parent) &&
      rendered.parent.right === rendered
    )
      integrate(rendered.parent.left, "delegated-overlay");
    if (sharedOverlays.has(name)) {
      const open = attributeValue(node, "open");
      const names = [...stateDependencies(open?.expression)]
        .map((fact) => fact.state)
        .sort();
      const overlayName = name.split(":").at(-1);
      const reference =
        names.join("+") ||
        (open?.expression && ts.isIdentifier(unwrap(open.expression))
          ? unwrap(open.expression).text
          : "controlled");
      const id = stateId(node, `$overlay:${overlayName}:${reference}`);
      states.set(node, {
        id,
        node,
        state: `$overlay:${overlayName}:${reference}`,
        caller: owner(node),
        uses: new Set(["overlay"]),
        render: new Set(),
        integrated: new Set([sharedOverlays.get(name)]),
      });
      const managed = attributeValue(node, "managedBack");
      if (
        literal(managed) === false &&
        !infrastructure(node, "unmanaged-overlay")
      )
        report(
          node,
          "overlay-bypass",
          "Do not disable shared overlay Back ownership. Only the unsaved-navigation prompt is an audited unmanaged overlay.",
        );
      else
        integrate(
          attributeValue(node, "open")?.expression,
          sharedOverlays.get(name),
        );
    }
    if (
      node.tagName.getText(file) === "dialog" &&
      !infrastructure(node, "modal-primitive")
    )
      report(
        node,
        "modal-primitive",
        "Use the shared Dialog/Sheet; native <dialog> bypasses foreground Back and pending-write protection.",
      );
    const primitive = resolve(node.tagName);
    // Resolve named aliases/namespace members of raw Radix modal imports.
    const raw =
      primitive?.module &&
      (/^@radix-ui\/react-(dialog|alert-dialog)$/.test(primitive.module) ||
        (primitive.module === "radix-ui" &&
          ["Dialog", "AlertDialog"].includes(primitive.name)));
    if (raw && !infrastructure(node, "modal-primitive"))
      report(
        node,
        "modal-primitive",
        "Use components/ui/dialog or sheet instead of raw Radix modal primitives.",
      );
    if (!headers.has(name)) return;
    const caller = `${filename}#${owner(node)}`;
    let fallback = attributeValue(node, headers.get(name));
    // Exact reviewed header providers return a validated parent or null hub.
    // Resolve the spread binding to its canonical hook; arbitrary spreads do not qualify.
    let spreadHelper;
    if (!fallback)
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxSpreadAttribute(attr)) continue;
        const expression = unwrap(attr.expression);
        const binding = ts.isIdentifier(expression)
          ? find(expression, expression.text)
          : undefined;
        const call = unwrap(binding?.expression ?? expression);
        if (!call || !ts.isCallExpression(call)) continue;
        const canonical = identity(call.expression)?.replace(":", "#");
        if (!(contract.headerBackProviders ?? []).includes(canonical)) continue;
        spreadHelper = canonical;
        fallback = { expression: call };
      }
    const crumbs = attributeValue(node, "breadcrumbs");
    const disabled =
      literal(attributeValue(node, "showBack")) === false ||
      unwrap(fallback?.expression)?.kind === ts.SyntaxKind.NullKeyword;
    const forwarded = (contract.headerForwarders ?? []).includes(caller);
    const fallbackText =
      typeof literal(fallback) === "string" ? literal(fallback) : undefined;
    const routePath =
      filename
        .replace(/^src\/app\/\[locale\]/, "")
        .replace(/\/\([^/]+\)/g, "")
        .replace(/\/page\.tsx$/, "") || "/";
    if (fallbackText === routePath || fallbackText === `/${routePath}`)
      report(
        node,
        "header-policy",
        "Back fallback points to this same route. Choose its safe parent or declare a hub with showBack={false}.",
      );
    if (
      !forwarded &&
      !disabled &&
      !(fallback && safeDestination(fallback.expression)) &&
      !(crumbs && breadcrumbDestination(crumbs.expression))
    )
      report(
        node,
        "header-policy",
        "Declare Back explicitly: internal backFallbackHref, nonempty safe parent breadcrumbs, or showBack={false} for an audited hub. Validate dynamic return URLs with safeInternalReturnHref.",
      );
    if (disabled && !(contract.hubs ?? []).some((hub) => hub.id === caller))
      report(
        node,
        "header-policy",
        `Add an audited hub/auth policy for ${caller} to docs/contracts/back-navigation.json; disabled Back cannot silently hide missing parents.`,
      );
    const fallbackResolved = resolve(fallback?.expression);
    const fallbackPath =
      fallbackText ??
      (fallbackResolved?.kind === "destination"
        ? contract.destinations?.[fallbackResolved.name]
        : undefined);
    const fallbackNode = unwrap(fallback?.expression);
    const helper =
      spreadHelper ??
      (fallbackNode && ts.isCallExpression(fallbackNode)
        ? identity(fallbackNode.expression)?.replace(":", "#")
        : undefined);
    headerFacts.push({
      caller,
      disabled,
      forwarded,
      intent:
        fallbackNode?.kind === ts.SyntaxKind.NullKeyword
          ? "hub"
          : literal(attributeValue(node, "showBack")) === false
            ? "disabled"
            : "parent",
      ...(fallbackPath ? { parent: fallbackPath } : {}),
      ...(helper ? { helper } : {}),
      dynamic: !fallbackPath && !disabled,
    });
  });
  // Imports themselves are forbidden: re-exporting or aliasing a raw primitive must not bypass JSX detection.
  visit(file, (node) => {
    if (!ts.isImportDeclaration(node) || !node.importClause) return;
    const source = node.moduleSpecifier.text;
    const clause = node.importClause.namedBindings;
    const raw =
      /^@radix-ui\/react-(dialog|alert-dialog)$/.test(source) ||
      (source === "radix-ui" &&
        clause &&
        (ts.isNamespaceImport(clause) ||
          (ts.isNamedImports(clause) &&
            clause.elements.some((part) =>
              ["Dialog", "AlertDialog"].includes(
                (part.propertyName ?? part.name).text,
              ),
            ))));
    if (
      raw &&
      !(contract.infrastructure ?? []).some(
        (entry) =>
          entry.file === filename &&
          entry.capabilities.includes("modal-primitive"),
      )
    )
      report(
        node,
        "modal-primitive",
        "Raw modal imports are owned only by the shared Dialog/Sheet infrastructure; use their Back-aware wrappers.",
      );
  });
  for (const { fact, step } of workflowLinks)
    if (step && (step.entered || step.active))
      fact.integrated.add("useWorkflowStep");
  for (const fact of states.values())
    if (fact.workflow && !fact.entered && !fact.active)
      report(
        fact.node,
        "state-policy",
        `${fact.id} has no live entry/active-view connection. Opening must call this step.enter(), or render its step.active; a dormant hook cannot own Back.`,
      );
  const facts = [...states.values()]
    .filter((fact) => fact.uses.size > 0)
    .map((fact) => ({
      id: fact.id,
      state: fact.state,
      caller: fact.caller,
      uses: [...fact.uses].sort(),
      integrated: [...fact.integrated].sort(),
      render: [...fact.render].sort().map((record) => JSON.parse(record)),
      line:
        file.getLineAndCharacterOfPosition(fact.node.getStart(file)).line + 1,
    }));
  for (const fact of facts) {
    const entry = (contract.states ?? []).find(
      (candidate) => candidate.id === fact.id,
    );
    const node = [...states.values()].find(
      (candidate) => candidate.id === fact.id,
    ).node;
    if (!entry)
      report(
        node,
        "state-policy",
        `Stateful render ${fact.id} has no predecessor contract. Use useWorkflowStep/shared Dialog or declare this exact state as audited presentation in docs/contracts/back-navigation.json with behavior and regression evidence.`,
      );
    else if (
      entry.policy !== "presentation" &&
      !fact.integrated.includes(entry.integration)
    )
      report(
        node,
        "state-policy",
        `${fact.id} lost its declared ${entry.integration} Back integration. Restore this state's shared predecessor/overlay ownership; an unrelated hook is insufficient.`,
      );
    else if (
      entry.policy === "presentation" &&
      fact.uses.some((usage) => !entry.uses.includes(usage))
    )
      report(
        node,
        "state-policy",
        `${fact.id} now controls ${fact.uses.join(", ")} beyond its audited presentation uses. Review the new foreground/whole-view behavior and update its Back contract.`,
      );
    else if (
      entry.policy === "presentation" &&
      JSON.stringify(entry.render ?? []) !== JSON.stringify(fact.render)
    )
      report(
        node,
        "state-policy",
        `${fact.id} changed its audited render ownership/branch shape. Re-audit these component/role targets; a whole-view Location/editor cannot inherit an old presentation exception.`,
      );
  }
  return {
    file: filename,
    states: facts,
    errors,
    headers: headerFacts,
    targets: [...targets].sort(),
    redirects: [...redirects].sort(),
    functions: [...functions].sort(),
    exportBindings,
    actions,
    rendered,
  };
}
