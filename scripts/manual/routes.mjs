import { readFileSync } from "node:fs";
import ts from "typescript";

export const NAVIGATION_SOURCE = "src/lib/navigation.ts";

/**
 * @param {string} source Contents of `src/lib/navigation.ts`.
 * @param {string} [fileName] Used only in error messages.
 * @returns {readonly string[]}
 * @throws {Error} When `ROUTES` is absent or is not an object of string literals.
 */
export function extractRoutes(source, fileName = NAVIGATION_SOURCE) {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  /** @type {ts.ObjectLiteralExpression | undefined} */
  let literal;

  const unwrap = (expression) => {
    if (ts.isCallExpression(expression) && expression.arguments.length === 1) {
      return unwrap(expression.arguments[0]);
    }
    if (
      ts.isAsExpression(expression) ||
      ts.isParenthesizedExpression(expression)
    ) {
      return unwrap(expression.expression);
    }
    return expression;
  };

  const visit = (node) => {
    if (
      literal === undefined &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "ROUTES" &&
      node.initializer !== undefined
    ) {
      const initializer = unwrap(node.initializer);
      if (ts.isObjectLiteralExpression(initializer)) literal = initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  if (literal === undefined) {
    throw new Error(`${fileName} declares no ROUTES object literal`);
  }

  /** @type {string[]} */
  const routes = [];
  for (const property of literal.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      !ts.isStringLiteralLike(property.initializer)
    ) {
      throw new Error(
        `${fileName}: every ROUTES entry must be a string literal; ` +
          `"${property.name?.getText() ?? "?"}" is not`,
      );
    }
    routes.push(property.initializer.text);
  }
  return routes;
}

/**
 * @param {string} repoRoot
 * @returns {readonly string[]}
 */
export function readNavigationRoutes(repoRoot) {
  const file = `${repoRoot}/${NAVIGATION_SOURCE}`;
  return extractRoutes(readFileSync(file, "utf8"), NAVIGATION_SOURCE);
}
